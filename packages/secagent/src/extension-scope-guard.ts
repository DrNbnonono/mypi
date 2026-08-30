import { randomUUID } from "node:crypto";
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { summarizeUnknown } from "./core/audit.ts";
import { assessToolRisk } from "./core/policy.ts";
import { assessToolScope } from "./core/scope.ts";
import type { ScopeAssessment, SecurityState, ToolAuditRecord } from "./core/types.ts";
import type { SecAgentRuntime } from "./runtime.ts";

export interface ScopeGuardDecision {
	block: boolean;
	reason?: string;
	assessment?: ScopeAssessment;
}

export function evaluateHardScopeGuard(
	toolName: string,
	input: Record<string, unknown>,
	state: SecurityState,
): ScopeGuardDecision {
	if (toolName.startsWith("security_")) return { block: false };
	const assessment = assessToolScope(toolName, input, state.scope);
	if (assessment.allowed) return { block: false, assessment };
	return { block: true, reason: assessment.reasons.join("; ") || "target is outside authorized scope", assessment };
}

export function createSecAgentScopeGuardExtension(runtime: SecAgentRuntime): InlineExtension {
	return {
		name: "secagent-scope-guard",
		factory: (pi) => {
			pi.on("before_agent_start", async (event) => ({
				systemPrompt: `${event.systemPrompt}\n\nSecAgent kernel invariant: target scope is authorization, not an approval preference. Strict, competition, and autonomous modes may change approval friction, but none may widen or bypass security_scope. CTF capabilities are overlays on the same SecAgent and do not create a separate agent or authorization domain.`,
			}));
			pi.on("tool_call", async (event) => {
				const input = event.input as Record<string, unknown>;
				const state = runtime.snapshot().state;
				const decision = evaluateHardScopeGuard(event.toolName, input, state);
				if (!decision.block || !decision.assessment) return undefined;
				const risk = assessToolRisk(event.toolName, input);
				const record: ToolAuditRecord = {
					id: randomUUID(),
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					decisionId: state.decisions.at(-1)?.id,
					createdAt: new Date().toISOString(),
					risk,
					scope: decision.assessment,
					policyMode: state.policyMode,
					policyDecision: "deny",
					blocked: true,
					blockReason: decision.reason,
					inputSummary: summarizeUnknown(input),
				};
				runtime.appendAudit(record);
				return { block: true, reason: `SecAgent scope block: ${decision.reason}` };
			});
		},
	};
}
