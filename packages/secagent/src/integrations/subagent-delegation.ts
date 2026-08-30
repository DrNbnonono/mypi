import { randomUUID } from "node:crypto";
import type { AgentDispatchRecommendation } from "../agents/control-plane.ts";

export const SUBAGENT_DELEGATION_REQUEST_EVENT = "prompt-template:subagent:request";
export const SUBAGENT_DELEGATION_RESPONSE_EVENT = "prompt-template:subagent:response";

export interface SubagentDelegationRequest {
	requestId: string;
	ownerRunId: string;
	nodeId: string;
	agent: string;
	task: string;
	context: "fresh" | "fork";
	cwd: string;
	timeoutMs?: number;
	turnBudget?: { maxTurns: number; graceTurns?: number };
	toolBudget?: { soft?: number; hard: number; block?: string[] | "*" };
	artifacts?: boolean;
	result: { kind: "text" } | { kind: "structured"; schema: Record<string, unknown> };
}

export interface SubagentDelegationUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	turns: number;
	toolCalls: number;
	durationMs: number;
}

export interface SubagentDelegationResponse {
	requestId: string;
	ownerRunId?: string;
	nodeId?: string;
	status:
		| "completed"
		| "failed"
		| "timed_out"
		| "cancelled"
		| "interrupted"
		| "turn_budget_exhausted"
		| "tool_budget_exhausted"
		| "structured_output_failed"
		| "acceptance_failed"
		| "invalid_request"
		| "unavailable_context"
		| "duplicate_node";
	error?: string;
	runId?: string;
	agent?: string;
	model?: string;
	launchContractDigest?: string;
	result?: { kind: "text"; text: string } | { kind: "structured"; value: unknown };
	usage?: SubagentDelegationUsage;
}

export interface SubagentEventBus {
	on(event: string, listener: (payload: unknown) => void): () => void;
	emit(event: string, payload: unknown): void;
}

export interface DelegatedEvidenceProposal {
	summary: string;
	source?: string;
	confidence: number;
}

export interface DelegatedAgentResult {
	status: "completed" | "partial" | "blocked" | "failed";
	summary: string;
	observations: string[];
	evidence: DelegatedEvidenceProposal[];
	gaps: string[];
	proposedActions: string[];
}

const RESULT_SCHEMA: Record<string, unknown> = {
	type: "object",
	properties: {
		status: { type: "string", enum: ["completed", "partial", "blocked", "failed"] },
		summary: { type: "string" },
		observations: { type: "array", items: { type: "string" }, maxItems: 32 },
		evidence: {
			type: "array",
			maxItems: 32,
			items: {
				type: "object",
				properties: {
					summary: { type: "string" },
					source: { type: "string" },
					confidence: { type: "number", minimum: 0, maximum: 1 },
				},
				required: ["summary", "confidence"],
				additionalProperties: false,
			},
		},
		gaps: { type: "array", items: { type: "string" }, maxItems: 32 },
		proposedActions: { type: "array", items: { type: "string" }, maxItems: 16 },
	},
	required: ["status", "summary", "observations", "evidence", "gaps", "proposedActions"],
	additionalProperties: false,
};

const BLOCKED_CHILD_TOOLS = [
	"bash",
	"mcp",
	"edit",
	"write",
	"security_execute",
	"security_static_execute",
	"security_scope",
	"security_state",
	"security_plan",
	"security_delegate",
	"security_delegate_run",
];

function delegationTask(recommendation: AgentDispatchRecommendation): string {
	const envelope = recommendation.envelope;
	return [
		`Objective: ${envelope.objective}`,
		`Scenario: ${envelope.scenario}`,
		`Authorized targets: ${envelope.authorizedTargets.join(", ") || "none; reason only from supplied evidence"}`,
		`Capability hints: ${envelope.capabilityHints.join(", ") || "general analysis"}`,
		`Available evidence IDs: ${envelope.availableEvidenceIds.join(", ") || "none"}`,
		`Required evidence: ${envelope.requiredEvidence.join("; ") || "none specified"}`,
		`Success criteria: ${envelope.successCriteria.join("; ") || "advance the objective with traceable evidence"}`,
		`Constraints: ${envelope.constraints.join("; ")}`,
		"Execution authority remains with the parent SecAgent. Do not widen scope or attempt side-effectful/network execution. Analyze available context, identify evidence gaps, and propose bounded next actions for the parent planner.",
	].join("\n");
}

