import type { SecAgentRuntime } from "../runtime.ts";
import { createEvidenceEdge, createHypothesis } from "./evidence-graph.ts";
import type { SecurityHypothesisRecord } from "./types.ts";

export interface OperationalEvidencePromotion {
	hypothesisIds: string[];
	edgeIds: string[];
}

function selectedCapability(runtime: SecAgentRuntime, decisionId: string): string | undefined {
	const decision = runtime.snapshot().state.decisions.find((item) => item.id === decisionId);
	const selected = decision?.candidates.find((candidate) => candidate.id === decision.selectedActionId);
	return selected?.capability?.trim().toLowerCase() || selected?.tool.trim().toLowerCase();
}

function hypothesisFamily(capability: string): { key: string; statement: string } {
	if (capability === "network-enumeration")
		return {
			key: "network-surface",
			statement: "The authorized target exposes an observable network service surface.",
		};
	if (capability === "web-enumeration" || capability === "web-request-analysis")
		return {
			key: "http-surface",
			statement: "The authorized target exposes a reproducibly observable HTTP service surface.",
		};
	if (capability === "vulnerability-verification")
		return {
			key: "candidate-vulnerability-signal",
			statement:
				"The authorized target produced a reproducible candidate vulnerability signal that still requires finding-level confirmation.",
		};
	if (["artifact-triage", "binary-triage", "reverse-analysis", "forensics-triage"].includes(capability))
		return {
			key: "artifact-static-properties",
			statement: "The supplied artifact has reproducible static properties backed by preserved provenance.",
		};
	return {
		key: capability,
		statement: `Capability ${capability} produced reproducible observations for the authorized task.`,
	};
}

function targetSignature(runtime: SecAgentRuntime, decisionId: string): string {
	const state = runtime.snapshot().state;
	const decision = state.decisions.find((item) => item.id === decisionId);
	const selected = decision?.candidates.find((candidate) => candidate.id === decision.selectedActionId);
	const evidenceTargets = state.evidence
		.filter((item) => item.decisionIds?.includes(decisionId))
		.flatMap((item) => item.targetRefs ?? [])
		.map((item) => item.trim())
		.filter(Boolean);
	const selectedTargets = selected?.targets ?? [];
	const values = [
		...new Set([...evidenceTargets, ...selectedTargets].map((item) => item.trim()).filter(Boolean)),
	].sort();
	return values.length > 0 ? values.join(" | ") : (state.task?.id ?? "current-task");
}

export function promoteOperationalEvidence(runtime: SecAgentRuntime, decisionId: string): OperationalEvidencePromotion {
	const snapshot = runtime.snapshot().state;
	const decision = snapshot.decisions.find((item) => item.id === decisionId);
	if (!decision || decision.resultStatus !== "succeeded") return { hypothesisIds: [], edgeIds: [] };
	const evidence = snapshot.evidence.filter((item) => item.decisionIds?.includes(decisionId));
	if (evidence.length === 0) return { hypothesisIds: [], edgeIds: [] };
	const capability = selectedCapability(runtime, decisionId);
	if (!capability) return { hypothesisIds: [], edgeIds: [] };
	const family = hypothesisFamily(capability);
	const statement = `${family.statement} [family=${family.key}; target=${targetSignature(runtime, decisionId)}]`;
	let hypothesis: SecurityHypothesisRecord | undefined = snapshot.evidenceGraph.hypotheses.find(
		(item) => item.statement === statement,
	);
	const hypothesisIds: string[] = [];
	const edgeIds: string[] = [];
	if (!hypothesis) {
		hypothesis = createHypothesis(statement);
		runtime.append({ type: "hypothesis_recorded", hypothesis, createdAt: hypothesis.createdAt });
		hypothesisIds.push(hypothesis.id);
	}
	for (const item of evidence) {
		const current = runtime.snapshot().state;
		const exists = current.evidenceGraph.edges.some(
			(edge) =>
				edge.fromEvidenceId === item.id && edge.toHypothesisId === hypothesis?.id && edge.relation === "supports",
		);
		if (exists) continue;
		const edge = createEvidenceEdge({
			fromEvidenceId: item.id,
			toHypothesisId: hypothesis.id,
			relation: "supports",
			confidence: item.confidence,
		});
		runtime.append({ type: "evidence_linked", edge, createdAt: edge.createdAt });
		edgeIds.push(edge.id);
	}
	return { hypothesisIds: hypothesisIds.length > 0 ? hypothesisIds : [hypothesis.id], edgeIds };
}
