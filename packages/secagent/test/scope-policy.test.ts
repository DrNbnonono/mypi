import { describe, expect, it } from "vitest";
import { canEnableAutonomous, decidePermission } from "../src/core/policy.ts";
import { assessToolScope, isTargetInScope } from "../src/core/scope.ts";
import { createInitialSecurityState } from "../src/core/state.ts";
import type { ScopeTarget, SecurityScope } from "../src/core/types.ts";

const domain: ScopeTarget = { id: "domain", kind: "domain", value: "example.com" };
const cidr: ScopeTarget = { id: "cidr", kind: "cidr", value: "10.20.30.0/24" };
const scope: SecurityScope = { targets: [domain, cidr] };

describe("scope and policy", () => {
	it("matches domain descendants and IPv4 CIDRs", () => {
		expect(isTargetInScope("api.example.com", domain)).toBe(true);
		expect(isTargetInScope("example.net", domain)).toBe(false);
		expect(isTargetInScope("10.20.30.17", cidr)).toBe(true);
		expect(isTargetInScope("10.20.31.17", cidr)).toBe(false);
	});

	it("fails closed for unresolved and out-of-scope network targets", () => {
		expect(assessToolScope("bash", { command: "nmap $TARGET" }, scope).allowed).toBe(false);
		expect(assessToolScope("bash", { command: "curl https://example.net" }, scope).allowed).toBe(false);
		expect(assessToolScope("bash", { command: "nmap 10.20.30.17" }, scope).allowed).toBe(true);
	});

	it("implements strict, competition, and autonomous confirmation behavior", () => {
		expect(decidePermission("strict", "P2")).toBe("confirm");
		expect(decidePermission("competition", "P2")).toBe("allow");
		expect(decidePermission("competition", "P3")).toBe("confirm");
		expect(decidePermission("autonomous", "P3")).toBe("allow");
	});

	it("requires isolation and authorization before autonomous mode", () => {
		const state = createInitialSecurityState();
		expect(canEnableAutonomous(state).allowed).toBe(false);
		state.isolation = { status: "sandbox", source: "pi-sandbox" };
		expect(canEnableAutonomous(state).allowed).toBe(false);
		state.autonomousAuthorization = {
			operator: "tester",
			reason: "lab",
			isolationSource: "pi-sandbox",
			confirmedAt: "2026-08-30T00:00:00Z",
		};
		expect(canEnableAutonomous(state).allowed).toBe(true);
	});
});
