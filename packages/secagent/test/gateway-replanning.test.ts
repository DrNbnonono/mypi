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
		if (command === "curl" && args.includes("--version"))
			return Promise.resolve({ stdout: "curl 8.10.0", stderr: "", exitCode: 0, timedOut: false, durationMs: 1 });
		if (command === "curl")
			return Promise.resolve({
				stdout: "fixture\n__PI_CURL_STATUS__:200",
				stderr: "",
				exitCode: 0,
				timedOut: false,
				durationMs: 1,
			});
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
	it("creates and executes an atomic intent without a caller-supplied decision id", async () => {
		const directory = await mkdtemp(join(tmpdir(), "pi-secagent-atomic-"));
		tempDirectories.push(directory);
		const fixture = join(directory, "sample.bin");
		await writeFile(fixture, Buffer.from("ELF\0fixture", "utf8"));
		const runtime = new SecAgentRuntime(new MemoryStore());
		const result = await new SecurityExecutionGateway(runtime).execute(
			{
				tool: "file",
				input: { path: fixture },
				intent: {
					goal: "identify the fixture",
					rationale: "file type is the safest first observation",
					expectedResult: "an ELF identification",
				},
				idempotencyKey: "call-atomic-1",
			},
			{ cwd: directory, executor: new FakeExecutor() },
		);
		expect(result.ok).toBe(true);
		expect(result.execution?.argvHash).toMatch(/^[0-9a-f]{64}$/);
		const snapshot = runtime.snapshot();
		expect(snapshot.state.decisions).toHaveLength(1);
		expect(snapshot.state.decisions[0]?.resultStatus).toBe("succeeded");
		expect(snapshot.state.actions[0]).toMatchObject({
			idempotencyKey: "call-atomic-1",
			status: "succeeded",
			toolName: "file",
		});
		expect(runtime.readAudit()[0]).toMatchObject({
			requestedInputHash: expect.stringMatching(/^[0-9a-f]{64}$/),
			normalizedInputHash: expect.stringMatching(/^[0-9a-f]{64}$/),
			argvHash: expect.stringMatching(/^[0-9a-f]{64}$/),
			command: "file",
			resultSource: "local",
		});
	});

	it("rejects retries with the same idempotency key", async () => {
		const directory = await mkdtemp(join(tmpdir(), "pi-secagent-idempotency-"));
		tempDirectories.push(directory);
		const fixture = join(directory, "sample.bin");
		await writeFile(fixture, Buffer.from("fixture", "utf8"));
		const runtime = new SecAgentRuntime(new MemoryStore());
		const selected = decision("d-idempotent", "file");
		runtime.append({ type: "decision_recorded", decision: selected, createdAt: selected.createdAt });
		const gateway = new SecurityExecutionGateway(runtime);
		const request = {
			tool: "file",
			decisionId: selected.id,
			input: { path: fixture },
			idempotencyKey: "same-call",
		} as const;
		expect((await gateway.execute(request, { cwd: directory, executor: new FakeExecutor() })).ok).toBe(true);
		const retry = await gateway.execute(request, { cwd: directory, executor: new FakeExecutor() });
		expect(retry.ok).toBe(false);
		expect(retry.diagnostic?.message).toMatch(/already exists/);
	});
	it("completes a successful gateway decision and links hash-backed provenance", async () => {
		const directory = await mkdtemp(join(tmpdir(), "pi-secagent-gateway-"));
		tempDirectories.push(directory);
		const fixture = join(directory, "sample.bin");
		await writeFile(fixture, Buffer.from("ELF\0fixture", "utf8"));
		const runtime = new SecAgentRuntime(new MemoryStore());
		const selected = decision("d-success", "file");
		runtime.append({ type: "decision_recorded", decision: selected, createdAt: selected.createdAt });
		const result = await new SecurityExecutionGateway(runtime).execute(
			{ tool: "file", decisionId: selected.id, input: { path: fixture } },
			{ cwd: directory, executor: new FakeExecutor() },
		);
		expect(result.ok).toBe(true);
		const snapshot = runtime.snapshot();
		const evidence = snapshot.state.evidence.find((item) => item.decisionIds?.includes(selected.id));
		expect(snapshot.state.decisions[0]?.resultStatus).toBe("succeeded");
		expect(evidence?.sha256).toMatch(/^[0-9a-f]{64}$/);
		expect(evidence?.targetRefs).toContain(fixture);
		expect(snapshot.replanRequired).toBe(false);
	});
	it("marks an unexecutable selected action failed and requests re-planning", async () => {
		const runtime = new SecAgentRuntime(new MemoryStore());
		const selected = decision("d-fail", "missing-tool");
		runtime.append({ type: "decision_recorded", decision: selected, createdAt: selected.createdAt });
		const result = await new SecurityExecutionGateway(runtime).execute(
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
	it("executes an out-of-scope autonomous action with a high-risk audit warning", async () => {
		const runtime = new SecAgentRuntime(new MemoryStore());
		runtime.append({
			type: "task_started",
			task: {
				id: "autonomous-task",
				goal: "controlled fixture",
				scenario: "penetration-test",
				assets: [],
				constraints: [],
				successCriteria: [],
				declaredAuthorization: ["controlled fixture"],
				pendingConfirmations: [],
				createdAt: "2026-08-30T00:00:00Z",
			},
			createdAt: "2026-08-30T00:00:00Z",
		});
		runtime.command({
			type: "set_scope",
			scope: { targets: [{ id: "scope", kind: "ipv4", value: "127.0.0.1" }], authorizationSource: "test" },
		});
		runtime.command({ type: "set_isolation", isolation: { status: "sandbox", source: "pi-sandbox" } });
		runtime.command({
			type: "authorize_autonomous",
			authorization: {
				operator: "tester",
				reason: "controlled fixture",
				isolationSource: "pi-sandbox",
				confirmedAt: "2026-08-30T00:00:00Z",
			},
		});
		runtime.command({ type: "set_policy", mode: "autonomous", operator: "tester", reason: "controlled fixture" });
		const selected = decision("d-autonomous-scope", "curl");
		runtime.append({ type: "decision_recorded", decision: selected, createdAt: selected.createdAt });

		const result = await new SecurityExecutionGateway(runtime).execute(
			{ tool: "curl", decisionId: selected.id, input: { target: "http://127.0.0.2/" } },
			{ cwd: process.cwd(), executor: new FakeExecutor() },
		);

		expect(result.ok).toBe(true);
		expect(runtime.readAudit().at(-1)).toMatchObject({
			policyDecision: "warn",
			blocked: false,
			scope: { allowed: false },
		});
		expect(runtime.readAudit().at(-1)?.warnings?.length).toBeGreaterThan(0);
	});
	it("rejects concurrent execution of the same decision", async () => {
		const runtime = new SecAgentRuntime(new MemoryStore());
		runtime.command({
			type: "set_scope",
			scope: { targets: [{ id: "scope", kind: "ipv4", value: "127.0.0.1" }], authorizationSource: "test" },
		});
		const selected = decision("d-concurrent", "nmap");
		runtime.append({ type: "decision_recorded", decision: selected, createdAt: selected.createdAt });
		let releaseApproval: ((approved: boolean) => void) | undefined;
		const approval = new Promise<boolean>((resolve) => {
			releaseApproval = resolve;
		});
		const gateway = new SecurityExecutionGateway(runtime);
		const first = gateway.execute(
			{ tool: "nmap", decisionId: selected.id, input: { target: "127.0.0.1" } },
			{ cwd: process.cwd(), executor: new FakeExecutor(), confirm: () => approval },
		);
		await Promise.resolve();
		const second = await gateway.execute(
			{ tool: "nmap", decisionId: selected.id, input: { target: "127.0.0.1" } },
			{ cwd: process.cwd(), executor: new FakeExecutor() },
		);
		expect(second.ok).toBe(false);
		expect(second.diagnostic?.message).toMatch(/already executing/);
		releaseApproval?.(true);
		expect((await first).ok).toBe(true);
		expect(runtime.snapshot().state.decisions[0]?.resultStatus).toBe("succeeded");
	});
	it("converts adapter/approval exceptions into a failed decision and audit", async () => {
		const runtime = new SecAgentRuntime(new MemoryStore());
		runtime.command({
			type: "set_scope",
			scope: { targets: [{ id: "scope", kind: "ipv4", value: "127.0.0.1" }], authorizationSource: "test" },
		});
		const selected = decision("d-throw", "nmap");
		runtime.append({ type: "decision_recorded", decision: selected, createdAt: selected.createdAt });
		const result = await new SecurityExecutionGateway(runtime).execute(
			{ tool: "nmap", decisionId: selected.id, input: { target: "127.0.0.1" } },
			{
				cwd: process.cwd(),
				executor: new FakeExecutor(),
				confirm: async () => {
					throw new Error("approval bridge down");
				},
			},
		);
		expect(result.ok).toBe(false);
		expect(result.diagnostic?.message).toMatch(/approval bridge down/);
		expect(runtime.snapshot().state.decisions[0]?.resultStatus).toBe("failed");
		expect(runtime.readAudit().at(-1)).toMatchObject({ blocked: false, isError: true });
	});
	it("blocks protected credential paths in the execution gateway", async () => {
		const runtime = new SecAgentRuntime(new MemoryStore());
		const selected = decision("d-protected", "file");
		runtime.append({ type: "decision_recorded", decision: selected, createdAt: selected.createdAt });
		const result = await new SecurityExecutionGateway(runtime).execute(
			{ tool: "file", decisionId: selected.id, input: { path: "/home/demo/.ssh/id_ed25519" } },
			{ cwd: "/workspace", executor: new FakeExecutor() },
		);
		expect(result).toMatchObject({
			ok: false,
			diagnostic: { message: expect.stringContaining("protected credential path") },
		});
		expect(runtime.readAudit().at(-1)).toMatchObject({ blocked: true });
	});
	it("treats contradicted decisions as explicit re-planning signals", () => {
		const contradicted = decision("d-contradicted", "read");
		contradicted.resultStatus = "contradicted";
		contradicted.actualResult = "new evidence invalidated the expected service fingerprint";
		expect(assessReplanNeed([contradicted])).toMatchObject({ required: true, decisionId: contradicted.id });
	});
});
