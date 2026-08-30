import { randomUUID } from "node:crypto";
import { planningRiskForTool } from "../tools/registry.ts";
import { budgetPressure } from "./budget.ts";
import type {
	CandidateActionInput,
	ReplanTrigger,
	RiskLevel,
	ScoredAction,
	SecurityDecision,
	SecurityReplanRecord,
	SecurityState,
} from "./types.ts";

const WEIGHTS = {
	goalRelevance: 0.3,
	informationGain: 0.27,
	confidence: 0.18,
	risk: 0.1,
	cost: 0.05,
	novelty: 0.07,
	budget: 0.03,
} as const;

export interface PlannerContext {
	state?: SecurityState;
	previousDecisions?: readonly SecurityDecision[];
}

export interface ReplanAssessment {
	required: boolean;
	decisionId?: string;
	reason?: string;
	trigger?: ReplanTrigger;
}

function clamp01(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.max(0, Math.min(1, value));
}

function selectedTool(decision: SecurityDecision): string | undefined {
	return decision.candidates.find((candidate) => candidate.id === decision.selectedActionId)?.tool.toLowerCase();
}

function noveltyPenalty(action: CandidateActionInput, decisions: readonly SecurityDecision[]): number {
	const recent = decisions.slice(-4);
	let repeated = 0;
	for (const decision of recent) {
		if (selectedTool(decision) !== action.tool.toLowerCase()) continue;
		if (decision.resultStatus === "failed" || decision.resultStatus === "contradicted") repeated += 1;
	}
	return clamp01(repeated / 3);
}

export function scoreCandidate(action: CandidateActionInput, context: PlannerContext = {}): ScoredAction {
	const goalRelevance = clamp01(action.goalRelevance);
	const informationGain = clamp01(action.informationGain);
	const confidence = clamp01(action.confidence);
	const risk = planningRiskForTool(action.tool, action.riskHint);
	const cost = clamp01(action.cost);
	const decisions = context.previousDecisions ?? context.state?.decisions ?? [];
	const novelty = noveltyPenalty(action, decisions);
	const budget = context.state ? budgetPressure(context.state.budget) * cost : 0;
	const score =
		goalRelevance * WEIGHTS.goalRelevance +
		informationGain * WEIGHTS.informationGain +
		confidence * WEIGHTS.confidence -
		risk * WEIGHTS.risk -
		cost * WEIGHTS.cost -
		novelty * WEIGHTS.novelty -
		budget * WEIGHTS.budget;
	return {
		...action,
		goalRelevance,
		informationGain,
		confidence,
		risk,
		cost,
		noveltyPenalty: Math.round(novelty * 10000) / 10000,
		budgetPenalty: Math.round(budget * 10000) / 10000,
		score: Math.round(score * 10000) / 10000,
	};
}

export function rankCandidates(candidates: CandidateActionInput[], context: PlannerContext = {}): ScoredAction[] {
	return candidates.map((candidate) => scoreCandidate(candidate, context)).sort((left, right) => right.score - left.score);
}

export function riskScoreToLevel(risk: number): RiskLevel {
	const normalized = clamp01(risk);
	if (normalized < 0.25) return "P0";
	if (normalized < 0.5) return "P1";
	if (normalized < 0.75) return "P2";
	return "P3";
}

function decisionReplanAssessment(decisions: readonly SecurityDecision[]): ReplanAssessment {
	const latest = decisions.at(-1);
	if (!latest || latest.resultStatus === undefined || latest.resultStatus === "pending" || latest.resultStatus === "succeeded")
		return { required: false };
	const trigger: ReplanTrigger = latest.resultStatus === "contradicted" ? "decision-contradicted" : "decision-failed";
	const sameToolFailures = decisions
		.slice(-4)
		.filter((decision) => selectedTool(decision) === selectedTool(latest) && decision.resultStatus === "failed").length;
	if (sameToolFailures >= 2)
		return {
			required: true,
			decisionId: latest.id,
			trigger: "repeated-failure",
			reason: `Repeated failure for ${selectedTool(latest) ?? "selected action"}; choose a materially different strategy`,
		};
	const reason = latest.actualResult?.trim() || `Decision ${latest.id} ${latest.resultStatus}`;
	return { required: true, decisionId: latest.id, trigger, reason: `${latest.resultStatus}: ${reason}` };
}

export function assessReplanNeed(input: readonly SecurityDecision[] | SecurityState): ReplanAssessment {
	if (Array.isArray(input)) return decisionReplanAssessment(input);
	const state = input as SecurityState;
	const decisionAssessment = decisionReplanAssessment(state.decisions);
	if (decisionAssessment.required) return decisionAssessment;
	const signal = state.observerSignals.at(-1);
	if (signal && (signal.kind === "drift" || signal.kind === "stalled" || signal.kind === "repeated-failure"))
		return {
			required: true,
			trigger: signal.kind === "repeated-failure" ? "repeated-failure" : signal.kind === "drift" ? "observer-drift" : "decision-stalled",
			reason: signal.reason,
			decisionId: signal.decisionIds.at(-1),
		};
	const verification = state.evidenceGraph.verifications.at(-1);
	if (verification?.status === "contradicted")
		return { required: true, trigger: "verification-contradicted", reason: verification.reason };
	return { required: false };
}

export function createReplanRecord(assessment: ReplanAssessment): SecurityReplanRecord | undefined {
	if (!assessment.required || !assessment.trigger || !assessment.reason) return undefined;
	return {
		id: randomUUID(),
		trigger: assessment.trigger,
		reason: assessment.reason,
		previousDecisionId: assessment.decisionId,
		createdAt: new Date().toISOString(),
	};
}
