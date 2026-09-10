import { getSecurityToolAdapter, getSecurityToolMetadata } from "../tools/registry.ts";
import { buildDefaultActionInput } from "./action-input.ts";
import { strategyKey } from "./planner.ts";
import { blockedPathKeys, createActionPathKey, createEmptySearchBoard, openSearchIntents } from "./search-board.ts";
import type {
	CandidateActionInput,
	CtfChallengeKind,
	SearchIntent,
	SecurityScenario,
	SecurityStage,
	SecurityState,
} from "./types.ts";

interface CandidateTemplate {
	tool: string;
	capability: string;
	scenarios: SecurityScenario[];
	ctfKinds?: CtfChallengeKind[];
	stages: SecurityStage[];
	network: boolean;
	localArtifact: boolean;
	goalRelevance: number;
	informationGain: number;
	confidence: number;
	cost: number;
	description: string;
	expectedEvidence: string[];
}

const TEMPLATES: readonly CandidateTemplate[] = [
	{
		tool: "nmap",
		capability: "network-enumeration",
		scenarios: ["penetration-test"],
		stages: ["planning", "recon"],
		network: true,
		localArtifact: false,
		goalRelevance: 0.9,
		informationGain: 0.9,
		confidence: 0.85,
		cost: 0.35,
		description: "Bounded port and service discovery",
		expectedEvidence: ["reachable services", "service fingerprints"],
	},
	{
		tool: "httpx",
		capability: "web-enumeration",
		scenarios: ["penetration-test", "web-security", "vulnerability-research", "ctf"],
		ctfKinds: ["web"],
		stages: ["recon", "analysis"],
		network: true,
		localArtifact: false,
		goalRelevance: 0.9,
		informationGain: 0.8,
		confidence: 0.85,
		cost: 0.2,
		description: "Fingerprint authorized HTTP services",
		expectedEvidence: ["HTTP status", "title", "technology fingerprint"],
	},
	{
		tool: "curl",
		capability: "web-request-analysis",
		scenarios: ["penetration-test", "web-security", "vulnerability-research", "ctf"],
		ctfKinds: ["web"],
		stages: ["recon", "analysis", "verification"],
		network: true,
		localArtifact: false,
		goalRelevance: 0.88,
		informationGain: 0.72,
		confidence: 0.9,
		cost: 0.12,
		description: "Inspect a bounded HTTP request/response",
		expectedEvidence: ["HTTP behavior", "response delta"],
	},
	{
		tool: "browser",
		capability: "browser-state-verification",
		scenarios: ["penetration-test", "web-security", "vulnerability-research", "ctf"],
		ctfKinds: ["web"],
		stages: ["analysis", "verification"],
		network: true,
		localArtifact: false,
		goalRelevance: 0.86,
		informationGain: 0.74,
		confidence: 0.84,
		cost: 0.3,
		description: "Inspect client-side state through the isolated browser service",
		expectedEvidence: ["DOM state", "browser network behavior", "client-side verification"],
	},
	{
		tool: "ffuf",
		capability: "web-enumeration",
		scenarios: ["web-security", "penetration-test", "ctf"],
		ctfKinds: ["web"],
		stages: ["recon", "analysis"],
		network: true,
		localArtifact: false,
		goalRelevance: 0.78,
		informationGain: 0.82,
		confidence: 0.72,
		cost: 0.42,
		description: "Rate-bounded content discovery using an in-workspace wordlist",
		expectedEvidence: ["previously unknown authorized paths"],
	},
	{
		tool: "nuclei",
		capability: "vulnerability-verification",
		scenarios: ["web-security", "vulnerability-research", "penetration-test", "ctf"],
		ctfKinds: ["web"],
		stages: ["analysis", "verification"],
		network: true,
		localArtifact: false,
		goalRelevance: 0.82,
		informationGain: 0.62,
		confidence: 0.74,
		cost: 0.45,
		description: "Run signed built-in templates as bounded vulnerability evidence",
		expectedEvidence: ["template match requiring independent verification"],
	},
	{
		tool: "file",
		capability: "artifact-triage",
		scenarios: ["incident-response", "reverse-engineering", "vulnerability-research", "ctf"],
		stages: ["understanding", "planning", "analysis"],
		network: false,
		localArtifact: true,
		goalRelevance: 0.92,
		informationGain: 0.82,
		confidence: 0.96,
		cost: 0.04,
		description: "Identify a local artifact before deeper analysis",
		expectedEvidence: ["artifact format", "hash-backed provenance"],
	},
	{
		tool: "strings",
		capability: "artifact-triage",
		scenarios: ["incident-response", "reverse-engineering", "vulnerability-research", "ctf"],
		stages: ["planning", "analysis"],
		network: false,
		localArtifact: true,
		goalRelevance: 0.82,
		informationGain: 0.72,
		confidence: 0.9,
		cost: 0.08,
		description: "Extract printable strings from a local artifact",
		expectedEvidence: ["static indicators", "embedded strings"],
	},
	{
		tool: "readelf",
		capability: "binary-triage",
		scenarios: ["reverse-engineering", "vulnerability-research", "ctf"],
		ctfKinds: ["pwn", "reverse"],
		stages: ["analysis", "verification"],
		network: false,
		localArtifact: true,
		goalRelevance: 0.92,
		informationGain: 0.84,
		confidence: 0.92,
		cost: 0.1,
		description: "Inspect ELF structure and exploit mitigations without execution",
		expectedEvidence: ["architecture", "ELF type", "NX/PIE/RELRO/canary indicators"],
	},
	{
		tool: "objdump",
		capability: "reverse-analysis",
		scenarios: ["reverse-engineering", "vulnerability-research", "ctf"],
		ctfKinds: ["pwn", "reverse"],
		stages: ["analysis"],
		network: false,
		localArtifact: true,
		goalRelevance: 0.86,
		informationGain: 0.78,
		confidence: 0.82,
		cost: 0.25,
		description: "Inspect disassembly without executing the artifact",
		expectedEvidence: ["control-flow and instruction evidence"],
	},
	{
		tool: "binwalk",
		capability: "forensics-triage",
		scenarios: ["incident-response", "reverse-engineering", "ctf"],
		ctfKinds: ["forensics", "misc", "reverse"],
		stages: ["analysis"],
		network: false,
		localArtifact: true,
		goalRelevance: 0.82,
		informationGain: 0.8,
		confidence: 0.82,
		cost: 0.16,
		description: "Scan embedded artifact signatures without extraction",
		expectedEvidence: ["embedded content signatures"],
	},
	{
		tool: "exiftool",
		capability: "forensics-triage",
		scenarios: ["incident-response", "ctf"],
		ctfKinds: ["forensics", "misc"],
		stages: ["understanding", "analysis"],
		network: false,
		localArtifact: true,
		goalRelevance: 0.8,
		informationGain: 0.76,
		confidence: 0.9,
		cost: 0.08,
		description: "Inspect structured artifact metadata",
		expectedEvidence: ["metadata indicators"],
	},
] as const;

