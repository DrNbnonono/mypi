import { describe, expect, it } from "vitest";
import { prioritizeCapabilityHints, summarizeCapabilityCoverage } from "../src/core/capability-coverage.ts";
import { createInitialSecurityState } from "../src/core/state.ts";
import type { SecurityDecision } from "../src/core/types.ts";

function failed(id: string, capability: string): SecurityDecision {
	return {
		id, createdAt: "2026-08-30T00:00:00Z", goal: "fixture", stage: "analysis", evidenceIds: [],
		candidates: [{ id: `${id}-a`, tool: "curl", capability, description: capability, goalRelevance: 1, informationGain: 1, confidence: 1, cost: 0.1, preconditions: [], risk: 0.1, score: 0.8 }],
		selectedActionId: `${id}-a`, resultStatus: "failed",
	};
}

describe("capability coverage", () => {
	it("prioritizes unexplored capability families after repeated failure", () => {
		const state = createInitialSecurityState();
		state.decisions.push(failed("d1", "web-enumeration"), failed("d2", "web-enumeration"));
		expect(summarizeCapabilityCoverage(state)[0]).toMatchObject({ key: "web-enumeration", attempts: 2, failed: 2 });
		expect(prioritizeCapabilityHints(state, ["web-enumeration", "web-request-analysis"])[0]).toBe("web-request-analysis");
	});
});
