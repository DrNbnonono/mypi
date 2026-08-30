import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AutonomousSearchLoop } from "../src/core/autonomous-loop.ts";
import { createInitialSecurityState } from "../src/core/state.ts";
import type { SecurityScenario, SecuritySessionStore, SecurityState } from "../src/index.ts";
import { SecAgentRuntime } from "../src/runtime.ts";
import type { SecurityToolCommandResult, SecurityToolExecutor } from "../src/tools/adapter.ts";
import { SecurityExecutionGateway } from "../src/tools/gateway.ts";

class MemoryStore implements SecuritySessionStore {
	readonly entries: Array<{ type: string; customType?: string; data?: unknown }> = [];
	getBranch(): Array<{ type: string; customType?: string; data?: unknown }> { return [...this.entries]; }
	appendCustomEntry(customType: string, data?: unknown): string { this.entries.push({ type: "custom", customType, data }); return String(this.entries.length); }
}

class ScenarioExecutor implements SecurityToolExecutor {
	readonly calls: string[] = [];
	private readonly failOnce = new Set<string>();
	failNext(command: string): void { this.failOnce.add(command); }
	run(command: string, args: readonly string[]): Promise<SecurityToolCommandResult> {
		this.calls.push(command);
		const versionCheck = args.some((arg) => /version/i.test(arg)) || args.includes("-V");
		if (versionCheck) return Promise.resolve({ stdout: `${command} 1.0`, stderr: "", exitCode: 0, timedOut: false, durationMs: 1 });
		if (this.failOnce.delete(command)) return Promise.resolve({ stdout: "", stderr: "controlled failure", exitCode: 2, timedOut: false, durationMs: 2 });
		const stdout = command === "curl" ? "ok\n__PI_CURL_STATUS__:200"
			: command === "httpx" ? '{"url":"http://127.0.0.1","status_code":200,"title":"lab"}'
			: command === "nuclei" ? '{"template-id":"fixture","severity":"medium","matched-at":"http://127.0.0.1"}'
			: command === "nmap" ? "Nmap scan report\n80/tcp open http"
			: command === "file" ? "sample.bin: ELF 64-bit LSB executable"
			: command === "strings" ? "ELF\nflag-like-marker\n"
			: command === "readelf" ? "Type: DYN\nMachine: Advanced Micro Devices X86-64\nEntry point address: 0x1000\nGNU_STACK RW\nGNU_RELRO\nBIND_NOW\n__stack_chk_fail"
			: command === "objdump" ? "sample.bin: file format elf64-x86-64\n0000000000001000 <main>:"
			: command === "binwalk" ? "DECIMAL HEXADECIMAL DESCRIPTION\n0 0x0 ELF"
			: command === "exiftool" ? '[{"FileName":"sample.bin","FileType":"ELF"}]'
			: `${command} fixture output`;
		return Promise.resolve({ stdout, stderr: "", exitCode: 0, timedOut: false, durationMs: 2 });
	}
}

const temporary: string[] = [];
afterEach(async () => { for (const directory of temporary.splice(0)) await rm(directory, { recursive: true, force: true }); });

function appendInitial(runtime: SecAgentRuntime, state: SecurityState): void {
	if (!state.task) throw new Error("fixture task is required");
	runtime.append({ type: "task_started", task: state.task, createdAt: state.task.createdAt });
	if (state.scope.targets.length) runtime.append({ type: "scope_set", scope: state.scope, createdAt: state.task.createdAt });
	if (state.ctfProfile) runtime.append({ type: "ctf_profiled", profile: state.ctfProfile, createdAt: state.task.createdAt });
	runtime.append({ type: "stage_changed", stage: state.stage, createdAt: state.task.createdAt });
}

async function artifactState(scenario: Extract<SecurityScenario, "reverse-engineering" | "incident-response" | "ctf">, ctfKind?: "pwn" | "reverse"): Promise<{ state: SecurityState; cwd: string }> {
	const cwd = await mkdtemp(join(tmpdir(), "pi-secagent-autonomy-"));
	temporary.push(cwd);
	await writeFile(join(cwd, "sample.bin"), Buffer.from("ELF\0fixture\0flag-like-marker\0", "utf8"));
	const state = createInitialSecurityState();
	state.task = { id: `task-${scenario}`, goal: `controlled ${scenario}`, scenario, assets: [{ id: "artifact", name: "sample.bin", kind: "unknown", path: "sample.bin" }], constraints: ["controlled fixture"], successCriteria: ["collect reproducible evidence"], declaredAuthorization: [], pendingConfirmations: [], createdAt: "2026-08-30T00:00:00Z" };
	state.goal = state.task.goal;
	state.stage = "analysis";
	if (scenario === "ctf") state.ctfProfile = { kind: ctfKind ?? "reverse", objective: state.goal, recommendedCapabilities: ["artifact-triage", "binary-triage", "reverse-analysis"], flagPatterns: ["flag{...}"], expectedEvidence: ["artifact facts"], createdAt: state.task.createdAt };
	return { state, cwd };
}