export interface GeneratedCandidateSet {
	candidates: CandidateActionInput[];
	gaps: string[];
}

function scenarioMatches(template: CandidateTemplate, scenario: SecurityScenario, ctfKind?: CtfChallengeKind): boolean {
	if (!template.scenarios.includes(scenario)) return false;
	if (scenario !== "ctf" || !template.ctfKinds?.length) return true;
	return ctfKind !== undefined && template.ctfKinds.includes(ctfKind);
}

function firstArtifactPath(state: SecurityState): string | undefined {
	return state.task?.assets.find((asset) => asset.path)?.path;
}

function selectedAction(state: SecurityState, decisionIndex: number): CandidateActionInput | undefined {
	const decision = state.decisions[decisionIndex];
	return decision?.candidates.find((candidate) => candidate.id === decision.selectedActionId);
}

function wasSuccessfullyCompleted(state: SecurityState, candidateId: string): boolean {
	return state.decisions.some(
		(decision, index) => decision.resultStatus === "succeeded" && selectedAction(state, index)?.id === candidateId,
	);
}

function failedStrategyCount(state: SecurityState, candidate: CandidateActionInput): number {
	const key = strategyKey(candidate);
	return state.decisions.filter((decision, index) => {
		const action = selectedAction(state, index);
		return decision.resultStatus === "failed" && action !== undefined && strategyKey(action) === key;
	}).length;
}

function attachPathKey(state: SecurityState, candidate: CandidateActionInput): CandidateActionInput | undefined {
	const defaultInput = buildDefaultActionInput(state, candidate);
	if (!defaultInput.ok || !defaultInput.input) return undefined;
	return {
		...candidate,
		pathKey: createActionPathKey({
			tool: candidate.tool,
			capability: candidate.capability,
			targets: candidate.targets,
			normalizedInput: defaultInput.input,
		}),
	};
}

function isBlocked(state: SecurityState, candidate: CandidateActionInput): boolean {
	const board = state.searchBoard ?? createEmptySearchBoard();
	if (candidate.pathKey && blockedPathKeys(board).has(candidate.pathKey)) return true;
	if (candidate.intentId) {
		const intent = board.intents.find((item) => item.id === candidate.intentId);
		if (intent && intent.status !== "open") return true;
	}
	return false;
}

function candidateFromIntent(state: SecurityState, intent: SearchIntent): CandidateActionInput | undefined {
	if (!getSecurityToolAdapter(intent.tool)) return undefined;
	const metadata = getSecurityToolMetadata(intent.tool);
	const candidate: CandidateActionInput = {
		id: `auto-${intent.tool}-${intent.capability}`,
		tool: intent.tool,
		capability: intent.capability,
		description: intent.statement,
		goalRelevance: 0.88,
		informationGain: 0.8,
		confidence: 0.82,
		cost: 0.2,
		preconditions: [...(metadata?.preconditions ?? [])],
		targets: intent.targets,
		expectedEvidence: [],
		successCriteria: state.task?.successCriteria.slice(0, 6) ?? [],
		stopConditions: ["scope changes", "budget exhausted", "evidence contradicts the action premise"],
		intentId: intent.id,
		pathKey: intent.pathKey,
	};
	return attachPathKey(state, candidate);
}

