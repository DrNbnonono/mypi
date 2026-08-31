import { randomUUID } from "node:crypto";
import { StringEnum } from "@earendil-works/pi-ai";
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
import { defineSecAgentExtension, type SecAgentExtensionAPI, type SecAgentInlineExtension } from "./host-contract.ts";
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

interface TextToolResult<T> {
	content: Array<{ type: "text"; text: string }>;
	details: T;
	isError?: boolean;
}
function textResult<T>(text: string, details: T): TextToolResult<T> {
	return { content: [{ type: "text", text }], details };
}
function errorResult(text: string): TextToolResult<undefined> {
	return { content: [{ type: "text", text }], isError: true, details: undefined };
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

export function createSecAgentCompetitionExtension(runtime: SecAgentRuntime): SecAgentInlineExtension {
	return defineSecAgentExtension("secagent-competition", (pi) => registerCompetitionTools(pi, runtime));
}

function registerCompetitionTools(pi: SecAgentExtensionAPI, runtime: SecAgentRuntime): void {
	pi.on("before_agent_start", async (event) => ({
		systemPrompt: `${event.systemPrompt}\n\n${[
			"SecAgent competition protocol v2:",
			"- Treat execution as bounded state-space search: evidence is confirmed state; hypotheses are exploration directions.",
			"- Use security_plan for meaningful choices and re-plan after failure, contradiction, drift, or repeated strategy failure.",
			"- Use security_evidence and its verifier before creating findings; a scanner result alone is not a confirmed vulnerability.",
			"- Run security_observer periodically for sidecar drift/stall detection, compact operational memory, and external completion checks.",
			"- For authorized CTF tasks, profile the challenge with security_ctf and use the recommended capability family.",
			"- Use security_delegate for bounded specialist work; specialists may not widen scope, authorization, or budget.",
		].join("\n")}`,
	}));

	pi.registerTool<typeof PlanParams, SecurityDecision | undefined>({
		name: "security_plan",
		label: "Security Plan",
		description:
			"Rank candidate actions using goal progress, information gain, confidence, risk, novelty, and budget pressure.",
		promptSnippet: "security_plan: persist an auditable plan or replan decision",
		parameters: PlanParams,
		async execute(_id, params) {
			const state = runtime.snapshot().state;
			const decisionBudget = assessBudget(state.budget, "decision");
			if (!decisionBudget.allowed) return errorResult(`Blocked: ${decisionBudget.reason}`);
			const assessment = assessReplanNeed(state);
			let replanId: string | undefined;
			if (assessment.required) {
				const replanBudget = assessBudget(state.budget, "replan");
				if (!replanBudget.allowed) return errorResult(`Blocked: ${replanBudget.reason}`);
				const replan = createReplanRecord(assessment);
				if (replan) {
					replanId = replan.id;
					runtime.append({ type: "replan_recorded", replan, createdAt: replan.createdAt });
					runtime.append({
						type: "budget_consumed",
						resource: "replan",
						amount: 1,
						createdAt: new Date().toISOString(),
					});
				}
			}
			const current = runtime.snapshot().state;
			const ranked = rankCandidates(params.candidates.map(candidateInput), { state: current });
			const selected = ranked[0];
			if (!selected) return errorResult("No candidate action was supplied");
			const decision: SecurityDecision = {
				id: randomUUID(),
				createdAt: new Date().toISOString(),
				goal: current.goal,
				stage: current.stage,
				evidenceIds: params.evidenceIds ?? [],
				candidates: ranked,
				selectedActionId: selected.id,
				rationale:
					params.rationale?.trim() || `Selected highest utility candidate; score=${selected.score.toFixed(4)}`,
				expectedResult: params.expectedResult?.trim() || selected.expectedEvidence?.join("; "),
				resultStatus: "pending",
				planRevision: current.decisions.length + 1,
				attempt: current.decisions.filter((item) => item.goal === current.goal).length + 1,
				replanId,
				budgetSnapshot: structuredClone(current.budget),
			};
			runtime.append({ type: "decision_recorded", decision, createdAt: decision.createdAt });
			runtime.append({
				type: "budget_consumed",
				resource: "decision",
				amount: 1,
				createdAt: new Date().toISOString(),
			});
			return textResult(
				`Selected ${selected.id} (${selected.tool}) score=${selected.score.toFixed(4)}${replanId ? ` after replan ${replanId}` : ""}`,
				decision,
			);
		},
	});

	pi.registerTool<typeof EvidenceParams, unknown>({
		name: "security_evidence",
		label: "Security Evidence",
		description: "Build a provenance graph, verify hypotheses, and enforce verified findings.",
		promptSnippet: "security_evidence: connect facts to hypotheses and verify them",
		parameters: EvidenceParams,
		async execute(_id, params) {
			const state = runtime.snapshot().state;
			if (params.action === "show_graph")
				return textResult(
					`evidence=${state.evidence.length}; edges=${state.evidenceGraph.edges.length}; graphErrors=${graphIntegrityErrors(state).length}`,
					state.evidenceGraph,
				);
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
				return textResult(`Evidence ${evidence.id} recorded`, evidence);
			}
			if (params.action === "add_hypothesis" && params.summary?.trim()) {
				const hypothesis = createHypothesis(params.summary);
				runtime.append({ type: "hypothesis_recorded", hypothesis, createdAt: hypothesis.createdAt });
				return textResult(`Hypothesis ${hypothesis.id} recorded`, hypothesis);
			}
			if (
				params.action === "link" &&
				params.fromEvidenceId &&
				params.relation &&
				(params.toEvidenceId || params.toHypothesisId)
			) {
				try {
					const edge = createEvidenceEdge({
						fromEvidenceId: params.fromEvidenceId,
						toEvidenceId: params.toEvidenceId,
						toHypothesisId: params.toHypothesisId,
						relation: params.relation as EvidenceRelation,
						confidence: params.confidence,
					});
					runtime.append({ type: "evidence_linked", edge, createdAt: edge.createdAt });
					return textResult(`Evidence edge ${edge.id} recorded`, edge);
				} catch (error) {
					return errorResult(`Error: ${error instanceof Error ? error.message : String(error)}`);
				}
			}
			if (params.action === "verify" && params.toHypothesisId) {
				try {
					const verification = verifyHypothesis(state, params.toHypothesisId);
					runtime.append({ type: "hypothesis_verified", verification, createdAt: verification.createdAt });
					return textResult(`${verification.status}: ${verification.reason}`, verification);
				} catch (error) {
					return errorResult(`Error: ${error instanceof Error ? error.message : String(error)}`);
				}
			}
			if (params.action === "create_finding" && params.verificationId && params.summary?.trim()) {
				const gate = verifiedFindingGate(state, params.verificationId);
				if (!gate.allowed) return errorResult(`Blocked: ${gate.reason}`);
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
				return textResult(`Verified finding ${finding.id} recorded`, finding);
			}
			return errorResult(`Required fields missing for ${params.action}`);
		},
	});

	pi.registerTool<typeof BudgetParams, SecurityState["budget"]>({
		name: "security_budget",
		label: "Security Budget",
		description: "Configure bounded decision, tool-call and replan budgets.",
		promptSnippet: "security_budget: bound autonomous execution",
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
			return textResult(JSON.stringify(budget), budget);
		},
	});

	pi.registerTool<typeof ObserverParams, unknown>({
		name: "security_observer",
		label: "Security Observer",
		description: "Sidecar supervision for drift/stall, compact memory and external termination checks.",
		promptSnippet: "security_observer: supervise progress without taking over execution",
		parameters: ObserverParams,
		async execute() {
			const state = runtime.snapshot().state;
			const signals = observeSecurityState(state);
			const existing = new Set(state.observerSignals.map((item) => `${item.kind}:${item.reason}`));
			for (const item of signals)
				if (!existing.has(`${item.kind}:${item.reason}`))
					runtime.append({ type: "observer_signal", signal: item, createdAt: item.createdAt });
			const current = runtime.snapshot().state;
			const details = { signals, memory: buildOperationalMemory(current), termination: assessTermination(current) };
			return textResult(JSON.stringify(details, null, 2), details);
		},
	});

	pi.registerTool<typeof CtfParams, unknown>({
		name: "security_ctf",
		label: "Security CTF",
		description: "Profile an authorized CTF and expose capability-oriented guidance.",
		promptSnippet: "security_ctf: classify the challenge and select capability families",
		parameters: CtfParams,
		async execute(_id, params) {
			if (params.action === "profile") {
				const profile = createCtfChallengeProfile(
					runtime.snapshot().state,
					params.kind as CtfChallengeKind | undefined,
					params.description,
				);
				runtime.append({ type: "ctf_profiled", profile, createdAt: profile.createdAt });
				return textResult(JSON.stringify(profile, null, 2), profile);
			}
			const profile = runtime.snapshot().state.ctfProfile;
			if (params.action === "capabilities") {
				const capabilities = capabilitiesForCtf(
					(params.kind as CtfChallengeKind | undefined) ?? profile?.kind ?? "unknown",
				);
				return textResult(JSON.stringify(capabilities, null, 2), capabilities);
			}
			return textResult(profile ? JSON.stringify(profile, null, 2) : "CTF profile is not set", profile);
		},
	});

	pi.registerTool<typeof DelegateParams, unknown>({
		name: "security_delegate",
		label: "Security Delegate",
		description: "Create a bounded specialist task envelope from scope, evidence and budget.",
		promptSnippet: "security_delegate: dispatch a bounded specialist",
		parameters: DelegateParams,
		async execute(_id, params) {
			const recommendation = recommendAgentDispatch(
				runtime.snapshot().state,
				params.objective,
				params.parentDecisionId,
			);
			const delegation = delegationRecord(recommendation, params.parentDecisionId);
			runtime.append({ type: "delegation_recorded", delegation, createdAt: delegation.createdAt });
			return textResult(JSON.stringify(recommendation, null, 2), recommendation);
		},
	});

	pi.on("tool_call", async (event) => {
		if (event.toolName === "security_decide")
			return { block: true, reason: "Use security_plan so novelty, budget and replan state are recorded." };
		if (event.toolName === "security_state") {
			const input = event.input as Record<string, unknown>;
			if (
				input.action === "add_finding" ||
				input.action === "add_hypothesis" ||
				input.action === "reject_hypothesis"
			)
				return {
					block: true,
					reason: "Use security_evidence so hypotheses and findings pass through the verifier.",
				};
		}
		return undefined;
	});
}
