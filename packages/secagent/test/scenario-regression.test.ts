import { describe, expect, it } from "vitest";
import { createInitialSecurityState } from "../src/core/state.ts";
import { COMPETITION_REGRESSION_SCENARIOS, evaluateRegression } from "../src/scenarios/regression.ts";

describe("competition scenario regression harness", () => {
	it("covers core security scenarios plus CTF Web/Pwn/Reverse", () => {
		const ids = new Set(COMPETITION_REGRESSION_SCENARIOS.map((scenario) => scenario.id));
		expect(ids.has("web-bounded-discovery")).toBe(true);
		expect(ids.has("ctf-web")).toBe(true);
		expect(ids.has("ctf-pwn")).toBe(true);
		expect(ids.has("ctf-reverse")).toBe(true);
	});

	it("fails regression if a finding bypasses verification", () => {
		const state = createInitialSecurityState();
		state.findings.push({ id: "f1", summary: "unverified", severity: "high", createdAt: "2026-08-30T00:00:00Z" });
		const result = evaluateRegression(state, []);
		expect(result.passed).toBe(false);
		expect(result.unverifiedFindings).toBe(1);
	});

	it("passes an empty invariant-clean synthetic state", () => {
		expect(evaluateRegression(createInitialSecurityState(), []).passed).toBe(true);
	});
});
