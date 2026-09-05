import { randomUUID } from "node:crypto";
import { summarizeUnknown } from "../core/audit.ts";
import { assessBudget } from "../core/budget.ts";
import { rankCandidates } from "../core/planner.ts";
import { assessToolRisk, decidePermission } from "../core/policy.ts";
import { assessProtectedPaths } from "../core/protected-paths.ts";
import { assessToolScope } from "../core/scope.ts";
import type { SecurityActionRecord, SecurityDecision, SecurityEvidence, ToolAuditRecord } from "../core/types.ts";
import type { SecAgentRuntime } from "../runtime.ts";
import type { SecurityToolExecutionContext, SecurityToolExecutionResult } from "./adapter.ts";
import { getSecurityToolAdapter } from "./registry.ts";
import { hashSecurityValue } from "./standard.ts";

interface SecurityGatewayRequestBase {
	tool: string;
	input: Record<string, unknown>;
	idempotencyKey?: string;
}
export interface SecurityGatewayIntent {
	goal: string;
	rationale: string;
	expectedResult: string;
	evidenceIds?: string[];
}
export type SecurityGatewayRequest = SecurityGatewayRequestBase &
	({ decisionId: string; intent?: never } | { decisionId?: never; intent: SecurityGatewayIntent });
export interface SecurityGatewayContext extends SecurityToolExecutionContext {
	confirm?: (title: string, message: string) => Promise<boolean>;
}
function failed(message: string): SecurityToolExecutionResult {
	return { ok: false, diagnostic: { code: "precondition", message }, evidence: [] };
}

function createAtomicDecision(
	runtime: SecAgentRuntime,
	request: SecurityGatewayRequest & { intent: SecurityGatewayIntent },
): SecurityDecision | string {
	const state = runtime.snapshot().state;
	const budget = assessBudget(state.budget, "decision");
	if (!budget.allowed) return budget.reason ?? "Decision budget exhausted";
	const adapter = getSecurityToolAdapter(request.tool);
	const actionId = randomUUID();
	const selected = rankCandidates(
		[
			{
				id: actionId,
				tool: request.tool,
				description: request.intent.goal.trim() || `Execute ${request.tool}`,
				goalRelevance: 1,
				informationGain: 0.7,
				confidence: 0.8,
				cost: 0.2,
				preconditions: [...(adapter?.metadata.preconditions ?? [])],
				targets: adapter?.extractTargets(request.input),
				expectedEvidence: [request.intent.expectedResult],
			},
		],
		{ state },
	)[0];
	if (!selected) return "Atomic action could not be ranked";
	const createdAt = new Date().toISOString();
	const decision: SecurityDecision = {
		id: randomUUID(),
		createdAt,
		goal: request.intent.goal.trim() || state.goal,
		stage: state.stage,
		evidenceIds: [...(request.intent.evidenceIds ?? [])],
		candidates: [selected],
		selectedActionId: selected.id,
		rationale: request.intent.rationale.trim(),
		expectedResult: request.intent.expectedResult.trim(),
		resultStatus: "pending",
		planRevision: state.decisions.length + 1,
		attempt: state.decisions.filter((item) => item.goal === state.goal).length + 1,
		budgetSnapshot: structuredClone(state.budget),
	};
	runtime.append({ type: "decision_recorded", decision, createdAt });
	runtime.append({ type: "budget_consumed", resource: "decision", amount: 1, createdAt });
	return decision;
}

export class SecurityExecutionGateway {
	private readonly runtime: SecAgentRuntime;
	private readonly inFlightDecisionIds = new Set<string>();
	constructor(runtime: SecAgentRuntime) {
		this.runtime = runtime;
	}

