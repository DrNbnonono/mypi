import { planningRiskForTool } from "../tools/registry.ts";
import type { CandidateActionInput, RiskLevel, ScoredAction } from "./types.ts";

const WEIGHTS = { goalRelevance: 0.35, informationGain: 0.3, confidence: 0.2, risk: 0.1, cost: 0.05 } as const;

function clamp01(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.max(0, Math.min(1, value));
}

export function scoreCandidate(action: CandidateActionInput): ScoredAction {
	const goalRelevance = clamp01(action.goalRelevance);
	const informationGain = clamp01(action.informationGain);
	const confidence = clamp01(action.confidence);
	const risk = planningRiskForTool(action.tool, action.riskHint);
	const cost = clamp01(action.cost);
	const score =
		goalRelevance * WEIGHTS.goalRelevance +
		informationGain * WEIGHTS.informationGain +
		confidence * WEIGHTS.confidence -
		risk * WEIGHTS.risk -
		cost * WEIGHTS.cost;
	return {
		...action,
		goalRelevance,
		informationGain,
		confidence,
		risk,
		cost,
		score: Math.round(score * 10000) / 10000,
	};
}

export function rankCandidates(candidates: CandidateActionInput[]): ScoredAction[] {
	return candidates.map(scoreCandidate).sort((left, right) => right.score - left.score);
}

export function riskScoreToLevel(risk: number): RiskLevel {
	const normalized = clamp01(risk);
	if (normalized < 0.25) return "P0";
	if (normalized < 0.5) return "P1";
	if (normalized < 0.75) return "P2";
	return "P3";
}
