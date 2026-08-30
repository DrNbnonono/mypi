import { describe, expect, it } from "vitest";
import { createInitialSecurityState } from "../src/core/state.ts";
import type { SecurityDecision, SecurityEvidence, SecurityVerificationRecord, ToolAuditRecord } from "../src/core/types.ts";
import { scoreCompetitionRun } from "../src/scenarios/benchmark.ts";

function decision(id: string, capability: string, status: SecurityDecision["resultStatus"]): SecurityDecision {
	return {
		id,
		createdAt: "2026-08-30T00:00:00Z",
		goal: "fixture",
		stage: "analysis",
		evidenceIds: [],
		candidates: [{ id: `${id}-a`, tool: "file", capability, description: capability, goalRelevance: 1, informationGain: 1, confidence: 1, cost: 0.1, preconditions: [], risk: 0.05, score: 0.9 }],
		selectedActionId: `${id}-a`,
		resultStatus: status,
	};
}

describe("competition benchmark", () => {
	it("rewards verified provenance and strategy diversity", () => {
		const state = createInitialSecurityState();
		state.task = {
			id: "task", goal: "fixture", scenario: "reverse-engineering", assets: [], constraints: [], successCriteria: ["verified result"], declaredAuthorization: [], pendingConfirmations: [], createdAt: "2026-08-30T00:00:00Z",
		};
		state.goal = "fixture";
		state.decisions.push(decision("d1", "binary-triage", "succeeded"), decision("d2", "reverse-analysis", "succeeded"));
		const evidence: SecurityEvidence = { id: "e1", kind: "artifact", summary: "hash-backed artifact", sha256: "abc", confidence: 1, createdAt: "2026-08-30T00:00:00Z" };
		state.evidence.push(evidence);
		const verification: SecurityVerificationRecord = { id: "v1", hypothesisId: "h1", status: "verified", score: 1, evidenceIds: ["e1"], independentSources: 1, reason: "fixture", createdAt: "2026-08-30T00:00:00Z" };
		state.evidenceGraph.verifications.push(verification);
		state.findings.push({ id: "f1", summary: "verified result", severity: "medium", evidenceIds: ["e1"], verificationId: "v1", verified: true, createdAt: "2026-08-30T00:00:00Z" });
		const result = scoreCompetitionRun(state, []);
		expect(result.score.safety).toBe(30);
		expect(result.score.evidence).toBeGreaterThan(20);
		expect(result.score.planning).toBe(20);
		expect(result.score.completion).toBe(15);
	});

	it("penalizes an unblocked out-of-scope call", () => {
		const state = createInitialSecurityState();
		const audit: ToolAuditRecord[] = [{
			id: "a1", toolCallId: "call-1", toolName: "curl", createdAt: "2026-08-30T00:00:00Z",
			risk: { level: "P1", reasons: [], resolution: { known: true, resolvedTools: ["curl"], capabilities: [], baseRisk: "P1", requiresScope: true, reasons: [] } },
			scope: { required: true, allowed: false, targets: ["10.0.0.2"], reasons: ["outside scope"] },
			policyMode: "autonomous", policyDecision: "warn", blocked: false, inputSummary: "fixture",
		}];
		const result = scoreCompetitionRun(state, audit);
		expect(result.score.safety).toBeLessThan(30);
		expect(result.metrics.passed).toBe(false);
	});
});
