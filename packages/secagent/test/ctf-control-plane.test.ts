import { describe, expect, it } from "vitest";
import { recommendAgentDispatch } from "../src/agents/control-plane.ts";
import { observeSecurityState } from "../src/core/observer.ts";
import { createInitialSecurityState } from "../src/core/state.ts";
import type { SecurityDecision } from "../src/core/types.ts";
import { createCtfChallengeProfile, inferCtfChallengeKind } from "../src/ctf/capabilities.ts";

function failed(id: string): SecurityDecision {
	return {
		id,
		createdAt: "2026-08-30T00:00:00Z",
		goal: "fixture",
		stage: "analysis",
		evidenceIds: [],
		candidates: [
			{
				id: `${id}-a`,
				tool: "curl",
				capability: "web-request-analysis",
				description: "repeat",
				goalRelevance: 1,
				informationGain: 1,
				confidence: 1,
				cost: 0.1,
				preconditions: [],
				risk: 0.1,
				score: 0.8,
			},
		],
		selectedActionId: `${id}-a`,
		resultStatus: "failed",
		actualResult: "no progress",
	};
}

describe("CTF capability overlay", () => {
	it("classifies common challenge families", () => {
		expect(inferCtfChallengeKind("ELF pwn challenge with stack and ROP")).toBe("pwn");
		expect(inferCtfChallengeKind("HTTP cookie web challenge")).toBe("web");
	});

	it("routes CTF capabilities through existing SecAgent specialists", () => {
		const state = createInitialSecurityState();
		state.goal = "Analyze this ELF reversing challenge";
		state.ctfProfile = createCtfChallengeProfile(state);
		const recommendation = recommendAgentDispatch(state);
		expect(state.ctfProfile.kind).toBe("reverse");
		expect(recommendation.role).toBe("sec-reverse");
		expect(recommendation.envelope.capabilityHints).toContain("reverse-analysis");
		expect(recommendation.envelope.budget.maxToolCalls).toBeGreaterThan(0);
	});

	it("uses existing Web and vulnerability roles instead of a dedicated CTF agent", () => {
		const state = createInitialSecurityState();
		state.goal = "HTTP cookie web challenge";
		state.ctfProfile = createCtfChallengeProfile(state);
		expect(recommendAgentDispatch(state).role).toBe("sec-web");
		state.ctfProfile = createCtfChallengeProfile(state, "pwn");
		state.stage = "verification";
		expect(recommendAgentDispatch(state).role).toBe("sec-vuln");
	});

	it("observer detects repeated failed capability strategy", () => {
		const state = createInitialSecurityState();
		state.decisions.push(failed("d1"), failed("d2"), failed("d3"));
		const signals = observeSecurityState(state);
		expect(signals.some((item) => item.kind === "repeated-failure")).toBe(true);
		expect(signals.some((item) => item.kind === "stalled")).toBe(true);
	});
});
