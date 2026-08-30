import { describe, expect, it } from "vitest";
import { applySecurityEvent, createInitialSecurityState } from "../src/core/state.ts";
import { buildSecurityReportJson, buildSecurityReportMarkdown, redactSecurityText } from "../src/report/generator.ts";

describe("state replay and reports", () => {
	it("records decisions and their actual outcomes", () => {
		let state = createInitialSecurityState();
		state = applySecurityEvent(state, {
			type: "decision_recorded",
			createdAt: "2026-08-30T00:00:00Z",
			decision: {
				id: "d1",
				createdAt: "2026-08-30T00:00:00Z",
				goal: "lab",
				stage: "analysis",
				evidenceIds: [],
				candidates: [
					{
						id: "a",
						tool: "read",
						description: "inspect",
						goalRelevance: 1,
						informationGain: 1,
						confidence: 1,
						cost: 0,
						preconditions: [],
						risk: 0.05,
						score: 0.8,
					},
				],
				selectedActionId: "a",
				expectedResult: "artifact metadata",
			},
		});
		state = applySecurityEvent(state, {
			type: "decision_completed",
			decisionId: "d1",
			actualResult: "metadata collected",
			status: "succeeded",
			createdAt: "2026-08-30T00:01:00Z",
		});
		expect(state.decisions[0]?.actualResult).toBe("metadata collected");
		expect(buildSecurityReportMarkdown(state, [])).toMatch(/Decision Trace/);
	});

	it("redacts secrets in Markdown and JSON exports", () => {
		const state = createInitialSecurityState();
		state.goal = "token=secret-value";
		expect(redactSecurityText("Authorization: BearerSecret")).toContain("[REDACTED]");
		expect(buildSecurityReportJson(state, [])).not.toContain("secret-value");
	});
});
