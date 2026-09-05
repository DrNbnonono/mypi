import { DEFAULT_SECURITY_BUDGET } from "./budget.ts";
import type { PolicyMode, SecurityEvent, SecurityState } from "./types.ts";

export const SECURITY_EVENT_ENTRY = "secagent:event";

export interface SecuritySessionStore {
	getBranch(): Array<{ type: string; customType?: string; data?: unknown }>;
	appendCustomEntry(customType: string, data?: unknown): string;
}

export function createInitialSecurityState(): SecurityState {
	return {
		version: 6,
		revision: 0,
		goal: "",
		stage: "understanding",
		policyMode: "strict",
		isolation: { status: "unverified" },
		scope: { targets: [] },
		evidence: [],
		evidenceGraph: { edges: [], hypotheses: [], verifications: [] },
		targetGraph: { nodes: [], edges: [], revision: 0 },
		hypotheses: [],
		rejectedHypotheses: [],
		findings: [],
		decisions: [],
		actions: [],
		replans: [],
		observerSignals: [],
		delegations: [],
		budget: structuredClone(DEFAULT_SECURITY_BUDGET),
	};
}

function cloneState(state: SecurityState): SecurityState {
	return {
		...state,
		revision: state.revision + 1,
		isolation: { ...state.isolation },
		scope: { ...state.scope, targets: state.scope.targets.map((target) => ({ ...target })) },
		evidence: state.evidence.map((item) => ({
			...item,
			decisionIds: item.decisionIds ? [...item.decisionIds] : undefined,
		})),
		evidenceGraph: {
			edges: state.evidenceGraph.edges.map((edge) => ({ ...edge })),
			hypotheses: state.evidenceGraph.hypotheses.map((hypothesis) => ({ ...hypothesis })),
			verifications: state.evidenceGraph.verifications.map((verification) => ({
				...verification,
				evidenceIds: [...verification.evidenceIds],
			})),
		},
		targetGraph: {
			nodes: state.targetGraph.nodes.map((node) => ({ ...node, evidenceIds: [...node.evidenceIds] })),
			edges: state.targetGraph.edges.map((edge) => ({ ...edge, evidenceIds: [...edge.evidenceIds] })),
			revision: state.targetGraph.revision,
		},
		competition: state.competition ? structuredClone(state.competition) : undefined,
		hypotheses: [...state.hypotheses],
		rejectedHypotheses: [...state.rejectedHypotheses],
		findings: state.findings.map((item) => ({
			...item,
			evidenceIds: item.evidenceIds ? [...item.evidenceIds] : undefined,
		})),
		decisions: state.decisions.map((decision) => ({
			...decision,
			evidenceIds: [...decision.evidenceIds],
			candidates: decision.candidates.map((candidate) => ({
				...candidate,
				preconditions: [...candidate.preconditions],
				targets: candidate.targets ? [...candidate.targets] : undefined,
				expectedEvidence: candidate.expectedEvidence ? [...candidate.expectedEvidence] : undefined,
				successCriteria: candidate.successCriteria ? [...candidate.successCriteria] : undefined,
				stopConditions: candidate.stopConditions ? [...candidate.stopConditions] : undefined,
				fallbackActionIds: candidate.fallbackActionIds ? [...candidate.fallbackActionIds] : undefined,
			})),
			budgetSnapshot: decision.budgetSnapshot ? structuredClone(decision.budgetSnapshot) : undefined,
		})),
		actions: state.actions.map((action) => ({ ...action })),
		replans: state.replans.map((replan) => ({ ...replan })),
		observerSignals: state.observerSignals.map((signal) => ({ ...signal, decisionIds: [...signal.decisionIds] })),
		delegations: state.delegations.map((delegation) => ({ ...delegation, evidenceIds: [...delegation.evidenceIds] })),
		budget: structuredClone(state.budget),
		ctfProfile: state.ctfProfile ? structuredClone(state.ctfProfile) : undefined,
	};
}

