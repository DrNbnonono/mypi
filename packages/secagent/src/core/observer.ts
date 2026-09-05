import { randomUUID } from "node:crypto";
import { budgetPressure } from "./budget.ts";
import { strategyKey } from "./planner.ts";
import type { SecurityDecision, SecurityObserverSignal, SecurityState } from "./types.ts";

function selectedStrategy(decision: SecurityDecision): string | undefined {
	const action = decision.candidates.find((candidate) => candidate.id === decision.selectedActionId);
	return action ? strategyKey(action) : undefined;
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
		signals.push(
			signal(
				"stalled",
				"warning",
				`${failed.length} of the last ${recent.length} decisions failed`,
				failed.map((item) => item.id),
			),
		);
	const latest = recent.at(-1);
	if (latest) {
		const strategy = selectedStrategy(latest);
		const repeated = recent.filter(
			(decision) => selectedStrategy(decision) === strategy && decision.resultStatus === "failed",
		);
		if (strategy && repeated.length >= 2)
			signals.push(
				signal(
					"repeated-failure",
					"critical",
					`Repeated failed strategy ${strategy}; require a materially different capability family`,
					repeated.map((item) => item.id),
				),
			);
	}
	const pending = recent.filter((decision) => decision.resultStatus === "pending");
	if (pending.length >= 3)
		signals.push(
			signal(
				"drift",
				"warning",
				"Multiple unresolved decisions indicate execution state drift",
				pending.map((item) => item.id),
			),
		);
	if (budgetPressure(state.budget) >= 0.85)
		signals.push(
			signal(
				"context-pressure",
				"warning",
				"Execution budget is above 85%; prioritize high-confidence completion paths",
				recent.map((item) => item.id),
			),
		);
	if (state.stage === "report" && state.evidenceGraph.verifications.some((item) => item.status === "insufficient"))
		signals.push(
			signal(
				"termination-risk",
				"warning",
				"Report stage reached with unresolved verification gaps",
				recent.map((item) => item.id),
			),
		);
	return signals;
}

export interface OperationalMemory {
	facts: string[];
	ideas: string[];
	constraints: string[];
	failures: string[];
	targets: string[];
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
		.map((item) => `${selectedStrategy(item) ?? item.selectedActionId}: ${item.actualResult ?? item.resultStatus}`);
	return {
		facts,
		ideas,
		targets: state.targetGraph.nodes
			.filter((node) => node.status === "verified" || node.status === "hypothesis")
			.slice(-16)
			.map((node) => `${node.id}:${node.kind}:${node.status}:${node.label}`),
		constraints: [
			...(state.task?.constraints ?? []),
			...state.scope.targets.map((target) => `scope:${target.value}`),
		].slice(-12),
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
	if (
		state.ctfProfile &&
		state.findings.some((finding) => finding.verified && /flag|capture|objective/i.test(finding.summary))
	)
		return {
			complete: true,
			reason: "Verified CTF objective evidence has been recorded",
			blockingVerificationIds: [],
		};
	if (
		state.task?.successCriteria.length &&
		state.findings.some((finding) => finding.verified) &&
		blockingVerificationIds.length === 0
	)
		return {
			complete: true,
			reason: "Verified findings exist and no unresolved verification records remain",
			blockingVerificationIds,
		};
	return {
		complete: false,
		reason: blockingVerificationIds.length
			? "Verification gaps remain"
			: "No verified completion evidence satisfies the external termination guard",
		blockingVerificationIds,
	};
}
