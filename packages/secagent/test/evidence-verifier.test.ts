import { describe, expect, it } from "vitest";
import { createEvidenceEdge, createHypothesis } from "../src/core/evidence-graph.ts";
import { applySecurityEvent, createInitialSecurityState } from "../src/core/state.ts";
import type { SecurityEvidence } from "../src/core/types.ts";
import { verifiedFindingGate, verifyHypothesis } from "../src/core/verifier.ts";

function evidence(id: string, source: string, confidence = 0.9): SecurityEvidence {
	return { id, kind: "observation", summary: id, source, confidence, createdAt: "2026-08-30T00:00:00Z" };
}

describe("evidence graph verifier", () => {
	it("requires independent supporting sources by default", () => {
		let state = createInitialSecurityState();
		const hypothesis = createHypothesis("fixture hypothesis");
		state = applySecurityEvent(state, { type: "hypothesis_recorded", hypothesis, createdAt: hypothesis.createdAt });
		for (const item of [evidence("e1", "scanner-a"), evidence("e2", "manual-replay")])
			state = applySecurityEvent(state, { type: "evidence_added", evidence: item, createdAt: item.createdAt });
		for (const id of ["e1", "e2"]) {
			const edge = createEvidenceEdge({ fromEvidenceId: id, toHypothesisId: hypothesis.id, relation: "supports" });
			state = applySecurityEvent(state, { type: "evidence_linked", edge, createdAt: edge.createdAt });
		}
		const verification = verifyHypothesis(state, hypothesis.id);
		expect(verification.status).toBe("verified");
		expect(verification.independentSources).toBe(2);
	});

	it("does not promote one scanner observation into a finding", () => {
		let state = createInitialSecurityState();
		const hypothesis = createHypothesis("single source");
		state = applySecurityEvent(state, { type: "hypothesis_recorded", hypothesis, createdAt: hypothesis.createdAt });
		const item = evidence("e1", "scanner-a", 0.99);
		state = applySecurityEvent(state, { type: "evidence_added", evidence: item, createdAt: item.createdAt });
		const edge = createEvidenceEdge({ fromEvidenceId: item.id, toHypothesisId: hypothesis.id, relation: "supports" });
		state = applySecurityEvent(state, { type: "evidence_linked", edge, createdAt: edge.createdAt });
		const verification = verifyHypothesis(state, hypothesis.id);
		expect(verification.status).toBe("insufficient");
		state = applySecurityEvent(state, {
			type: "hypothesis_verified",
			verification,
			createdAt: verification.createdAt,
		});
		expect(verifiedFindingGate(state, verification.id).allowed).toBe(false);
	});

	it("allows direct high-confidence hash-backed artifact evidence", () => {
		let state = createInitialSecurityState();
		const hypothesis = createHypothesis("artifact fact");
		state = applySecurityEvent(state, { type: "hypothesis_recorded", hypothesis, createdAt: hypothesis.createdAt });
		const artifact: SecurityEvidence = {
			id: "a1",
			kind: "artifact",
			summary: "binary constant",
			source: "fixture.bin",
			sha256: "abc",
			confidence: 0.98,
			createdAt: "2026-08-30T00:00:00Z",
		};
		state = applySecurityEvent(state, { type: "evidence_added", evidence: artifact, createdAt: artifact.createdAt });
		const edge = createEvidenceEdge({
			fromEvidenceId: artifact.id,
			toHypothesisId: hypothesis.id,
			relation: "verifies",
		});
		state = applySecurityEvent(state, { type: "evidence_linked", edge, createdAt: edge.createdAt });
		expect(verifyHypothesis(state, hypothesis.id).status).toBe("verified");
	});
});