function timeoutFor(recommendation: AgentDispatchRecommendation): number {
	const deadline = recommendation.envelope.budget.deadlineAt;
	if (!deadline) return 10 * 60_000;
	const remaining = Date.parse(deadline) - Date.now();
	if (!Number.isFinite(remaining)) return 10 * 60_000;
	return Math.max(5_000, Math.min(10 * 60_000, remaining));
}

export function buildSubagentDelegationRequest(
	recommendation: AgentDispatchRecommendation,
	cwd: string,
	ownerRunId: string,
): SubagentDelegationRequest {
	const hardToolBudget = Math.max(1, Math.min(12, recommendation.envelope.budget.maxToolCalls));
	return {
		requestId: randomUUID(),
		ownerRunId,
		nodeId: recommendation.envelope.taskId,
		agent: recommendation.role,
		task: delegationTask(recommendation),
		context: "fresh",
		cwd,
		timeoutMs: timeoutFor(recommendation),
		turnBudget: { maxTurns: recommendation.envelope.budget.maxTurns, graceTurns: 1 },
		toolBudget: { soft: Math.min(6, hardToolBudget), hard: hardToolBudget, block: BLOCKED_CHILD_TOOLS },
		artifacts: true,
		result: { kind: "structured", schema: RESULT_SCHEMA },
	};
}

export function runSubagentDelegation(
	bus: SubagentEventBus,
	request: SubagentDelegationRequest,
): Promise<SubagentDelegationResponse> {
	return new Promise((resolve) => {
		let settled = false;
		const finish = (response: SubagentDelegationResponse) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			unsubscribe();
			resolve(response);
		};
		const unsubscribe = bus.on(SUBAGENT_DELEGATION_RESPONSE_EVENT, (payload) => {
			if (!payload || typeof payload !== "object") return;
			const response = payload as SubagentDelegationResponse;
			if (response.requestId !== request.requestId) return;
			if (response.ownerRunId && response.ownerRunId !== request.ownerRunId) return;
			if (response.nodeId && response.nodeId !== request.nodeId) return;
			finish(response);
		});
		const timer = setTimeout(
			() => finish({ requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId, status: "timed_out", error: "SecAgent delegation bridge timed out waiting for pi-subagents" }),
			(request.timeoutMs ?? 10 * 60_000) + 5_000,
		);
		bus.emit(SUBAGENT_DELEGATION_REQUEST_EVENT, request);
	});
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, 32) : [];
}

export function parseDelegatedAgentResult(response: SubagentDelegationResponse): DelegatedAgentResult | undefined {
	if (response.status !== "completed" || response.result?.kind !== "structured") return undefined;
	const value = response.result.value;
	if (!value || typeof value !== "object") return undefined;
	const record = value as Record<string, unknown>;
	const status = record.status;
	const summary = record.summary;
	if (!(["completed", "partial", "blocked", "failed"] as const).includes(status as DelegatedAgentResult["status"])) return undefined;
	if (typeof summary !== "string") return undefined;
	const evidence = Array.isArray(record.evidence)
		? record.evidence.flatMap((item) => {
			if (!item || typeof item !== "object") return [];
			const proposal = item as Record<string, unknown>;
			if (typeof proposal.summary !== "string" || typeof proposal.confidence !== "number") return [];
			return [{
				summary: proposal.summary,
				source: typeof proposal.source === "string" ? proposal.source : undefined,
				confidence: Math.max(0, Math.min(1, proposal.confidence)),
			}];
		})
		: [];
	return {
		status: status as DelegatedAgentResult["status"],
		summary,
		observations: stringArray(record.observations),
		evidence,
		gaps: stringArray(record.gaps),
		proposedActions: stringArray(record.proposedActions).slice(0, 16),
	};
}
