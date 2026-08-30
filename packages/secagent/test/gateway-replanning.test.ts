import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assessReplanNeed } from "../src/core/planner.ts";
import type { SecuritySessionStore } from "../src/core/state.ts";
import type { SecurityDecision } from "../src/core/types.ts";
import { SecAgentRuntime } from "../src/runtime.ts";
import type { SecurityToolCommandResult, SecurityToolExecutor } from "../src/tools/adapter.ts";
import { SecurityExecutionGateway } from "../src/tools/gateway.ts";

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

class FakeExecutor implements SecurityToolExecutor {
	run(command: string, args: readonly string[]): Promise<SecurityToolCommandResult> {
		if (command === "file" && args.includes("--version"))
			return Promise.resolve({ stdout: "file-5.45", stderr: "", exitCode: 0, timedOut: false, durationMs: 1 });
		return Promise.resolve({
			stdout: "sample.bin: ELF 64-bit LSB executable",
			stderr: "",
			exitCode: 0,
			timedOut: false,
			durationMs: 1,
		});
	}
}

const tempDirectories: string[] = [];

afterEach(async () => {
	for (const directory of tempDirectories.splice(0)) await rm(directory, { recursive: true, force: true });
});

function decision(id: string, tool: string): SecurityDecision {
	return {
		id,
		createdAt: "2026-08-30T00:00:00Z",
		goal: "controlled analysis",
		stage: "analysis",
		evidenceIds: [],
		candidates: [
			{
				id: `${id}-action`,
				tool,
				description: `run ${tool}`,
				goalRelevance: 1,
				informationGain: 0.8,
				confidence: 0.8,
				cost: 0.1,
				preconditions: [],
				risk: 0.1,
				score: 0.8,
			},
		],
		selectedActionId: `${id}-action`,
		resultStatus: "pending",
	};
}

describe("decision execution and re-planning signals", () => {
	it("completes a successful gateway decision and links normalized evidence", async () => {
		const directory = await mkdtemp(join(tmpdir(), "pi-secagent-gateway-"));
		tempDirectories.push(directory);
		const fixture = join(directory, "sample.bin");
		await writeFile(fixture, Buffer.from("ELF\0fixture", "utf8"));
		const runtime = new SecAgentRuntime(new MemoryStore());
		const selected = decision("d-success", "file");
		runtime.append({ type: "decision_recorded", decision: selected, createdAt: selected.createdAt });
		const gateway = new SecurityExecutionGateway(runtime);

		const result = await gateway.execute(
			{ tool: "file", decisionId: selected.id, input: { path: fixture } },
			{ cwd: directory, executor: new FakeExecutor() },
		);

		expect(result.ok).toBe(true);
		const snapshot = runtime.snapshot();
		expect(snapshot.state.decisions[0]?.resultStatus).toBe("succeeded");
		expect(snapshot.state.evidence.some((item) => item.decisionIds?.includes(selected.id))).toBe(true);
		expect(snapshot.replanRequired).toBe(false);
	});

	it("marks an unexecutable selected action failed and requests re-planning", async () => {
		const runtime = new SecAgentRuntime(new MemoryStore());
		const selected = decision("d-fail", "missing-tool");
		runtime.append({ type: "decision_recorded", decision: selected, createdAt: selected.createdAt });
		const gateway = new SecurityExecutionGateway(runtime);

		const result = await gateway.execute(
			{ tool: "missing-tool", decisionId: selected.id, input: {} },
			{ cwd: process.cwd(), executor: new FakeExecutor() },
		);

		expect(result.ok).toBe(false);
		const snapshot = runtime.snapshot();
		expect(snapshot.state.decisions[0]?.resultStatus).toBe("failed");
		expect(snapshot.replanRequired).toBe(true);
		expect(snapshot.replanDecisionId).toBe(selected.id);
		expect(snapshot.replanReason).toMatch(/failed/i);
	});

	it("treats contradicted decisions as explicit re-planning signals", () => {
		const contradicted = decision("d-contradicted", "read");
		contradicted.resultStatus = "contradicted";
		contradicted.actualResult = "new evidence invalidated the expected service fingerprint";
		expect(assessReplanNeed([contradicted])).toMatchObject({
			required: true,
			decisionId: contradicted.id,
		});
	});
});
