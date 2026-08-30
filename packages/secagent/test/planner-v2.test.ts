import { describe, expect, it } from "vitest";
import { assessBudget } from "../src/core/budget.ts";
import { assessReplanNeed, rankCandidates } from "../src/core/planner.ts";
import { createInitialSecurityState } from "../src/core/state.ts";
import type { CandidateActionInput, SecurityDecision } from "../src/core/types.ts";

function failedDecision(id: string, tool: string): SecurityDecision {
	return {
		id,
		createdAt: "2026-08-30T00:00:00Z",
		goal: "fixture",
		stage: "analysis",
		evidenceIds: [],
		candidates: [{
			id: `${id}-action`, tool, description: tool, goalRelevance: 1, informationGain: 0.8, confidence: 0.8,
			cost: 0.2, preconditions: [], risk: 0.2, score: 0.7,
		}],
		selectedActionId: `${id}-action`,
		resultStatus: "failed",
		actualResult: "fixture failure",
	};
}

describe("competition planner/replanner", () => {
	it("penalizes a repeatedly failing strategy", () => {
		const state = createInitialSecurityState();
		state.decisions.push(failedDecision("d1", "curl"), failedDecision("d2", "curl"));
		const candidates: CandidateActionInput[] = [
			{ id: "repeat", tool: "curl", description: "repeat", goalRelevance: 0.9, informationGain: 0.8, confidence: 0.8, cost: 0.2, preconditions: [] },
			{ id: "novel", tool: "nmap", description: "novel", goalRelevance: 0.9, informationGain: 0.8, confidence: 0.8, cost: 0.2, preconditions: [] },
		];
		const ranked = rankCandidates(candidates, { state });
		expect(ranked.find((item) => item.id === "repeat")?.noveltyPenalty).toBeGreaterThan(0);
		expect(ranked[0]?.id).toBe("novel");
	});

	it("raises an explicit repeated-failure replan trigger", () => {
		const state = createInitialSecurityState();
		state.decisions.push(failedDecision("d1", "curl"), failedDecision("d2", "curl"));
		expect(assessReplanNeed(state)).toMatchObject({ required: true, trigger: "repeated-failure" });
	});

	it("enforces bounded decision/tool/replan budgets", () => {
		const state = createInitialSecurityState();
		state.budget.limits.maxToolCalls = 1;
		state.budget.usage.toolCallsUsed = 1;
		expect(assessBudget(state.budget, "tool-call").allowed).toBe(false);
	});
});