export function applySecurityEvent(state: SecurityState, event: SecurityEvent): SecurityState {
	const next = cloneState(state);

	switch (event.type) {
		case "task_started":
			return {
				...createInitialSecurityState(),
				revision: next.revision,
				task: event.task,
				goal: event.task.goal,
				policyMode: state.policyMode === "autonomous" ? "strict" : state.policyMode,
				isolation: state.isolation,
			};
		case "stage_changed":
			next.stage = event.stage;
			return next;
		case "policy_changed":
			next.policyMode = event.mode;
			return next;
		case "isolation_changed":
			if (next.isolation.status !== event.isolation.status || next.isolation.source !== event.isolation.source)
				next.autonomousAuthorization = undefined;
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
		case "evidence_linked":
			next.evidenceGraph.edges.push({ ...event.edge });
			return next;
		case "target_node_recorded": {
			const node = { ...event.node, evidenceIds: [...event.node.evidenceIds] };
			const index = next.targetGraph.nodes.findIndex((item) => item.id === node.id);
			if (index >= 0) next.targetGraph.nodes[index] = node;
			else next.targetGraph.nodes.push(node);
			next.targetGraph.revision += 1;
			return next;
		}
		case "target_edge_recorded": {
			const edge = { ...event.edge, evidenceIds: [...event.edge.evidenceIds] };
			const index = next.targetGraph.edges.findIndex((item) => item.id === edge.id);
			if (index >= 0) next.targetGraph.edges[index] = edge;
			else next.targetGraph.edges.push(edge);
			next.targetGraph.revision += 1;
			return next;
		}
		case "competition_state_changed":
			next.competition = structuredClone(event.competition);
			return next;
		case "hypothesis_added":
			if (!next.hypotheses.includes(event.hypothesis)) next.hypotheses.push(event.hypothesis);
			return next;
		case "hypothesis_rejected":
			if (!next.rejectedHypotheses.includes(event.hypothesis)) next.rejectedHypotheses.push(event.hypothesis);
			next.hypotheses = next.hypotheses.filter((item) => item !== event.hypothesis);
			for (const hypothesis of next.evidenceGraph.hypotheses) {
				if (hypothesis.statement === event.hypothesis) {
					hypothesis.status = "rejected";
					hypothesis.updatedAt = event.createdAt;
				}
			}
			return next;
		case "hypothesis_recorded":
			next.evidenceGraph.hypotheses.push({ ...event.hypothesis });
			if (!next.hypotheses.includes(event.hypothesis.statement)) next.hypotheses.push(event.hypothesis.statement);
			return next;
		case "hypothesis_verified": {
			next.evidenceGraph.verifications.push({
				...event.verification,
				evidenceIds: [...event.verification.evidenceIds],
			});
			const hypothesis = next.evidenceGraph.hypotheses.find((item) => item.id === event.verification.hypothesisId);
			if (hypothesis) {
				hypothesis.status =
					event.verification.status === "verified"
						? "verified"
						: event.verification.status === "contradicted"
							? "contradicted"
							: "active";
				hypothesis.updatedAt = event.createdAt;
				if (hypothesis.status !== "active")
					next.hypotheses = next.hypotheses.filter((item) => item !== hypothesis.statement);
				if (hypothesis.status === "contradicted" && !next.rejectedHypotheses.includes(hypothesis.statement))
					next.rejectedHypotheses.push(hypothesis.statement);
			}
			return next;
		}
		case "finding_added":
			next.findings.push({
				...event.finding,
				evidenceIds: event.finding.evidenceIds ? [...event.finding.evidenceIds] : undefined,
			});
			return next;
		case "decision_recorded":
			next.decisions.push({
				...event.decision,
				candidates: event.decision.candidates.map((candidate) => ({ ...candidate })),
			});
			return next;
		case "action_recorded": {
			const action = { ...event.action };
			const index = next.actions.findIndex((item) => item.id === action.id);
			if (index >= 0) next.actions[index] = action;
			else next.actions.push(action);
			return next;
		}
		case "decision_completed": {
			const decision = next.decisions.find((item) => item.id === event.decisionId);
			if (decision) {
				decision.actualResult = event.actualResult;
				decision.resultStatus = event.status;
			}
			return next;
		}
		case "replan_recorded":
			next.replans.push({ ...event.replan });
			return next;
		case "observer_signal":
			next.observerSignals.push({ ...event.signal, decisionIds: [...event.signal.decisionIds] });
			return next;
		case "delegation_recorded": {
			const delegation = { ...event.delegation, evidenceIds: [...event.delegation.evidenceIds] };
			const index = next.delegations.findIndex((item) => item.id === delegation.id);
			if (index >= 0) next.delegations[index] = delegation;
			else next.delegations.push(delegation);
			return next;
		}
		case "budget_configured":
			next.budget.limits = { ...event.limits };
			return next;
		case "budget_consumed":
			if (event.resource === "decision") next.budget.usage.decisionsUsed += event.amount;
			else if (event.resource === "tool-call") next.budget.usage.toolCallsUsed += event.amount;
			else next.budget.usage.replansUsed += event.amount;
			return next;
		case "ctf_profiled":
			next.ctfProfile = structuredClone(event.profile);
			return next;
	}
}

export function replaySecurityState(store: SecuritySessionStore): SecurityState {
	let state = createInitialSecurityState();
	for (const entry of store.getBranch()) {
		if (entry.type !== "custom" || entry.customType !== SECURITY_EVENT_ENTRY) continue;
		if (!entry.data || typeof entry.data !== "object") continue;
		state = applySecurityEvent(state, entry.data as SecurityEvent);
	}
	state.actions = state.actions.map((action) =>
		action.status === "started" ? { ...action, status: "unknown", verificationRequired: true } : action,
	);
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
