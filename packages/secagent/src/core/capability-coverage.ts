import { strategyKey } from "./planner.ts";
import type { SecurityState } from "./types.ts";

export interface CapabilityCoverage {
	key: string;
	attempts: number;
	succeeded: number;
	failed: number;
	contradicted: number;
	pending: number;
	lastDecisionId?: string;
}

export function summarizeCapabilityCoverage(state: SecurityState): CapabilityCoverage[] {
	const coverage = new Map<string, CapabilityCoverage>();
	for (const decision of state.decisions) {
		const selected = decision.candidates.find((candidate) => candidate.id === decision.selectedActionId);
		if (!selected) continue;
		const key = strategyKey(selected);
		const current = coverage.get(key) ?? {
			key,
			attempts: 0,
			succeeded: 0,
			failed: 0,
			contradicted: 0,
			pending: 0,
		};
		current.attempts += 1;
		current.lastDecisionId = decision.id;
		if (decision.resultStatus === "succeeded") current.succeeded += 1;
		else if (decision.resultStatus === "failed") current.failed += 1;
		else if (decision.resultStatus === "contradicted") current.contradicted += 1;
		else current.pending += 1;
		coverage.set(key, current);
	}
	return [...coverage.values()].sort((left, right) => right.attempts - left.attempts || left.key.localeCompare(right.key));
}

export function prioritizeCapabilityHints(state: SecurityState, hints: readonly string[], limit = 4): string[] {
	const coverage = new Map(summarizeCapabilityCoverage(state).map((item) => [item.key, item]));
	return [...new Set(hints.map((hint) => hint.trim()).filter(Boolean))]
		.map((hint, index) => {
			const item = coverage.get(hint.toLowerCase());
			const score = item
				? 20 + item.succeeded * 5 - item.failed * 30 - item.contradicted * 35 - item.pending * 10
				: 100;
			return { hint, score, index };
		})
		.sort((left, right) => right.score - left.score || left.index - right.index)
		.slice(0, Math.max(1, limit))
		.map((item) => item.hint);
}
