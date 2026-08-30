import { randomUUID } from "node:crypto";
import { evidenceForHypothesis, evidenceSourceKey } from "./evidence-graph.ts";
import type { SecurityState, SecurityVerificationRecord } from "./types.ts";

export interface VerificationOptions {
	minimumIndependentSources?: number;
	minimumConfidence?: number;
	directArtifactConfidence?: number;
}

function round(value: number): number {
	return Math.round(value * 1000) / 1000;
}

export function verifyHypothesis(
	state: SecurityState,
	hypothesisId: string,
	options: VerificationOptions = {},
): SecurityVerificationRecord {
	const hypothesis = state.evidenceGraph.hypotheses.find((item) => item.id === hypothesisId);
	if (!hypothesis) throw new Error(`Unknown hypothesis ${hypothesisId}`);
	const minimumSources = options.minimumIndependentSources ?? 2;
	const minimumConfidence = options.minimumConfidence ?? 0.75;
	const directArtifactConfidence = options.directArtifactConfidence ?? 0.95;
	const linked = evidenceForHypothesis(state, hypothesisId);
	const supporting = linked.filter((item) => item.relation === "supports" || item.relation === "verifies");
	const contradicting = linked.filter((item) => item.relation === "contradicts");
	const contradictoryScore = contradicting.reduce(
		(maximum, item) => Math.max(maximum, item.evidence.confidence * item.edgeConfidence),
		0,
	);
	const sourceScores = new Map<string, number>();
	for (const item of supporting) {
		const key = evidenceSourceKey(item.evidence);
		const score = item.evidence.confidence * item.edgeConfidence;
		sourceScores.set(key, Math.max(sourceScores.get(key) ?? 0, score));
	}
	const scores = [...sourceScores.values()];
	const aggregate = scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0;
	const directArtifact = supporting.find(
		(item) => item.evidence.kind === "artifact" && Boolean(item.evidence.sha256) && item.evidence.confidence >= directArtifactConfidence,
	);
	let status: SecurityVerificationRecord["status"] = "insufficient";
	let reason = `Need ${minimumSources} independent sources with aggregate confidence >= ${minimumConfidence.toFixed(2)}`;
	if (contradictoryScore >= Math.max(minimumConfidence, aggregate)) {
		status = "contradicted";
		reason = `Contradicting evidence confidence ${round(contradictoryScore)} outweighs current support`;
	} else if (directArtifact) {
		status = "verified";
		reason = `Direct hash-backed artifact evidence ${directArtifact.evidence.id} satisfies the verification gate`;
	} else if (scores.length >= minimumSources && aggregate >= minimumConfidence) {
		status = "verified";
		reason = `${scores.length} independent sources support the hypothesis at aggregate confidence ${round(aggregate)}`;
	}
	return {
		id: randomUUID(),
		hypothesisId,
		status,
		score: round(Math.max(aggregate, directArtifact ? directArtifact.evidence.confidence : 0, contradictoryScore)),
		evidenceIds: [...new Set(linked.map((item) => item.evidence.id))],
		independentSources: sourceScores.size,
		reason,
		createdAt: new Date().toISOString(),
	};
}

export function verifiedFindingGate(state: SecurityState, verificationId: string): { allowed: boolean; reason: string } {
	const verification = state.evidenceGraph.verifications.find((item) => item.id === verificationId);
	if (!verification) return { allowed: false, reason: `Verification ${verificationId} does not exist` };
	if (verification.status !== "verified")
		return { allowed: false, reason: `Verification ${verificationId} is ${verification.status}, not verified` };
	return { allowed: true, reason: verification.reason };
}
