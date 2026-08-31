import { describe, expect, it } from "vitest";
import { createInitialSecurityState } from "../src/core/state.ts";
import { evaluateProtectedPathGuard, evaluateScopeGuard } from "../src/extension-scope-guard.ts";

describe("scope guard policy", () => {
	it("warns without blocking out-of-scope autonomous actions", () => {
		const state = createInitialSecurityState();
		state.policyMode = "autonomous";
		state.scope.targets = [{ id: "scope-1", kind: "ipv4", value: "10.0.0.5" }];
		const decision = evaluateScopeGuard("curl", { target: "http://10.0.0.6/" }, state);
		expect(decision.block).toBe(false);
		expect(decision.warn).toBe(true);
		expect(decision.assessment?.allowed).toBe(false);
	});

	it.each(["strict", "competition"] as const)("blocks out-of-scope actions in %s mode", (policyMode) => {
		const state = createInitialSecurityState();
		state.policyMode = policyMode;
		state.scope.targets = [{ id: "scope-1", kind: "ipv4", value: "10.0.0.5" }];
		const decision = evaluateScopeGuard("curl", { target: "http://10.0.0.6/" }, state);
		expect(decision.block).toBe(true);
		expect(decision.warn).toBe(false);
	});

	it("allows internal SecAgent tools without widening authorization", () => {
		const state = createInitialSecurityState();
		const decision = evaluateScopeGuard("security_plan", { candidates: [] }, state);
		expect(decision.block).toBe(false);
		expect(decision.warn).toBe(false);
	});

	it("blocks direct shell execution so it cannot bypass registered adapters", () => {
		const state = createInitialSecurityState();
		state.policyMode = "autonomous";
		const decision = evaluateScopeGuard("bash", { command: "nmap 127.0.0.1" }, state);
		expect(decision.block).toBe(true);
		expect(decision.reason).toMatch(/security_execute/);
	});
});

describe("protected path guard", () => {
	it("blocks credential paths independently of policy mode", () => {
		expect(evaluateProtectedPathGuard({ command: "cat ~/.ssh/id_ed25519" }, "/workspace")).toMatchObject({
			block: true,
		});
		expect(evaluateProtectedPathGuard({ path: "/home/demo/.pi/auth.json" }, "/workspace")).toMatchObject({
			block: true,
		});
	});

	it("does not confuse an HTTP route with a local credential path", () => {
		expect(evaluateProtectedPathGuard({ url: "http://127.0.0.1/.ssh/fixture" }, "/workspace")).toEqual({
			block: false,
		});
		expect(evaluateProtectedPathGuard({ command: "curl http://127.0.0.1/.ssh/fixture" }, "/workspace")).toEqual({
			block: false,
		});
	});
});