function finalizeCandidateSet(
	state: SecurityState,
	scenario: SecurityScenario,
	ctfKind: CtfChallengeKind | undefined,
	scopeTargets: string[],
	artifactPath: string | undefined,
	candidates: CandidateActionInput[],
	gaps: string[],
): GeneratedCandidateSet {
	const networkRelevant = TEMPLATES.some(
		(template) => template.network && scenarioMatches(template, scenario, ctfKind),
	);
	const artifactRelevant = TEMPLATES.some(
		(template) => template.localArtifact && scenarioMatches(template, scenario, ctfKind),
	);
	if (networkRelevant && scopeTargets.length === 0)
		gaps.push("Network-capable strategies are withheld until explicit authorized scope is set");
	if (artifactRelevant && !artifactPath)
		gaps.push("Local artifact strategies require an input asset with an in-workspace path");
	if (scenario === "ctf" && (ctfKind === "crypto" || ctfKind === "unknown"))
		gaps.push(
			"No arbitrary computation adapter is auto-generated; use bounded reasoning/MCP capabilities and keep execution under the parent SecAgent policy",
		);
	if (candidates.length === 0 && state.decisions.some((decision) => decision.resultStatus === "succeeded"))
		gaps.push(
			"All deterministic candidates for this state are already completed or exhausted; add evidence/hypotheses, change stage, or finish the task",
		);
	return { candidates, gaps: [...new Set(gaps)] };
}

export function generateCandidateActions(state: SecurityState): GeneratedCandidateSet {
	const scenario = state.task?.scenario ?? "penetration-test";
	const ctfKind = state.ctfProfile?.kind;
	const artifactPath = firstArtifactPath(state);
	const scopeTargets = state.scope.targets.map((target) => target.value);
	const gaps: string[] = [];
	const board = state.searchBoard ?? createEmptySearchBoard();
	const openIntents = openSearchIntents(board);
	if (openIntents.length > 0) {
		const fromIntents = openIntents.flatMap((intent) => {
			const candidate = candidateFromIntent(state, intent);
			if (!candidate) return [];
			if (failedStrategyCount(state, candidate) >= 2) return [];
			if (isBlocked(state, candidate)) return [];
			const defaultInput = buildDefaultActionInput(state, candidate);
			if (!defaultInput.ok) {
				if (defaultInput.reason) gaps.push(`${candidate.tool}: ${defaultInput.reason}`);
				return [];
			}
			return [candidate];
		});
		if (fromIntents.length > 0)
			return finalizeCandidateSet(state, scenario, ctfKind, scopeTargets, artifactPath, fromIntents, gaps);
		gaps.push("Open intents exist but none currently map to a runnable audited adapter");
	}

	const candidates = TEMPLATES.flatMap((template) => {
		if (!scenarioMatches(template, scenario, ctfKind)) return [];
		if (!getSecurityToolAdapter(template.tool)) return [];
		if (template.network && scopeTargets.length === 0) return [];
		if (template.localArtifact && !artifactPath) return [];
		const metadata = getSecurityToolMetadata(template.tool);
		const stageMatch = template.stages.includes(state.stage);
		const candidate: CandidateActionInput = {
			id: `auto-${template.tool}-${template.capability}`,
			tool: template.tool,
			capability: template.capability,
			description: template.description,
			goalRelevance: Math.max(0, template.goalRelevance - (stageMatch ? 0 : 0.16)),
			informationGain: template.informationGain,
			confidence: template.confidence,
			cost: template.cost,
			preconditions: [...(metadata?.preconditions ?? [])],
			targets: template.network ? [...scopeTargets] : artifactPath ? [artifactPath] : undefined,
			expectedEvidence: [...template.expectedEvidence],
			successCriteria: state.task?.successCriteria.slice(0, 6) ?? [],
			stopConditions: ["scope changes", "budget exhausted", "evidence contradicts the action premise"],
		};
		const withPath = attachPathKey(state, candidate);
		if (!withPath) {
			const defaultInput = buildDefaultActionInput(state, candidate);
			if (defaultInput.reason) gaps.push(`${candidate.tool}: ${defaultInput.reason}`);
			return [];
		}
		if (wasSuccessfullyCompleted(state, withPath.id)) return [];
		if (failedStrategyCount(state, withPath) >= 2) return [];
		if (isBlocked(state, withPath)) return [];
		return [withPath];
	});
	return finalizeCandidateSet(state, scenario, ctfKind, scopeTargets, artifactPath, candidates, gaps);
}
