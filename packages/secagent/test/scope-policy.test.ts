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

	it("does not lift phantom hosts out of URL paths or file names", () => {
		const loopback: SecurityScope = { targets: [{ id: "lo", kind: "ipv4", value: "127.0.0.1" }] };
		for (const command of [
			"curl -s http://127.0.0.1:3000/assets/public/images/padding/19px.png",
			"curl -s http://127.0.0.1:3000/.well-known/security.txt",
			"curl -s http://127.0.0.1:3000/ftp/00.md && cat notes.md",
		]) {
			const assessment = assessToolScope("bash", { command }, loopback);
			expect(assessment.allowed, command).toBe(true);
			expect(
				assessment.targets.filter((target) => !target.includes("127.0.0.1")),
				command,
			).toEqual([]);
		}
		const curlInput = { target: "http://127.0.0.1:3000/rest/admin/application-configuration" };
		expect(assessToolScope("curl", curlInput, loopback).allowed).toBe(true);
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
		state.task = {
			id: "task-1",
			goal: "controlled lab",
			scenario: "penetration-test",
			assets: [],
			constraints: [],
			successCriteria: [],
			declaredAuthorization: ["lab"],
			pendingConfirmations: [],
			createdAt: "2026-08-30T00:00:00Z",
		};
		state.isolation = { status: "sandbox", source: "pi-sandbox" };
		expect(canEnableAutonomous(state).allowed).toBe(false);
		state.scope = { targets: [{ id: "lab", kind: "ipv4", value: "127.0.0.1" }] };
		state.autonomousAuthorization = {
			operator: "tester",
			reason: "lab",
			isolationSource: "pi-sandbox",
			confirmedAt: "2026-08-30T00:00:00Z",
		};
		expect(canEnableAutonomous(state).allowed).toBe(true);
		expect(canEnableAutonomous(state, { runtimePackagesReady: false })).toMatchObject({ allowed: false });
		state.isolation = { status: "external", source: "organizer-lab" };
		expect(canEnableAutonomous(state)).toMatchObject({ allowed: false });
	});
});
