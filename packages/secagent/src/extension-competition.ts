import { randomUUID } from "node:crypto";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { delegationRecord, recommendAgentDispatch } from "./agents/control-plane.ts";
import { assessBudget, normalizeBudgetLimits } from "./core/budget.ts";
import { createEvidenceEdge, createHypothesis, graphIntegrityErrors } from "./core/evidence-graph.ts";
import { assessTermination, buildOperationalMemory, observeSecurityState } from "./core/observer.ts";
import { assessReplanNeed, createReplanRecord, rankCandidates } from "./core/planner.ts";
import type {
	CandidateActionInput,
	CtfChallengeKind,
	EvidenceKind,
	EvidenceRelation,
	SecurityDecision,
	SecurityEvidence,
	SecurityFinding,
	SecurityState,
} from "./core/types.ts";
import { verifiedFindingGate, verifyHypothesis } from "./core/verifier.ts";
import { capabilitiesForCtf, createCtfChallengeProfile } from "./ctf/capabilities.ts";
import type { SecAgentRuntime } from "./runtime.ts";

const CandidateParams = Type.Object({
	id: Type.String({ minLength: 1 }),
	tool: Type.String({ minLength: 1 }),
	description: Type.String({ minLength: 1 }),
	goalRelevance: Type.Number({ minimum: 0, maximum: 1 }),
	informationGain: Type.Number({ minimum: 0, maximum: 1 }),
	confidence: Type.Number({ minimum: 0, maximum: 1 }),
	riskHint: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
	cost: Type.Number({ minimum: 0, maximum: 1 }),
	preconditions: Type.Optional(Type.Array(Type.String())),
	capability: Type.Optional(Type.String()),
	targets: Type.Optional(Type.Array(Type.String())),
	expectedEvidence: Type.Optional(Type.Array(Type.String())),
	successCriteria: Type.Optional(Type.Array(Type.String())),
	stopConditions: Type.Optional(Type.Array(Type.String())),
	fallbackActionIds: Type.Optional(Type.Array(Type.String())),
	estimatedDurationMs: Type.Optional(Type.Number({ minimum: 0 })),
});

const PlanParams = Type.Object({
	candidates: Type.Array(CandidateParams, { minItems: 2, maxItems: 8 }),
	evidenceIds: Type.Optional(Type.Array(Type.String())),
	rationale: Type.Optional(Type.String()),
	expectedResult: Type.Optional(Type.String()),
});

const EvidenceParams = Type.Object({
	action: StringEnum(["add_evidence", "add_hypothesis", "link", "verify", "create_finding", "show_graph"] as const),
	kind: Type.Optional(StringEnum(["observation", "artifact", "indicator", "finding"] as const)),
	summary: Type.Optional(Type.String()),
	source: Type.Optional(Type.String()),
	sha256: Type.Optional(Type.String()),
	confidence: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
	decisionId: Type.Optional(Type.String()),
	fromEvidenceId: Type.Optional(Type.String()),
	toEvidenceId: Type.Optional(Type.String()),
	toHypothesisId: Type.Optional(Type.String()),
	relation: Type.Optional(StringEnum(["supports", "contradicts", "derived-from", "duplicates", "verifies"] as const)),
	verificationId: Type.Optional(Type.String()),
	severity: Type.Optional(StringEnum(["info", "low", "medium", "high", "critical"] as const)),
	remediation: Type.Optional(Type.String()),
});

const BudgetParams = Type.Object({
	action: StringEnum(["show", "set"] as const),
	maxDecisions: Type.Optional(Type.Number({ minimum: 1, maximum: 1000 })),
	maxToolCalls: Type.Optional(Type.Number({ minimum: 1, maximum: 10000 })),
	maxReplans: Type.Optional(Type.Number({ minimum: 1, maximum: 1000 })),
	deadlineAt: Type.Optional(Type.String()),
});

const ObserverParams = Type.Object({ action: StringEnum(["inspect"] as const) });
const CtfParams = Type.Object({
	action: StringEnum(["profile", "show", "capabilities"] as const),
	kind: Type.Optional(StringEnum(["web", "pwn", "reverse", "crypto", "forensics", "misc", "unknown"] as const)),
	description: Type.Optional(Type.String()),
});
const DelegateParams = Type.Object({
	objective: Type.Optional(Type.String()),
	parentDecisionId: Type.Optional(Type.String()),
});

