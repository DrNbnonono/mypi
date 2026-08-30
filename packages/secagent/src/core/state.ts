import type { PolicyMode, SecurityEvent, SecurityState } from "./types.ts";

export const SECURITY_EVENT_ENTRY = "secagent:event";

export interface SecuritySessionStore {
	getBranch(): Array<{ type: string; customType?: string; data?: unknown }>;
	appendCustomEntry(customType: string, data?: unknown): string;
}

export function createInitialSecurityState(): SecurityState {
	return {
		version: 4,
		revision: 0,
		goal: "",
		stage: "understanding",
		policyMode: "strict",
		isolation: { status: "unverified" },
		scope: { targets: [] },
		evidence: [],
		hypotheses: [],
		rejectedHypotheses: [],
		findings: [],
		decisions: [],
	};
}

export function applySecurityEvent(state: SecurityState, event: SecurityEvent): SecurityState {
	const next: SecurityState = {
		...state,
		revision: state.revision + 1,
		isolation: { ...state.isolation },
		scope: { ...state.scope, targets: state.scope.targets.map((target) => ({ ...target })) },
		evidence: state.evidence.map((item) => ({ ...item })),
		hypotheses: [...state.hypotheses],
		rejectedHypotheses: [...state.rejectedHypotheses],
		findings: state.findings.map((item) => ({ ...item })),
		decisions: state.decisions.map((decision) => ({
			...decision,
			candidates: decision.candidates.map((candidate) => ({ ...candidate })),
		})),
	};

	switch (event.type) {
		case "task_started":
			return {
				...createInitialSecurityState(),
				revision: next.revision,
				task: event.task,
				goal: event.task.goal,
				policyMode: state.policyMode,
				isolation: state.isolation,
				autonomousAuthorization: state.autonomousAuthorization,
			};
		case "stage_changed":
			next.stage = event.stage;
			return next;
		case "policy_changed":
			next.policyMode = event.mode;
			return next;
		case "isolation_changed":
			next.isolation = { ...event.isolation };
			return next;
		case "autonomous_authorized":
			next.autonomousAuthorization = { ...event.authorization };
			return next;
		case "scope_set":
			next.scope = { ...event.scope, targets: event.scope.targets.map((target) => ({ ...target })) };
			return next;
		case "evidence_added":
			next.evidence.push({ ...event.evidence });
			return next;
		case "hypothesis_added":
			next.hypotheses.push(event.hypothesis);
			return next;
		case "hypothesis_rejected":
			next.rejectedHypotheses.push(event.hypothesis);
			next.hypotheses = next.hypotheses.filter((item) => item !== event.hypothesis);
			return next;
		case "finding_added":
			next.findings.push({ ...event.finding });
			return next;
		case "decision_recorded":
			next.decisions.push({
				...event.decision,
				candidates: event.decision.candidates.map((candidate) => ({ ...candidate })),
			});
			return next;
		case "decision_completed": {
			const decision = next.decisions.find((item) => item.id === event.decisionId);
			if (decision) {
				decision.actualResult = event.actualResult;
				decision.resultStatus = event.status;
			}
			return next;
		}
	}
}

export function replaySecurityState(store: SecuritySessionStore): SecurityState {
	let state = createInitialSecurityState();
	for (const entry of store.getBranch()) {
		if (entry.type !== "custom" || entry.customType !== SECURITY_EVENT_ENTRY) continue;
		if (!entry.data || typeof entry.data !== "object") continue;
		state = applySecurityEvent(state, entry.data as SecurityEvent);
	}
	return state;
}

export function appendSecurityEvent(
	store: SecuritySessionStore,
	state: SecurityState,
	event: SecurityEvent,
): SecurityState {
	store.appendCustomEntry(SECURITY_EVENT_ENTRY, event);
	return applySecurityEvent(state, event);
}

export function appendPolicyChange(
	store: SecuritySessionStore,
	state: SecurityState,
	mode: PolicyMode,
	operator: string,
	reason: string,
): SecurityState {
	return appendSecurityEvent(store, state, {
		type: "policy_changed",
		mode,
		operator,
		reason,
		createdAt: new Date().toISOString(),
	});
}
