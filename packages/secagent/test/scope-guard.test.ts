import { describe, expect, it } from "vitest";
import { createInitialSecurityState } from "../src/core/state.ts";
import { evaluateHardScopeGuard } from "../src/extension-scope-guard.ts";

describe("hard scope invariant", () => {
	it("blocks out-of-scope network actions even in autonomous mode", () => {
		const state = createInitialSecurityState();
		state.policyMode = "autonomous";
		state.scope.targets = [{ id: "scope-1", kind: "ipv4", value: "10.0.0.5" }];
		const decision = evaluateHardScopeGuard("curl", { target: "http://10.0.0.6/" }, state);
		expect(decision.block).toBe(true);
		expect(decision.assessment?.allowed).toBe(false);
	});

	it("allows internal SecAgent tools without widening authorization", () => {
		const state = createInitialSecurityState();
		const decision = evaluateHardScopeGuard("security_plan", { candidates: [] }, state);
		expect(decision.block).toBe(false);
	});
});
