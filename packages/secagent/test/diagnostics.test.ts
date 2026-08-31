import { describe, expect, it } from "vitest";
import type { SecuritySessionStore } from "../src/core/state.ts";
import { runSecAgentDiagnostics } from "../src/diagnostics.ts";
import { SecAgentRuntime } from "../src/runtime.ts";
import type { SecurityToolCommandResult, SecurityToolExecutor } from "../src/tools/adapter.ts";

class MemoryStore implements SecuritySessionStore {
	readonly entries: Array<{ type: string; customType?: string; data?: unknown }> = [];
	getBranch(): Array<{ type: string; customType?: string; data?: unknown }> {
		return [...this.entries];
	}
	appendCustomEntry(customType: string, data?: unknown): string {
		this.entries.push({ type: "custom", customType, data });
		return String(this.entries.length);
	}
}

class VersionExecutor implements SecurityToolExecutor {
	run(command: string): Promise<SecurityToolCommandResult> {
		return Promise.resolve({
			stdout: `${command} 1.0.0`,
			stderr: "",
			exitCode: 0,
			timedOut: false,
			durationMs: 1,
		});
	}
}

describe("SecAgent diagnostics", () => {
	it("checks local tools and exposes the latest result through the profile snapshot", async () => {
		const runtime = new SecAgentRuntime(new MemoryStore(), { cwd: process.cwd() });
		const diagnostics = await runSecAgentDiagnostics({
			cwd: process.cwd(),
			isolation: { status: "sandbox", source: "test-sandbox" },
			executionContext: { executor: new VersionExecutor() },
		});
		expect(diagnostics.checks.find((check) => check.id === "isolation")).toMatchObject({ status: "pass" });
		expect(diagnostics.checks.filter((check) => check.id.startsWith("tool:"))).not.toHaveLength(0);
		expect(diagnostics.checks.find((check) => check.id === "model-connectivity")).toMatchObject({ status: "warn" });
		expect(typeof diagnostics.runtimeReady).toBe("boolean");
		expect(typeof diagnostics.autonomousReady).toBe("boolean");
		expect(typeof diagnostics.demoReady).toBe("boolean");

		const cached = await runtime.runDiagnostics();
		expect(runtime.snapshot().diagnostics).toEqual(cached);
	});
});