	async execute(
		request: SecurityGatewayRequest,
		context: SecurityGatewayContext,
	): Promise<SecurityToolExecutionResult> {
		const startedAt = new Date().toISOString();
		const adapter = getSecurityToolAdapter(request.tool);
		const requestedInputHash = hashSecurityValue(request.input);
		const initialState = this.runtime.snapshot().state;
		const resolved = request.intent
			? createAtomicDecision(this.runtime, request as SecurityGatewayRequest & { intent: SecurityGatewayIntent })
			: initialState.decisions.find((item) => item.id === request.decisionId);
		const decision = typeof resolved === "string" ? undefined : resolved;
		const decisionId = decision?.id ?? request.decisionId;
		const resolutionError =
			typeof resolved === "string"
				? resolved
				: !resolved
					? `Decision ${request.decisionId ?? "(atomic)"} does not exist`
					: undefined;
		const state = this.runtime.snapshot().state;
		const risk = assessToolRisk(request.tool, request.input);
		const scope = assessToolScope(request.tool, request.input, state.scope);
		const protectedPaths = assessProtectedPaths(request.input, context.cwd);
		const permission = decidePermission(state.policyMode, risk.level);
		const autonomousScopeWarning = state.policyMode === "autonomous" && !scope.allowed;
		const audit: ToolAuditRecord = {
			id: randomUUID(),
			toolCallId: `gateway-${randomUUID()}`,
			toolName: request.tool,
			decisionId,
			createdAt: startedAt,
			risk,
			scope,
			policyMode: state.policyMode,
			policyDecision: autonomousScopeWarning ? "warn" : permission,
			blocked: false,
			warnings: autonomousScopeWarning ? scope.reasons : undefined,
			inputSummary: summarizeUnknown(request.input),
			requestedInputHash,
			cwd: context.cwd,
			idempotencyKey: request.idempotencyKey,
		};
		let action: SecurityActionRecord | undefined;
		const updateAction = (
			status: SecurityActionRecord["status"],
			updates: Partial<SecurityActionRecord> = {},
		): void => {
			if (!action) return;
			action = { ...action, ...updates, status };
			this.runtime.append({ type: "action_recorded", action, createdAt: new Date().toISOString() });
		};
		const finish = (result: SecurityToolExecutionResult, blocked = false): SecurityToolExecutionResult => {
			audit.completedAt = new Date().toISOString();
			audit.blocked = blocked;
			audit.isError = !result.ok;
			audit.blockReason = blocked ? result.diagnostic?.message : undefined;
			audit.resultSummary = summarizeUnknown(result.output ?? result.diagnostic ?? "no output");
			if (result.execution) {
				audit.normalizedInputHash = result.execution.normalizedInputHash;
				audit.argvHash = result.execution.argvHash;
				audit.command = result.execution.command;
				audit.actualArgs = [...result.execution.args];
				audit.toolVersion = result.execution.version;
				audit.resultSource = result.execution.resultSource;
			}
			this.runtime.appendAudit(audit);
			return result;
		};
		const finishDecision = (result: SecurityToolExecutionResult, blocked = false): SecurityToolExecutionResult => {
			const completed = finish(result, blocked);
			const completedAt = audit.completedAt ?? new Date().toISOString();
			updateAction(result.ok ? "succeeded" : "failed", {
				completedAt,
				resultSummary: audit.resultSummary,
				normalizedInputHash: result.execution?.normalizedInputHash,
				argvHash: result.execution?.argvHash,
				command: result.execution?.command,
				resultSource: result.execution?.resultSource,
			});
			this.runtime.append({
				type: "decision_completed",
				decisionId: decision?.id ?? decisionId ?? "missing",
				actualResult: audit.resultSummary ?? (result.ok ? "tool completed" : "tool failed"),
				status: result.ok ? "succeeded" : "failed",
				createdAt: completedAt,
			});
			return completed;
		};
		if (resolutionError || !decision) return finish(failed(resolutionError ?? "Decision does not exist"), true);
		const idempotencyKey = request.idempotencyKey?.trim() || randomUUID();
		const duplicate = state.actions.find((item) => item.idempotencyKey === idempotencyKey);
		if (duplicate)
			return finish(
				failed(
					duplicate.status === "unknown"
						? `Action ${duplicate.id} has unknown completion state and requires verification`
						: `Action ${duplicate.id} already exists with status ${duplicate.status}`,
				),
				true,
			);
		if (this.inFlightDecisionIds.has(decision.id))
			return finish(failed(`Decision ${decision.id} is already executing`), true);
		if (decision.resultStatus && decision.resultStatus !== "pending")
			return finish(failed(`Decision ${decision.id} is already ${decision.resultStatus}`), true);
		const selected = decision.candidates.find((candidate) => candidate.id === decision.selectedActionId);
		if (!selected || selected.tool.toLowerCase() !== request.tool.toLowerCase())
			return finish(failed(`Decision ${decision.id} does not authorize tool ${request.tool}`), true);
		action = {
			id: randomUUID(),
			idempotencyKey,
			decisionId: decision.id,
			toolName: request.tool,
			status: "planned",
			requestedInputHash,
			createdAt: startedAt,
		};
		this.runtime.append({ type: "action_recorded", action, createdAt: startedAt });
		this.inFlightDecisionIds.add(decision.id);
		try {
			if (!adapter) return finishDecision(failed(`No audited adapter is registered for ${request.tool}`), true);
			if (protectedPaths.blocked) return finishDecision(failed(protectedPaths.reasons.join("; ")), true);
			if (!scope.allowed && !autonomousScopeWarning) return finishDecision(failed(scope.reasons.join("; ")), true);
			const budget = assessBudget(state.budget, "tool-call");
			if (!budget.allowed) return finishDecision(failed(budget.reason ?? "Tool-call budget exhausted"), true);
			if (permission === "confirm") {
				if (!context.confirm) return finishDecision(failed(`${risk.level} requires interactive approval`), true);
				const approved = await context.confirm(
					`SecAgent ${risk.level} approval`,
					`${request.tool}\n${audit.inputSummary}\n\nRisk: ${risk.reasons.join(", ")}\nScope: ${scope.reasons.join(", ")}`,
				);
				audit.userApproved = approved;
				if (!approved) return finishDecision(failed("Rejected by operator"), true);
			}
			const availability = await adapter.checkAvailability(context);
			if (!availability.available)
				return finishDecision({ ok: false, diagnostic: availability.diagnostic, evidence: [] });
			const preconditions = await adapter.checkPreconditions(request.input, context);
			if (preconditions.length > 0) return finishDecision(failed(preconditions.join("; ")));
			this.runtime.append({
				type: "budget_consumed",
				resource: "tool-call",
				amount: 1,
				createdAt: new Date().toISOString(),
			});
			updateAction("started", { startedAt: new Date().toISOString() });
			const result = await adapter.execute(request.input, context);
			for (const normalized of result.evidence) {
				const evidence: SecurityEvidence = {
					id: randomUUID(),
					kind: normalized.kind ?? "observation",
					summary: normalized.summary,
					source: normalized.source,
					sha256: normalized.sha256,
					confidence: normalized.confidence,
					decisionIds: [decision.id],
					targetRefs: normalized.targetRefs ? [...normalized.targetRefs] : undefined,
					createdAt: new Date().toISOString(),
				};
				this.runtime.append({ type: "evidence_added", evidence, createdAt: evidence.createdAt });
			}
			return finishDecision(result);
		} catch (error) {
			return finishDecision({
				ok: false,
				diagnostic: {
					code: "execution",
					message: `${request.tool} adapter failed: ${error instanceof Error ? error.message : String(error)}`,
					command: request.tool,
				},
				evidence: [],
			});
		} finally {
			this.inFlightDecisionIds.delete(decision.id);
		}
	}
}