describe("autonomous state-space loop", () => {
	it("progresses through distinct Web strategies and records gateway evidence", async () => {
		const state = createInitialSecurityState();
		state.task = { id: "web", goal: "map controlled web fixture", scenario: "web-security", assets: [], constraints: [], successCriteria: ["collect HTTP evidence"], declaredAuthorization: ["loopback"], pendingConfirmations: [], createdAt: "2026-08-30T00:00:00Z" };
		state.goal = state.task.goal;
		state.stage = "recon";
		state.scope = { targets: [{ id: "scope", kind: "url", value: "http://127.0.0.1:18080/" }], authorizationSource: "test", updatedAt: state.task.createdAt };
		const runtime = new SecAgentRuntime(new MemoryStore()); appendInitial(runtime, state);
		const executor = new ScenarioExecutor();
		const result = await new AutonomousSearchLoop(runtime, new SecurityExecutionGateway(runtime)).run({ cwd: process.cwd(), executor }, { maxSteps: 3 });
		expect(result.steps.length).toBeGreaterThan(1);
		expect(runtime.snapshot().state.evidence.length).toBeGreaterThan(0);
		const selected = runtime.snapshot().state.decisions.map((decision) => decision.candidates.find((candidate) => candidate.id === decision.selectedActionId)?.tool);
		expect(new Set(selected).size).toBe(selected.length);
		expect(runtime.readAudit().every((record) => !record.scope.required || record.scope.allowed)).toBe(true);
	});

	it("moves away from a failed killchain strategy and records a replan", async () => {
		const state = createInitialSecurityState();
		state.task = { id: "killchain", goal: "controlled killchain", scenario: "penetration-test", assets: [], constraints: [], successCriteria: ["advance after failure"], declaredAuthorization: ["loopback"], pendingConfirmations: [], createdAt: "2026-08-30T00:00:00Z" };
		state.goal = state.task.goal; state.stage = "recon";
		state.scope = { targets: [{ id: "scope", kind: "url", value: "http://127.0.0.1:18080/" }], authorizationSource: "test" };
		const runtime = new SecAgentRuntime(new MemoryStore()); appendInitial(runtime, state);
		const executor = new ScenarioExecutor(); executor.failNext("httpx");
		await new AutonomousSearchLoop(runtime, new SecurityExecutionGateway(runtime)).run({ cwd: process.cwd(), executor }, { maxSteps: 3 });
		const decisions = runtime.snapshot().state.decisions;
		expect(decisions.some((decision) => decision.resultStatus === "failed")).toBe(true);
		expect(runtime.snapshot().state.replans.length).toBeGreaterThan(0);
		const strategies = decisions.map((decision) => decision.candidates.find((candidate) => candidate.id === decision.selectedActionId)?.capability);
		expect(new Set(strategies.filter(Boolean)).size).toBeGreaterThan(1);
	});

	it.each(["reverse-engineering", "incident-response"] as const)("runs bounded local artifact progression for %s", async (scenario) => {
		const { state, cwd } = await artifactState(scenario);
		const runtime = new SecAgentRuntime(new MemoryStore()); appendInitial(runtime, state);
		const executor = new ScenarioExecutor();
		await new AutonomousSearchLoop(runtime, new SecurityExecutionGateway(runtime)).run({ cwd, executor }, { maxSteps: 3 });
		expect(runtime.snapshot().state.decisions.length).toBeGreaterThan(1);
		expect(runtime.snapshot().state.evidence.every((evidence) => Boolean(evidence.sha256))).toBe(true);
		expect(executor.calls.some((tool) => ["file", "strings", "readelf", "objdump", "binwalk", "exiftool"].includes(tool))).toBe(true);
	});

	it("covers Pwn through the generic reverse/vulnerability capability path", async () => {
		const { state, cwd } = await artifactState("ctf", "pwn");
		const runtime = new SecAgentRuntime(new MemoryStore()); appendInitial(runtime, state);
		const executor = new ScenarioExecutor();
		await new AutonomousSearchLoop(runtime, new SecurityExecutionGateway(runtime)).run({ cwd, executor }, { maxSteps: 4 });
		const tools = runtime.snapshot().state.decisions.map((decision) => decision.candidates.find((candidate) => candidate.id === decision.selectedActionId)?.tool);
		expect(tools).toContain("readelf");
		expect(runtime.snapshot().state.ctfProfile?.kind).toBe("pwn");
		expect(runtime.snapshot().state.delegations.some((item) => item.role === "ctf-specialist")).toBe(false);
	});
});
