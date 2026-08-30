import { randomUUID } from "node:crypto";
import { summarizeUnknown } from "../core/audit.ts";
import { assessToolRisk, decidePermission } from "../core/policy.ts";
import { assessToolScope } from "../core/scope.ts";
import type { SecurityEvidence, ToolAuditRecord } from "../core/types.ts";
import type { SecAgentRuntime } from "../runtime.ts";
import type { SecurityToolExecutionContext, SecurityToolExecutionResult } from "./adapter.ts";
import { getSecurityToolAdapter } from "./registry.ts";

export interface SecurityGatewayRequest {
	tool: string;
	input: Record<string, unknown>;
	decisionId: string;
}

export interface SecurityGatewayContext extends SecurityToolExecutionContext {
	confirm?: (title: string, message: string) => Promise<boolean>;
}

function failed(message: string): SecurityToolExecutionResult {
	return { ok: false, diagnostic: { code: "precondition", message }, evidence: [] };
}

export class SecurityExecutionGateway {
	private readonly runtime: SecAgentRuntime;

	constructor(runtime: SecAgentRuntime) {
		this.runtime = runtime;
	}

	async execute(request: SecurityGatewayRequest, context: SecurityGatewayContext): Promise<SecurityToolExecutionResult> {
		const startedAt = new Date().toISOString();
		const state = this.runtime.snapshot().state;
		const decision = state.decisions.find((item) => item.id === request.decisionId);
		const adapter = getSecurityToolAdapter(request.tool);
		const risk = assessToolRisk(request.tool, request.input);
		const scope = assessToolScope(request.tool, request.input, state.scope);
		const permission = decidePermission(state.policyMode, risk.level);
		const autonomousScopeWarning = state.policyMode === "autonomous" && !scope.allowed;
		const audit: ToolAuditRecord = {
			id: randomUUID(),
			toolCallId: `gateway-${randomUUID()}`,
			toolName: request.tool,
			decisionId: request.decisionId,
			createdAt: startedAt,
			risk,
			scope,
			policyMode: state.policyMode,
			policyDecision: autonomousScopeWarning ? "warn" : permission,
			blocked: false,
			warnings: autonomousScopeWarning ? scope.reasons : undefined,
			inputSummary: summarizeUnknown(request.input),
		};
		const finish = (result: SecurityToolExecutionResult, blocked = false): SecurityToolExecutionResult => {
			audit.completedAt = new Date().toISOString();
			audit.blocked = blocked;
			audit.isError = !result.ok;
			audit.blockReason = blocked ? result.diagnostic?.message : undefined;
			audit.resultSummary = summarizeUnknown(result.output ?? result.diagnostic ?? "no output");
			this.runtime.appendAudit(audit);
			return result;
		};

		if (!decision) return finish(failed(`Decision ${request.decisionId} does not exist`), true);
		const selected = decision.candidates.find((candidate) => candidate.id === decision.selectedActionId);
		if (!selected || selected.tool.toLowerCase() !== request.tool.toLowerCase())
			return finish(failed(`Decision ${decision.id} does not authorize tool ${request.tool}`), true);
		if (!adapter) return finish(failed(`No audited adapter is registered for ${request.tool}`), true);
		if (!scope.allowed && !autonomousScopeWarning) return finish(failed(scope.reasons.join("; ")), true);
		if (permission === "confirm") {
			if (!context.confirm) return finish(failed(`${risk.level} requires interactive approval`), true);
			const approved = await context.confirm(
				`SecAgent ${risk.level} approval`,
				`${request.tool}\n${audit.inputSummary}\n\nRisk: ${risk.reasons.join(", ")}\nScope: ${scope.reasons.join(", ")}`,
			);
			audit.userApproved = approved;
			if (!approved) return finish(failed("Rejected by operator"), true);
		}

		const availability = await adapter.checkAvailability(context);
		if (!availability.available)
			return finish({ ok: false, diagnostic: availability.diagnostic, evidence: [] });
		const preconditions = await adapter.checkPreconditions(request.input, context);
		if (preconditions.length > 0) return finish(failed(preconditions.join("; ")));
		const result = await adapter.execute(request.input, context);
		for (const normalized of result.evidence) {
			const evidence: SecurityEvidence = {
				id: randomUUID(),
				kind: "observation",
				summary: normalized.summary,
				source: normalized.source,
				confidence: normalized.confidence,
				decisionIds: [request.decisionId],
				createdAt: new Date().toISOString(),
			};
			this.runtime.append({ type: "evidence_added", evidence, createdAt: evidence.createdAt });
		}
		return finish(result);
	}
}
