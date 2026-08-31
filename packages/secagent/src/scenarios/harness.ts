import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AutonomousRunResult, AutonomousSearchLoop } from "../core/autonomous-loop.ts";
import { createInitialSecurityState, type SecuritySessionStore } from "../core/state.ts";
import type { CtfChallengeProfile, SecurityInputAsset, SecurityState } from "../core/types.ts";
import { SecAgentRuntime } from "../runtime.ts";
import type { SecurityToolCommandResult, SecurityToolExecutor } from "../tools/adapter.ts";
import { SecurityExecutionGateway } from "../tools/gateway.ts";
import {
	type ControlledScenarioBenchmarkDefinition,
	type ControlledScenarioEvaluation,
	controlledBenchmarkDefinition,
	evaluateControlledScenario,
} from "./controlled.ts";

class MemorySecuritySessionStore implements SecuritySessionStore {
	private readonly entries: Array<{ type: string; customType?: string; data?: unknown }> = [];

	getBranch(): Array<{ type: string; customType?: string; data?: unknown }> {
		return [...this.entries];
	}

	appendCustomEntry(customType: string, data?: unknown): string {
		this.entries.push({ type: "custom", customType, data });
		return String(this.entries.length);
	}
}

class ControlledScenarioExecutor implements SecurityToolExecutor {
	readonly calls: Array<{ command: string; args: readonly string[] }> = [];
	private readonly failOnce: Set<string>;

	constructor(failCommands: readonly string[]) {
		this.failOnce = new Set(failCommands);
	}

	run(
		command: string,
		args: readonly string[],
		_options: { cwd: string; signal?: AbortSignal; timeoutMs: number },
	): Promise<SecurityToolCommandResult> {
		this.calls.push({ command, args: [...args] });
		const versionCheck =
			args.includes("--version") || args.includes("-V") || args.includes("-version") || args.includes("version");
		if (versionCheck) return Promise.resolve(result(versionOutput(command)));
		if (this.failOnce.delete(command)) return Promise.resolve(result("", 2, "controlled injected failure"));
		return Promise.resolve(result(toolOutput(command)));
	}
}

function result(stdout: string, exitCode = 0, stderr = ""): SecurityToolCommandResult {
	return { stdout, stderr, exitCode, timedOut: false, durationMs: 2 };
}

function versionOutput(command: string): string {
	switch (command) {
		case "nmap":
			return "Nmap version 7.95";
		case "curl":
			return "curl 8.8.0";
		case "httpx":
			return "httpx version 1.6.10";
		case "ffuf":
			return "ffuf version 2.1.0";
		case "nuclei":
			return "nuclei version 3.3.0";
		case "file":
			return "file-5.45";
		case "strings":
			return "GNU strings 2.42";
		case "readelf":
			return "GNU readelf 2.42";
		case "objdump":
			return "GNU objdump 2.42";
		case "binwalk":
			return "Binwalk v2.3.4";
		case "exiftool":
			return "12.76";
		default:
			return `${command} 1.0`;
	}
}

function toolOutput(command: string): string {
	switch (command) {
		case "nmap":
			return "Nmap scan report for 127.0.0.1\nHost is up\n80/tcp open http\n443/tcp open https";
		case "curl":
			return "controlled-web-body\n__PI_CURL_STATUS__:200";
		case "httpx":
			return '{"url":"http://127.0.0.1:18080","status_code":200,"title":"SecAgent Lab","tech":["nginx"]}';
		case "ffuf":
			return '{"results":[{"url":"http://127.0.0.1:18080/admin","status":200,"length":42}]}';
		case "nuclei":
			return '{"template-id":"controlled-fixture","severity":"medium","matched-at":"http://127.0.0.1:18080/"}';
		case "file":
			return "sample.bin: ELF 64-bit LSB pie executable, x86-64";
		case "strings":
			return "ELF\ncontrolled-marker\nflag{controlled_fixture}\n";
		case "readelf":
			return "Type: DYN (Position-Independent Executable file)\nMachine: Advanced Micro Devices X86-64\nEntry point address: 0x1000\nGNU_STACK RW\nGNU_RELRO\nBIND_NOW\n__stack_chk_fail";
		case "objdump":
			return "sample.bin: file format elf64-x86-64\n0000000000001000 <main>:\n 1000: 55 push %rbp";
		case "binwalk":
			return "DECIMAL HEXADECIMAL DESCRIPTION\n0 0x0 ELF, 64-bit LSB shared object";
		case "exiftool":
			return '[{"FileName":"sample.bin","FileType":"ELF","FileSize":"32 bytes"}]';
		default:
			return `${command} controlled output`;
	}
}

function pwnProfile(goal: string, createdAt: string): CtfChallengeProfile {
	return {
		kind: "pwn",
		objective: goal,
		recommendedCapabilities: ["artifact-triage", "binary-triage", "reverse-analysis", "pwn-reasoning"],
		flagPatterns: ["flag{...}", "ctf{...}"],
		expectedEvidence: ["architecture", "mitigation state", "control-flow evidence"],
		createdAt,
	};
}

