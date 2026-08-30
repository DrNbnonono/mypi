import { describe, expect, it } from "vitest";
import { applySecurityEvent, createInitialSecurityState } from "../src/core/state.ts";
import type { SecurityTaskSpec } from "../src/core/types.ts";

function task(id: string): SecurityTaskSpec {
	return {
		id,
		goal: `task ${id}`,
		scenario: "penetration-test",
		assets: [],
		constraints: [],
		successCriteria: [],
		declaredAuthorization: [],
		pendingConfirmations: [],
		createdAt: "2026-08-30T00:00:00Z",
	};
}

describe("security task boundary", () => {
	it("does not carry target scope or one-time autonomous authorization into a new task", () => {
		const state = createInitialSecurityState();
		state.policyMode = "autonomous";
		state.isolation = { status: "sandbox", source: "pi-sandbox", verifiedAt: "2026-08-30T00:00:00Z" };
		state.autonomousAuthorization = {
			operator: "operator",
			reason: "controlled task",
			isolationSource: "pi-sandbox",
			confirmedAt: "2026-08-30T00:00:00Z",
		};
		state.scope = {
			targets: [{ id: "scope-1", kind: "ipv4", value: "10.0.0.5" }],
			authorizationSource: "competition fixture",
		};

		const next = applySecurityEvent(state, { type: "task_started", task: task("two"), createdAt: "2026-08-30T00:01:00Z" });
		expect(next.scope.targets).toEqual([]);
		expect(next.scope.authorizationSource).toBeUndefined();
		expect(next.autonomousAuthorization).toBeUndefined();
		expect(next.policyMode).toBe("strict");
		expect(next.isolation.status).toBe("sandbox");
	});

	it("preserves non-autonomous policy preference while requiring fresh scope", () => {
		const state = createInitialSecurityState();
		state.policyMode = "competition";
		state.scope.targets = [{ id: "scope-1", kind: "domain", value: "lab.example" }];
		const next = applySecurityEvent(state, { type: "task_started", task: task("three"), createdAt: "2026-08-30T00:01:00Z" });
		expect(next.policyMode).toBe("competition");
		expect(next.scope.targets).toEqual([]);
	});
});
