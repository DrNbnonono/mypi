import { describe, expect, it } from "vitest";
import { createInitialSecurityState } from "../src/core/state.ts";
import type { SecurityDecision } from "../src/core/types.ts";
import {
	CONTROLLED_AUTONOMY_BENCHMARKS,
	controlledBenchmarkDefinition,
	evaluateControlledScenario,
} from "../src/scenarios/controlled.ts";

function succeededDecision(id: string, tool: string, capability: string): SecurityDecision {
	return {
		id,
		createdAt: "2026-08-30T00:00:00Z",
		goal: "fixture",
		stage: "recon",
		evidenceIds: [],
		candidates: [{
			id: `${id}-action`,
			tool,
			capability,
			description: tool,
			goalRelevance: 1,
			informationGain: 1,
			confidence: 1,
			cost: 0.1,
			preconditions: [],
			risk: 0.1,
			score: 0.8,
		}],
		selectedActionId: `${id}-action`,
		resultStatus: "succeeded",
	};
}

describe("controlled competition benchmark matrix", () => {
	it("publishes the five required controlled scenario families", () => {
		expect(CONTROLLED_AUTONOMY_BENCHMARKS.map((item) => item.id)).toEqual(["web", "pwn", "reverse", "forensics", "killchain"]);
	});

	it("does not award a perfect Web score when expected capability families are missing", () => {
		const state = createInitialSecurityState();
		state.task = { id: "web", goal: "fixture", scenario: "web-security", assets: [], constraints: [], successCriteria: [], declaredAuthorization: [], pendingConfirmations: [], createdAt: "2026-08-30T00:00:00Z" };
		state.goal = state.task.goal;
		state.scope.targets = [{ id: "scope", kind: "url", value: "http://127.0.0.1/" }];
		state.decisions.push(succeededDecision("d1", "httpx", "web-enumeration"));
		state.evidence.push({ id: "e1", kind: "observation", summary: "HTTP 200", source: "httpx", confidence: 0.9, createdAt: "2026-08-30T00:00:01Z" });
		const result = evaluateControlledScenario(controlledBenchmarkDefinition("web"), state, []);
		expect(result.passed).toBe(false);
		expect(result.capabilityScore).toBeLessThan(100);
		expect(result.missingExpectedCapabilities).toEqual(["web-request-analysis", "vulnerability-verification"]);
	});

	it("passes a Web trace only after all expected capability families succeed", () => {
		const state = createInitialSecurityState();
		state.task = { id: "web", goal: "fixture", scenario: "web-security", assets: [], constraints: [], successCriteria: [], declaredAuthorization: [], pendingConfirmations: [], createdAt: "2026-08-30T00:00:00Z" };
		state.goal = state.task.goal;
		state.scope.targets = [{ id: "scope", kind: "url", value: "http://127.0.0.1/" }];
		state.decisions.push(
			succeededDecision("d1", "httpx", "web-enumeration"),
			succeededDecision("d2", "curl", "web-request-analysis"),
			succeededDecision("d3", "nuclei", "vulnerability-verification"),
		);
		state.evidence.push({ id: "e1", kind: "observation", summary: "HTTP 200", source: "httpx", confidence: 0.9, createdAt: "2026-08-30T00:00:01Z" });
		state.evidenceGraph.hypotheses.push({
			id: "h1", statement: "HTTP surface is reproducibly observable", status: "verified",
			createdAt: "2026-08-30T00:00:01Z", updatedAt: "2026-08-30T00:00:02Z",
		});
		state.evidenceGraph.verifications.push({
			id: "v1", hypothesisId: "h1", status: "verified", score: 0.9, evidenceIds: ["e1"], independentSources: 1,
			reason: "fixture verification", createdAt: "2026-08-30T00:00:02Z",
		});
		const result = evaluateControlledScenario(controlledBenchmarkDefinition("web"), state, []);
		expect(result.passed).toBe(true);
		expect(result.score).toBe(100);
		expect(result.successfulCapabilities).toEqual(expect.arrayContaining(["web-enumeration", "web-request-analysis", "vulnerability-verification"]));
	});

	it("reports missing killchain replanning after a failed decision", () => {
		const state = createInitialSecurityState();
		state.task = { id: "killchain", goal: "fixture", scenario: "penetration-test", assets: [], constraints: [], successCriteria: [], declaredAuthorization: [], pendingConfirmations: [], createdAt: "2026-08-30T00:00:00Z" };
		state.goal = state.task.goal;
		state.scope.targets = [{ id: "scope", kind: "ipv4", value: "127.0.0.1" }];
		const failed = succeededDecision("d1", "httpx", "web-enumeration");
		failed.resultStatus = "failed";
		state.decisions.push(failed);
		const result = evaluateControlledScenario(controlledBenchmarkDefinition("killchain"), state, []);
		expect(result.properties.find((item) => item.property === "failure-triggers-replan")?.passed).toBe(false);
	});
});
