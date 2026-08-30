import { randomUUID } from "node:crypto";
import type {
	EvidenceRelation,
	SecurityEvidence,
	SecurityEvidenceEdge,
	SecurityHypothesisRecord,
	SecurityState,
} from "./types.ts";

export function createHypothesis(statement: string): SecurityHypothesisRecord {
	const createdAt = new Date().toISOString();
	return {
		id: randomUUID(),
		statement: statement.trim(),
		status: "active",
		createdAt,
		updatedAt: createdAt,
	};
}

export function createEvidenceEdge(input: {
	fromEvidenceId: string;
	toEvidenceId?: string;
	toHypothesisId?: string;
	relation: EvidenceRelation;
	confidence?: number;
}): SecurityEvidenceEdge {
	if (!input.toEvidenceId && !input.toHypothesisId)
		throw new Error("Evidence edge requires a target evidence or hypothesis");
	return {
		id: randomUUID(),
		fromEvidenceId: input.fromEvidenceId,
		toEvidenceId: input.toEvidenceId,
		toHypothesisId: input.toHypothesisId,
		relation: input.relation,
		confidence: Math.max(0, Math.min(1, input.confidence ?? 1)),
		createdAt: new Date().toISOString(),
	};
}

export function evidenceForHypothesis(state: SecurityState, hypothesisId: string): Array<{
	evidence: SecurityEvidence;
	relation: EvidenceRelation;
	edgeConfidence: number;
}> {
	const byId = new Map(state.evidence.map((item) => [item.id, item]));
	return state.evidenceGraph.edges
		.filter((edge) => edge.toHypothesisId === hypothesisId)
		.flatMap((edge) => {
			const evidence = byId.get(edge.fromEvidenceId);
			return evidence ? [{ evidence, relation: edge.relation, edgeConfidence: edge.confidence }] : [];
		});
}

export function evidenceSourceKey(evidence: SecurityEvidence): string {
	return evidence.sha256 ? `sha256:${evidence.sha256}` : evidence.source?.trim().toLowerCase() || `evidence:${evidence.id}`;
}

export function graphIntegrityErrors(state: SecurityState): string[] {
	const errors: string[] = [];
	const evidenceIds = new Set(state.evidence.map((item) => item.id));
	const hypothesisIds = new Set(state.evidenceGraph.hypotheses.map((item) => item.id));
	for (const edge of state.evidenceGraph.edges) {
		if (!evidenceIds.has(edge.fromEvidenceId)) errors.push(`Edge ${edge.id} references missing evidence ${edge.fromEvidenceId}`);
		if (edge.toEvidenceId && !evidenceIds.has(edge.toEvidenceId))
			errors.push(`Edge ${edge.id} references missing evidence ${edge.toEvidenceId}`);
		if (edge.toHypothesisId && !hypothesisIds.has(edge.toHypothesisId))
			errors.push(`Edge ${edge.id} references missing hypothesis ${edge.toHypothesisId}`);
	}
	for (const finding of state.findings) {
		for (const evidenceId of finding.evidenceIds ?? []) {
			if (!evidenceIds.has(evidenceId)) errors.push(`Finding ${finding.id} references missing evidence ${evidenceId}`);
		}
	}
	return errors;
}
