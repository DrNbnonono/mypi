import { evidenceForHypothesis } from "./evidence-graph.ts";
import { promoteOperationalEvidence } from "./evidence-promoter.ts";
import type { SecurityVerificationRecord } from "./types.ts";
import { verifyHypothesis } from "./verifier.ts";
import type { SecAgentRuntime } from "../runtime.ts";

function sameEvidence(left: readonly string[], right: readonly string[]): boolean {
	if (left.length !== right.length) return false;
	const rightSet = new Set(right);
	return left.every((id) => rightSet.has(id));
}

function promoteCompletedDecisionEvidence(runtime: SecAgentRuntime): void {
	for (const decision of runtime.snapshot().state.decisions) {
		if (decision.resultStatus !== "succeeded") continue;
		promoteOperationalEvidence(runtime, decision.id);
	}
}

export function runAutomaticVerification(runtime: SecAgentRuntime): SecurityVerificationRecord[] {
	promoteCompletedDecisionEvidence(runtime);
	const state = runtime.snapshot().state;
	const appended: SecurityVerificationRecord[] = [];
	for (const hypothesis of state.evidenceGraph.hypotheses) {
		if (hypothesis.status !== "active") continue;
		const linked = evidenceForHypothesis(state, hypothesis.id);
		if (linked.length === 0) continue;
		const verification = verifyHypothesis(state, hypothesis.id);
		const previous = [...state.evidenceGraph.verifications].reverse().find((item) => item.hypothesisId === hypothesis.id);
		if (previous && previous.status === verification.status && sameEvidence(previous.evidenceIds, verification.evidenceIds)) continue;
		runtime.append({ type: "hypothesis_verified", verification, createdAt: verification.createdAt });
		appended.push(verification);
	}
	return appended;
}