function stateText(state: SecurityState): string {
	return [
		`revision=${state.revision}`,
		`decisions=${state.decisions.length}`,
		`replans=${state.replans.length}`,
		`evidence=${state.evidence.length}`,
		`hypotheses=${state.evidenceGraph.hypotheses.length}`,
		`verifications=${state.evidenceGraph.verifications.length}`,
		`verifiedFindings=${state.findings.filter((finding) => finding.verified).length}`,
		`budget=${state.budget.usage.decisionsUsed}/${state.budget.limits.maxDecisions} decisions, ${state.budget.usage.toolCallsUsed}/${state.budget.limits.maxToolCalls} tools, ${state.budget.usage.replansUsed}/${state.budget.limits.maxReplans} replans`,
	].join("\n");
}

function candidateInput(value: {
	id: string;
	tool: string;
	description: string;
	goalRelevance: number;
	informationGain: number;
	confidence: number;
	riskHint?: number;
	cost: number;
	preconditions?: string[];
	capability?: string;
	targets?: string[];
	expectedEvidence?: string[];
	successCriteria?: string[];
	stopConditions?: string[];
	fallbackActionIds?: string[];
	estimatedDurationMs?: number;
}): CandidateActionInput {
	return { ...value, preconditions: value.preconditions ?? [] };
}

export function createSecAgentCompetitionExtension(runtime: SecAgentRuntime): InlineExtension {
	return { name: "secagent-competition", factory: (pi) => registerCompetitionTools(pi, runtime) };
}

