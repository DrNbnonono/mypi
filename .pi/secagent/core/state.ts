import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PolicyMode, SecurityEvent, SecurityState } from "./types.ts";

export const SECURITY_EVENT_ENTRY = "secagent:event";

export function createInitialSecurityState(): SecurityState {
	return {
		version: 3,
		revision: 0,
		goal: "",
		stage: "understanding",
		policyMode: "strict",
		scope: { targets: [] },
		evidence: [],
		hypotheses: [],
		findings: [],
		decisions: [],
	};
}

export function applySecurityEvent(state: SecurityState, event: SecurityEvent): SecurityState {
	const next: SecurityState = {
		...state,
		revision: state.revision + 1,
		scope: { ...state.scope, targets: [...state.scope.targets] },
		evidence: [...state.evidence],
		hypotheses: [...state.hypotheses],
		findings: [...state.findings],
		decisions: [...state.decisions],
	};

	switch (event.type) {
		case "task_started":
			return {
				...createInitialSecurityState(),
				revision: next.revision,
				goal: event.goal,
				policyMode: state.policyMode,
			};
		case "stage_changed":
			next.stage = event.stage;
			return next;
		case "policy_changed":
			next.policyMode = event.mode;
			return next;
		case "scope_set":
			next.scope = {
				...event.scope,
				targets: [...event.scope.targets],
			};
			return next;
		case "evidence_added":
			next.evidence.push(event.evidence);
			return next;
		case "hypothesis_added":
			next.hypotheses.push(event.hypothesis);
			return next;
		case "finding_added":
			next.findings.push(event.finding);
			return next;
		case "decision_recorded":
			next.decisions.push(event.decision);
			return next;
	}
}

export function replaySecurityState(ctx: ExtensionContext): SecurityState {
	let state = createInitialSecurityState();

	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "custom" || entry.customType !== SECURITY_EVENT_ENTRY) continue;
		const event = entry.data as SecurityEvent | undefined;
		if (!event) continue;
		state = applySecurityEvent(state, event);
	}

	return state;
}

export function appendSecurityEvent(pi: ExtensionAPI, state: SecurityState, event: SecurityEvent): SecurityState {
	pi.appendEntry<SecurityEvent>(SECURITY_EVENT_ENTRY, event);
	return applySecurityEvent(state, event);
}

export function appendPolicyChange(pi: ExtensionAPI, state: SecurityState, mode: PolicyMode): SecurityState {
	return appendSecurityEvent(pi, state, {
		type: "policy_changed",
		mode,
		createdAt: new Date().toISOString(),
	});
}
