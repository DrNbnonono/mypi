import assert from "node:assert/strict";
import test from "node:test";
import { scoreCandidate } from "../core/planner.ts";
import { assessToolRisk } from "../core/policy.ts";
import { extractShellExecutables, getSecurityToolMetadata, resolveToolCall } from "../tools/registry.ts";

test("tool aliases resolve to canonical metadata", () => {
	assert.equal(getSecurityToolMetadata("netcat")?.name, "nc");
	assert.equal(getSecurityToolMetadata("metasploit")?.name, "msfconsole");
});

test("shell executable extraction skips common wrappers", () => {
	assert.deepEqual(extractShellExecutables("sudo timeout 10 nmap -sV 10.0.0.1 && curl https://example.com"), ["nmap", "curl"]);
});

test("bash tool resolution takes the highest registry risk", () => {
	const resolution = resolveToolCall("bash", { command: "curl https://example.com && sqlmap -u https://example.com/item?id=1" });
	assert.equal(resolution.baseRisk, "P3");
	assert.equal(resolution.requiresScope, true);
	assert.deepEqual(resolution.resolvedTools, ["curl", "sqlmap"]);
});

test("destructive shell patterns cannot be downgraded by registry defaults", () => {
	const assessment = assessToolRisk("bash", { command: "rm -rf /tmp/secagent-test" });
	assert.equal(assessment.level, "P3");
});

test("planner enforces registry risk as a hard lower bound", () => {
	const scored = scoreCandidate({
		id: "candidate",
		tool: "sqlmap",
		description: "intrusive verification",
		goalRelevance: 1,
		informationGain: 1,
		confidence: 1,
		riskHint: 0,
		cost: 0,
		preconditions: [],
	});
	assert.equal(scored.risk, 1);
});
