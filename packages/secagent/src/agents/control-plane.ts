import { randomUUID } from "node:crypto";
import type {
	SecurityAgentRole,
	SecurityDelegationRecord,
	SecurityScenario,
	SecurityState,
} from "../core/types.ts";

export interface AgentTaskEnvelope {
	taskId: string;
	parentDecisionId?: string;
	role: SecurityAgentRole;
	objective: string;
	scenario: SecurityScenario;
	authorizedTargets: string[];
	authorizationSource?: string;
	constraints: string[];
	successCriteria: string[];
	availableEvidenceIds: string[];
	requiredEvidence: string[];
	budget: { maxTurns: number; maxToolCalls: number; deadlineAt?: string };
}

export interface AgentDispatchRecommendation {
	role: SecurityAgentRole;
	reason: string;
	envelope: AgentTaskEnvelope;
}

function roleForState(state: SecurityState): { role: SecurityAgentRole; reason: string } {
	const scenario = state.task?.scenario;
	if (scenario === "ctf" || state.ctfProfile) return { role: "ctf-specialist", reason: `CTF profile ${state.ctfProfile?.kind ?? "unknown"} benefits from a challenge-focused worker` };
	if (scenario === "web-security") return { role: "sec-web", reason: "Web-security scenario requires HTTP-centric evidence collection" };
	if (scenario === "reverse-engineering") return { role: "sec-reverse", reason: "Reverse-engineering scenario requires artifact-centric static analysis" };
	if (scenario === "vulnerability-research") return { role: "sec-vuln", reason: "Vulnerability research requires reproduction and verification" };
	if (scenario === "incident-response") return { role: "sec-analysis", reason: "Incident response prioritizes evidence correlation and artifact analysis" };
	if (state.stage === "recon") return { role: "sec-recon", reason: "Recon stage prioritizes bounded discovery" };
	if (state.stage === "response") return { role: "sec-response", reason: "Response stage requires remediation-oriented execution" };
	return { role: "sec-analysis", reason: "General analysis worker best matches the current state" };
}

export function recommendAgentDispatch(state: SecurityState, objective?: string, parentDecisionId?: string): AgentDispatchRecommendation {
	const selected = roleForState(state);
	const remainingTools = Math.max(1, state.budget.limits.maxToolCalls - state.budget.usage.toolCallsUsed);
	const envelope: AgentTaskEnvelope = {
		taskId: randomUUID(),
		parentDecisionId,
		role: selected.role,
		objective: objective?.trim() || state.goal || "Advance the current authorized security task",
		scenario: state.task?.scenario ?? "penetration-test",
		authorizedTargets: state.scope.targets.map((target) => target.value),
		authorizationSource: state.scope.authorizationSource,
		constraints: [...(state.task?.constraints ?? []), "Do not widen scope", "Return structured evidence references"],
		successCriteria: [...(state.task?.successCriteria ?? [])],
		availableEvidenceIds: state.evidence.slice(-24).map((item) => item.id),
		requiredEvidence: state.ctfProfile?.expectedEvidence.slice(0, 6) ?? [],
		budget: {
			maxTurns: Math.min(12, Math.max(3, Math.ceil(remainingTools / 6))),
			maxToolCalls: Math.min(24, remainingTools),
			deadlineAt: state.budget.limits.deadlineAt,
		},
	};
	return { role: selected.role, reason: selected.reason, envelope };
}

export function delegationRecord(recommendation: AgentDispatchRecommendation, parentDecisionId?: string): SecurityDelegationRecord {
	return {
		id: recommendation.envelope.taskId,
		role: recommendation.role,
		objective: recommendation.envelope.objective,
		parentDecisionId,
		status: "planned",
		evidenceIds: [],
		createdAt: new Date().toISOString(),
	};
}