async function createScenarioState(
	definition: ControlledScenarioBenchmarkDefinition,
	cwd: string,
): Promise<SecurityState> {
	const state = createInitialSecurityState();
	const createdAt = new Date().toISOString();
	const assets: SecurityInputAsset[] = [];
	if (definition.requiresArtifact) {
		await writeFile(
			join(cwd, "sample.bin"),
			Buffer.from("ELF\0controlled-marker\0flag{controlled_fixture}\0", "utf8"),
		);
		assets.push({ id: "artifact", name: "sample.bin", kind: "unknown" as const, path: "sample.bin" });
	}
	if (definition.id === "web" || definition.id === "killchain") {
		await writeFile(join(cwd, "paths-wordlist.txt"), "admin\nhealth\napi\n", "utf8");
		assets.push({ id: "wordlist", name: "paths-wordlist.txt", kind: "text" as const, path: "paths-wordlist.txt" });
	}
	state.task = {
		id: `controlled-${definition.id}`,
		goal: `Controlled ${definition.id} autonomous benchmark`,
		scenario: definition.scenario,
		assets,
		constraints: ["controlled deterministic fixture", "do not widen scope"],
		successCriteria: [`exercise ${definition.id} capability path with reproducible evidence`],
		declaredAuthorization: definition.requiresNetworkScope ? ["loopback controlled fixture"] : [],
		pendingConfirmations: [],
		createdAt,
	};
	state.goal = state.task.goal;
	state.stage = definition.startStage;
	state.policyMode = "competition";
	state.isolation = { status: "sandbox", source: "controlled-scenario-harness", verifiedAt: createdAt };
	if (definition.requiresNetworkScope) {
		state.scope = {
			targets: [{ id: "loopback", kind: "url", value: "http://127.0.0.1:18080/" }],
			authorizationSource: "controlled-scenario-harness",
			updatedAt: createdAt,
		};
	}
	if (definition.ctfKind === "pwn") state.ctfProfile = pwnProfile(state.goal, createdAt);
	return state;
}

function seedRuntime(runtime: SecAgentRuntime, state: SecurityState): void {
	if (!state.task) throw new Error("controlled scenario task is missing");
	const createdAt = state.task.createdAt;
	runtime.append({ type: "task_started", task: state.task, createdAt });
	runtime.append({ type: "isolation_changed", isolation: state.isolation, createdAt });
	runtime.append({
		type: "policy_changed",
		mode: "competition",
		operator: "controlled-harness",
		reason: "deterministic isolated benchmark",
		createdAt,
	});
	if (state.scope.targets.length > 0) runtime.append({ type: "scope_set", scope: state.scope, createdAt });
	if (state.ctfProfile) runtime.append({ type: "ctf_profiled", profile: state.ctfProfile, createdAt });
	runtime.append({ type: "stage_changed", stage: state.stage, createdAt });
}

export interface ControlledScenarioTraceEntry {
	decisionId: string;
	tool: string;
	capability: string;
	status: "pending" | "succeeded" | "failed" | "contradicted";
	evidenceCount: number;
}

export interface ControlledScenarioHarnessMetrics {
	decisions: number;
	failedDecisions: number;
	replans: number;
	evidence: number;
	verifications: number;
	observerSignals: number;
	auditRecords: number;
	toolCalls: number;
}

export interface ControlledScenarioHarnessResult {
	definition: ControlledScenarioBenchmarkDefinition;
	autonomous: AutonomousRunResult;
	evaluation: ControlledScenarioEvaluation;
	metrics: ControlledScenarioHarnessMetrics;
	trace: ControlledScenarioTraceEntry[];
	commands: string[];
}

export interface ControlledScenarioHarnessOptions {
	maxSteps?: number;
	injectFailure?: boolean;
}

function defaultStepLimit(definition: ControlledScenarioBenchmarkDefinition): number {
	if (definition.id === "killchain") return 10;
	if (definition.id === "web") return 8;
	return 6;
}

export async function runControlledScenarioBenchmark(
	id: ControlledScenarioBenchmarkDefinition["id"],
	options: ControlledScenarioHarnessOptions = {},
): Promise<ControlledScenarioHarnessResult> {
	const definition = controlledBenchmarkDefinition(id);
	const cwd = await mkdtemp(join(tmpdir(), `pi-secagent-${id}-`));
	try {
		const initial = await createScenarioState(definition, cwd);
		const runtime = new SecAgentRuntime(new MemorySecuritySessionStore());
		seedRuntime(runtime, initial);
		const failureCommands = options.injectFailure === true && id === "killchain" ? ["httpx"] : [];
		const executor = new ControlledScenarioExecutor(failureCommands);
		const autonomous = await new AutonomousSearchLoop(runtime, new SecurityExecutionGateway(runtime)).run(
			{ cwd, executor },
			{ maxSteps: options.maxSteps ?? defaultStepLimit(definition) },
		);
		const snapshot = runtime.snapshot().state;
		const audit = runtime.readAudit();
		const evaluation = evaluateControlledScenario(definition, snapshot, audit);
		const trace = snapshot.decisions.flatMap((decision) => {
			const selected = decision.candidates.find((candidate) => candidate.id === decision.selectedActionId);
			if (!selected) return [];
			return [
				{
					decisionId: decision.id,
					tool: selected.tool,
					capability: selected.capability ?? selected.tool,
					status: decision.resultStatus ?? "pending",
					evidenceCount: snapshot.evidence.filter((item) => item.decisionIds?.includes(decision.id)).length,
				},
			];
		});
		return {
			definition,
			autonomous,
			evaluation,
			metrics: {
				decisions: snapshot.decisions.length,
				failedDecisions: snapshot.decisions.filter(
					(item) => item.resultStatus === "failed" || item.resultStatus === "contradicted",
				).length,
				replans: snapshot.replans.length,
				evidence: snapshot.evidence.length,
				verifications: snapshot.evidenceGraph.verifications.length,
				observerSignals: snapshot.observerSignals.length,
				auditRecords: audit.length,
				toolCalls: snapshot.budget.usage.toolCallsUsed,
			},
			trace,
			commands: executor.calls.map((call) => call.command),
		};
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
}
