import { randomUUID } from "node:crypto";
import { Type } from "typebox";
import { delegationRecord, recommendAgentDispatch } from "./agents/control-plane.ts";
import { assessBudget } from "./core/budget.ts";
import type { SecurityDelegationRecord, SecurityEvidence } from "./core/types.ts";
import { defineSecAgentExtension, type SecAgentInlineExtension } from "./host-contract.ts";
import {
	buildSubagentDelegationRequest,
	parseDelegatedAgentResult,
	runSubagentDelegation,
	type SubagentEventBus,
} from "./integrations/subagent-delegation.ts";
import type { SecAgentRuntime } from "./runtime.ts";

const DelegateRunParams = Type.Object({
	objective: Type.Optional(Type.String()),
	parentDecisionId: Type.Optional(Type.String()),
});

export function createSecAgentDelegationExtension(runtime: SecAgentRuntime): SecAgentInlineExtension {
	return defineSecAgentExtension("secagent-delegation", (pi) => {
		pi.on("before_agent_start", async (event) => ({
			systemPrompt: `${event.systemPrompt}\n\nSecAgent delegation rule: specialists are bounded reasoning workers, not independent execution authorities. Use security_delegate_run when a focused second analysis is useful; the parent Security Planner remains responsible for scope, execution, verification, and final findings.`,
		}));
		pi.registerTool<typeof DelegateRunParams, unknown>({
			name: "security_delegate_run",
			label: "Security Delegate Run",
			description:
				"Run a bounded existing SecAgent specialist through pi-subagents structured delegation. Child side-effectful/network tools are blocked; returned evidence and proposals re-enter the parent SecurityState.",
			promptSnippet: "security_delegate_run: run a bounded reasoning specialist and merge structured evidence",
			parameters: DelegateRunParams,
			async execute(_id, params, _signal, _update, ctx) {
				const state = runtime.snapshot().state;
				const budget = assessBudget(state.budget, "tool-call");
				if (!budget.allowed)
					return {
						content: [{ type: "text", text: `Blocked: ${budget.reason}` }],
						isError: true,
						details: undefined,
					};
				const recommendation = recommendAgentDispatch(state, params.objective, params.parentDecisionId);
				const planned = delegationRecord(recommendation, params.parentDecisionId);
				runtime.append({ type: "delegation_recorded", delegation: planned, createdAt: planned.createdAt });
				const running: SecurityDelegationRecord = { ...planned, status: "running" };
				runtime.append({ type: "delegation_recorded", delegation: running, createdAt: new Date().toISOString() });
				const ownerRunId = state.task?.id ?? `secagent-${randomUUID()}`;
				const request = buildSubagentDelegationRequest(recommendation, ctx.cwd, ownerRunId);
				const response = await runSubagentDelegation(pi.events as SubagentEventBus, request);
				const result = parseDelegatedAgentResult(response);
				const evidenceIds: string[] = [];
				if (result) {
					for (const proposal of result.evidence) {
						const evidence: SecurityEvidence = {
							id: randomUUID(),
							kind: "observation",
							summary: proposal.summary,
							source: proposal.source ?? `subagent:${recommendation.role}`,
							confidence: proposal.confidence,
							targetRefs: [...recommendation.envelope.authorizedTargets],
							agentRole: recommendation.role,
							createdAt: new Date().toISOString(),
						};
						evidenceIds.push(evidence.id);
						runtime.append({ type: "evidence_added", evidence, createdAt: evidence.createdAt });
					}
				}
				const completedAt = new Date().toISOString();
				const completed: SecurityDelegationRecord = {
					...planned,
					status: response.status === "completed" && result?.status !== "failed" ? "completed" : "failed",
					evidenceIds,
					completedAt,
				};
				runtime.append({ type: "delegation_recorded", delegation: completed, createdAt: completedAt });
				const consumedToolCalls = Math.max(0, response.usage?.toolCalls ?? 0);
				if (consumedToolCalls > 0)
					runtime.append({
						type: "budget_consumed",
						resource: "tool-call",
						amount: consumedToolCalls,
						createdAt: completedAt,
					});
				const details = { recommendation, requestId: request.requestId, response, result, evidenceIds };
				if (response.status !== "completed" || !result)
					return {
						content: [
							{
								type: "text",
								text: `Delegation ${response.status}: ${response.error ?? "no structured result"}`,
							},
						],
						isError: true,
						details,
					};
				return { content: [{ type: "text", text: JSON.stringify(details, null, 2) }], details };
			},
		});
	});
}
