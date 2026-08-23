import assert from "node:assert/strict";
import test from "node:test";
import { assessToolScope, isTargetInScope } from "../core/scope.ts";
import type { ScopeTarget, SecurityScope } from "../core/types.ts";

const domainTarget: ScopeTarget = { id: "domain", kind: "domain", value: "example.com" };
const cidrTarget: ScopeTarget = { id: "cidr", kind: "cidr", value: "10.20.30.0/24" };
const scope: SecurityScope = { targets: [domainTarget, cidrTarget] };

test("domain scope includes subdomains but not sibling domains", () => {
	assert.equal(isTargetInScope("api.example.com", domainTarget), true);
	assert.equal(isTargetInScope("example.com", domainTarget), true);
	assert.equal(isTargetInScope("example.net", domainTarget), false);
});

test("IPv4 CIDR scope matches only addresses inside the network", () => {
	assert.equal(isTargetInScope("10.20.30.17", cidrTarget), true);
	assert.equal(isTargetInScope("10.20.31.17", cidrTarget), false);
});

test("registry-scoped network command is allowed when every detected target is in scope", () => {
	const result = assessToolScope("bash", { command: "nmap -sV 10.20.30.17" }, scope);
	assert.equal(result.required, true);
	assert.equal(result.allowed, true);
});

test("registry-scoped network command is blocked when a detected target is outside scope", () => {
	const result = assessToolScope("bash", { command: "curl https://example.net/status" }, scope);
	assert.equal(result.required, true);
	assert.equal(result.allowed, false);
	assert.match(result.reasons.join(" "), /out-of-scope/);
});

test("network command with an unresolved target is blocked", () => {
	const result = assessToolScope("bash", { command: "nmap $TARGET" }, scope);
	assert.equal(result.required, true);
	assert.equal(result.allowed, false);
	assert.match(result.reasons.join(" "), /could not be determined/);
});

test("local read-only shell command does not require target scope", () => {
	const result = assessToolScope("bash", { command: "git status --short" }, { targets: [] });
	assert.equal(result.required, false);
	assert.equal(result.allowed, true);
});

test("SecAgent control tools never scope-block themselves", () => {
	const result = assessToolScope("security_scope", { targets: ["example.com"] }, { targets: [] });
	assert.equal(result.required, false);
	assert.equal(result.allowed, true);
});