function registerCompetitionTools(pi: ExtensionAPI, runtime: SecAgentRuntime): void {
	pi.on("before_agent_start", async (event) => ({
		systemPrompt: `${event.systemPrompt}\n\n${[
			"SecAgent competition protocol v2:",
			"- Treat the run as state-space search: confirmed facts are evidence; exploration directions are hypotheses/intents.",
			"- Use security_plan for meaningful action selection. After failure, contradiction, or observer drift, re-plan and prefer a materially different strategy.",
			"- Use security_evidence to link evidence to hypotheses and verify before creating findings. A scanner result alone is not a confirmed vulnerability.",
			"- Use security_observer periodically. Its sidecar role supervises drift/stall and externalizes completion checks without taking over execution.",
			"- For CTF tasks, run security_ctf profile early, then prioritize the recommended capability family while staying inside the declared challenge scope.",
			"- Keep raw tool output out of long-term reasoning: preserve artifacts/evidence, then operate on compact facts, ideas, failures and constraints.",
			"- Use security_delegate to create bounded specialist envelopes; sub-agents may not widen scope, budget, or authorization.",
		].join("\n")}`,
	}));

	pi.registerTool<typeof PlanParams, SecurityDecision | undefined>({
		name: "security_plan",
		label: "Security Plan",
		description: "Rank candidate actions with risk, information gain, novelty and budget pressure; record re-planning when required.",
		promptSnippet: "security_plan: choose among alternatives and persist the decision/replan trace",
		parameters: PlanParams,
		async execute(_id, params) {
			const state = runtime.snapshot().state;
			const budget = assessBudget(state.budget, "decision");
			if (!budget.allowed)
				return { content: [{ type: "text", text: `Blocked: ${budget.reason}` }], isError: true, details: undefined };
			const assessment = assessReplanNeed(state);
			let replanId: string | undefined;
			if (assessment.required) {
				const replanBudget = assessBudget(state.budget, "replan");
				if (!replanBudget.allowed)
					return { content: [{ type: "text", text: `Blocked: ${replanBudget.reason}` }], isError: true, details: undefined };
				const replan = createReplanRecord(assessment);
				if (replan) {
					replanId = replan.id;
					runtime.append({ type: "replan_recorded", replan, createdAt: replan.createdAt });
					runtime.append({ type: "budget_consumed", resource: "replan", amount: 1, createdAt: new Date().toISOString() });
				}
			}
			const current = runtime.snapshot().state;
			const ranked = rankCandidates(params.candidates.map(candidateInput), { state: current });
			const selected = ranked[0];
			if (!selected)
				return { content: [{ type: "text", text: "No candidate action was supplied" }], isError: true, details: undefined };
			const decision: SecurityDecision = {
				id: randomUUID(),
				createdAt: new Date().toISOString(),
				goal: current.goal,
				stage: current.stage,
				evidenceIds: params.evidenceIds ?? [],
				candidates: ranked,
				selectedActionId: selected.id,
				rationale: params.rationale?.trim() || `Selected highest utility candidate; score=${selected.score.toFixed(4)}`,
				expectedResult: params.expectedResult?.trim() || selected.expectedEvidence?.join("; "),
				resultStatus: "pending",
				planRevision: current.decisions.length + 1,
				attempt: current.decisions.filter((item) => item.goal === current.goal).length + 1,
				replanId,
				budgetSnapshot: structuredClone(current.budget),
			};
			runtime.append({ type: "decision_recorded", decision, createdAt: decision.createdAt });
			runtime.append({ type: "budget_consumed", resource: "decision", amount: 1, createdAt: new Date().toISOString() });
			return {
				content: [{ type: "text", text: `Selected ${selected.id} (${selected.tool}) score=${selected.score.toFixed(4)}${replanId ? ` after replan ${replanId}` : ""}` }],
				details: decision,
			};
		},
	});

	pi.registerTool<typeof EvidenceParams, unknown>({
		name: "security_evidence",
		label: "Security Evidence",
		description: "Build an evidence graph, verify hypotheses, and create findings only after the verification gate passes.",
		promptSnippet: "security_evidence: persist facts and prove or contradict hypotheses",
		parameters: EvidenceParams,
		async execute(_id, params) {
			const state = runtime.snapshot().state;
			if (params.action === "show_graph") {
				return { content: [{ type: "text", text: `${stateText(state)}\ngraphErrors=${graphIntegrityErrors(state).length}` }], details: state.evidenceGraph };
			}
			if (params.action === "add_evidence" && params.summary?.trim()) {
				const evidence: SecurityEvidence = {
					id: randomUUID(),
					kind: (params.kind ?? "observation") as EvidenceKind,
					summary: params.summary.trim(),
					source: params.source?.trim() || undefined,
					sha256: params.sha256?.trim() || undefined,
					confidence: params.confidence ?? 0.8,
					decisionIds: params.decisionId ? [params.decisionId] : undefined,
					createdAt: new Date().toISOString(),
				};
				runtime.append({ type: "evidence_added", evidence, createdAt: evidence.createdAt });
				return { content: [{ type: "text", text: `Evidence ${evidence.id} recorded` }], details: evidence };
			}
			if (params.action === "add_hypothesis" && params.summary?.trim()) {
				const hypothesis = createHypothesis(params.summary);
				runtime.append({ type: "hypothesis_recorded", hypothesis, createdAt: hypothesis.createdAt });
				return { content: [{ type: "text", text: `Hypothesis ${hypothesis.id} recorded` }], details: hypothesis };
			}
			if (params.action === "link" && params.fromEvidenceId && params.relation && (params.toEvidenceId || params.toHypothesisId)) {
				try {
					const edge = createEvidenceEdge({
						fromEvidenceId: params.fromEvidenceId,
						toEvidenceId: params.toEvidenceId,
						toHypothesisId: params.toHypothesisId,
						relation: params.relation as EvidenceRelation,
						confidence: params.confidence,
					});
					runtime.append({ type: "evidence_linked", edge, createdAt: edge.createdAt });
					return { content: [{ type: "text", text: `Evidence edge ${edge.id} recorded` }], details: edge };
				} catch (error) {
					return { content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
				}
			}
			if (params.action === "verify" && params.toHypothesisId) {
				try {
					const verification = verifyHypothesis(state, params.toHypothesisId);
					runtime.append({ type: "hypothesis_verified", verification, createdAt: verification.createdAt });
					return { content: [{ type: "text", text: `${verification.status}: ${verification.reason}` }], details: verification };
				} catch (error) {
					return { content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
				}
			}
			if (params.action === "create_finding" && params.verificationId && params.summary?.trim()) {
				const gate = verifiedFindingGate(state, params.verificationId);
				if (!gate.allowed) return { content: [{ type: "text", text: `Blocked: ${gate.reason}` }], isError: true };
				const verification = state.evidenceGraph.verifications.find((item) => item.id === params.verificationId);
				const finding: SecurityFinding = {
					id: randomUUID(),
					summary: params.summary.trim(),
					severity: params.severity ?? "medium",
					evidenceIds: verification?.evidenceIds ?? [],
					verificationId: params.verificationId,
					verified: true,
					remediation: params.remediation?.trim() || undefined,
					createdAt: new Date().toISOString(),
				};
				runtime.append({ type: "finding_added", finding, createdAt: finding.createdAt });
				return { content: [{ type: "text", text: `Verified finding ${finding.id} recorded` }], details: finding };
			}
			return { content: [{ type: "text", text: `Error: required fields missing for ${params.action}` }], isError: true };
		},
	});

	pi.registerTool<typeof BudgetParams, SecurityState["budget"]>({
		name: "security_budget",
		label: "Security Budget",
		description: "Configure or inspect bounded decision, tool-call and replan budgets.",
		promptSnippet: "security_budget: keep autonomous execution bounded",
		parameters: BudgetParams,
		async execute(_id, params) {
			if (params.action === "set") {
				const limits = normalizeBudgetLimits({
					maxDecisions: params.maxDecisions,
					maxToolCalls: params.maxToolCalls,
					maxReplans: params.maxReplans,
					deadlineAt: params.deadlineAt,
				});
				runtime.append({ type: "budget_configured", limits, createdAt: new Date().toISOString() });
			}
			const budget = runtime.snapshot().state.budget;
			return { content: [{ type: "text", text: JSON.stringify(budget) }], details: budget };
		},
	});

	pi.registerTool<typeof ObserverParams, unknown>({
		name: "security_observer",
		label: "Security Observer",
		description: "Run sidecar supervision for drift/stall, compact operational memory and external termination checks.",
		promptSnippet: "security_observer: inspect drift, memory and completion state",
		parameters: ObserverParams,
		async execute() {
			const state = runtime.snapshot().state;
			const signals = observeSecurityState(state);
			const existing = new Set(state.observerSignals.map((item) => `${item.kind}:${item.reason}`));
			for (const item of signals) {
				if (!existing.has(`${item.kind}:${item.reason}`)) runtime.append({ type: "observer_signal", signal: item, createdAt: item.createdAt });
			}
			const current = runtime.snapshot().state;
			const details = { signals, memory: buildOperationalMemory(current), termination: assessTermination(current) };
			return { content: [{ type: "text", text: JSON.stringify(details, null, 2) }], details };
		},
	});

	pi.registerTool<typeof CtfParams, unknown>({
		name: "security_ctf",
		label: "Security CTF",
		description: "Classify an authorized CTF challenge and expose capability-oriented strategy guidance.",
		promptSnippet: "security_ctf: profile a CTF challenge before choosing a specialist strategy",
		parameters: CtfParams,
		async execute(_id, params) {
			if (params.action === "profile") {
				const profile = createCtfChallengeProfile(runtime.snapshot().state, params.kind as CtfChallengeKind | undefined, params.description);
				runtime.append({ type: "ctf_profiled", profile, createdAt: profile.createdAt });
				return { content: [{ type: "text", text: JSON.stringify(profile, null, 2) }], details: profile };
			}
			const profile = runtime.snapshot().state.ctfProfile;
			if (params.action === "capabilities") {
				const capabilities = capabilitiesForCtf((params.kind as CtfChallengeKind | undefined) ?? profile?.kind ?? "unknown");
				return { content: [{ type: "text", text: JSON.stringify(capabilities, null, 2) }], details: capabilities };
			}
			return { content: [{ type: "text", text: profile ? JSON.stringify(profile, null, 2) : "CTF profile is not set" }], details: profile };
		},
	});

	pi.registerTool<typeof DelegateParams, unknown>({
		name: "security_delegate",
		label: "Security Delegate",
		description: "Create a bounded specialist task envelope from current scope, evidence and budget.",
		promptSnippet: "security_delegate: choose a bounded specialist and persist the delegation trace",
		parameters: DelegateParams,
		async execute(_id, params) {
			const recommendation = recommendAgentDispatch(runtime.snapshot().state, params.objective, params.parentDecisionId);
			const delegation = delegationRecord(recommendation, params.parentDecisionId);
			runtime.append({ type: "delegation_recorded", delegation, createdAt: delegation.createdAt });
			return { content: [{ type: "text", text: JSON.stringify(recommendation, null, 2) }], details: recommendation };
		},
	});

	pi.on("tool_call", async (event) => {
		if (event.toolName === "security_decide")
			return { block: true, reason: "Use security_plan so novelty, budget and replan state are recorded." };
		if (event.toolName === "security_state") {
			const input = event.input as Record<string, unknown>;
			if (input.action === "add_finding" || input.action === "add_hypothesis" || input.action === "reject_hypothesis")
				return { block: true, reason: "Use security_evidence so hypotheses and findings pass through the evidence graph and verifier." };
		}
		return undefined;
	});
}
