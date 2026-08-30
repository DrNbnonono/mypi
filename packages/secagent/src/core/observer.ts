import { randomUUID } from "node:crypto";
import { budgetPressure } from "./budget.ts";
import type { SecurityDecision, SecurityObserverSignal, SecurityState } from "./types.ts";

function selectedTool(decision: SecurityDecision): string | undefined {
	return decision.candidates.find((candidate) => candidate.id === decision.selectedActionId)?.tool.toLowerCase();
}

function signal(
	kind: SecurityObserverSignal["kind"],
	severity: SecurityObserverSignal["severity"],
	reason: string,
	decisionIds: string[],
): SecurityObserverSignal {
	return { id: randomUUID(), kind, severity, reason, decisionIds, createdAt: new Date().toISOString() };
}

export function observeSecurityState(state: SecurityState): SecurityObserverSignal[] {
	const signals: SecurityObserverSignal[] = [];
	const recent = state.decisions.slice(-5);
	const failed = recent.filter((decision) => decision.resultStatus === "failed");
	if (failed.length >= 3)
		signals.push(signal("stalled", "warning", `${failed.length} of the last ${recent.length} decisions failed`, failed.map((item) => item.id)));
	const latest = recent.at(-1);
	if (latest) {
		const tool = selectedTool(latest);
		const repeated = recent.filter((decision) => selectedTool(decision) === tool && decision.resultStatus === "failed");
		if (tool && repeated.length >= 2)
			signals.push(
				signal(
					"repeated-failure",
					"critical",
					`Repeated failed strategy ${tool}; require a materially different action family`,
					repeated.map((item) => item.id),
				),
			);
	}
	const pending = recent.filter((decision) => decision.resultStatus === "pending");
	if (pending.length >= 3)
		signals.push(signal("drift", "warning", "Multiple unresolved decisions indicate execution state drift", pending.map((item) => item.id)));
	if (budgetPressure(state.budget) >= 0.85)
		signals.push(signal("context-pressure", "warning", "Execution budget is above 85%; prioritize high-confidence completion paths", recent.map((item) => item.id)));
	if (state.stage === "report" && state.evidenceGraph.verifications.some((item) => item.status === "insufficient"))
		signals.push(signal("termination-risk", "warning", "Report stage reached with unresolved verification gaps", recent.map((item) => item.id)));
	return signals;
}

export interface OperationalMemory {
	facts: string[];
	ideas: string[];
	constraints: string[];
	failures: string[];
}

export function buildOperationalMemory(state: SecurityState): OperationalMemory {
	const facts = state.evidence
		.filter((item) => item.confidence >= 0.7)
		.slice(-12)
		.map((item) => `${item.kind}:${item.summary}`);
	const ideas = state.evidenceGraph.hypotheses
		.filter((item) => item.status === "active")
		.slice(-8)
		.map((item) => item.statement);
	const failures = state.decisions
		.filter((item) => item.resultStatus === "failed" || item.resultStatus === "contradicted")
		.slice(-8)
		.map((item) => `${selectedTool(item) ?? item.selectedActionId}: ${item.actualResult ?? item.resultStatus}`);
	return {
		facts,
		ideas,
		constraints: [...(state.task?.constraints ?? []), ...state.scope.targets.map((target) => `scope:${target.value}`)].slice(-12),
		failures,
	};
}

export interface TerminationAssessment {
	complete: boolean;
	reason: string;
	blockingVerificationIds: string[];
}

export function assessTermination(state: SecurityState): TerminationAssessment {
	const blockingVerificationIds = state.evidenceGraph.verifications
		.filter((item) => item.status === "insufficient")
		.map((item) => item.id);
	if (state.ctfProfile && state.findings.some((finding) => finding.verified && /flag|capture|objective/i.test(finding.summary)))
		return { complete: true, reason: "Verified CTF objective evidence has been recorded", blockingVerificationIds: [] };
	if (state.task?.successCriteria.length && state.findings.some((finding) => finding.verified) && blockingVerificationIds.length === 0)
		return { complete: true, reason: "Verified findings exist and no unresolved verification records remain", blockingVerificationIds };
	return {
		complete: false,
		reason: blockingVerificationIds.length
			? "Verification gaps remain"
			: "No verified completion evidence satisfies the external termination guard",
		blockingVerificationIds,
	};
}
