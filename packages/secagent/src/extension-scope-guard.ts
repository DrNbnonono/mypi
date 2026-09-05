import { randomUUID } from "node:crypto";
import { summarizeUnknown } from "./core/audit.ts";
import { assessToolRisk } from "./core/policy.ts";
import { assessProtectedPaths } from "./core/protected-paths.ts";
import { assessToolScope } from "./core/scope.ts";
import type { ScopeAssessment, SecurityState, ToolAuditRecord } from "./core/types.ts";
import { defineSecAgentExtension, type SecAgentInlineExtension } from "./host-contract.ts";
import type { SecAgentRuntime } from "./runtime.ts";

export interface ScopeGuardDecision {
	block: boolean;
	warn: boolean;
	reason?: string;
	assessment?: ScopeAssessment;
}

export function evaluateProtectedPathGuard(input: unknown, cwd?: string): { block: boolean; reason?: string } {
	const assessment = assessProtectedPaths(input, cwd);
	return assessment.blocked ? { block: true, reason: assessment.reasons.join("; ") } : { block: false };
}

export function evaluateScopeGuard(
	toolName: string,
	input: Record<string, unknown>,
	state: SecurityState,
): ScopeGuardDecision {
	if (toolName.startsWith("security_")) return { block: false, warn: false };
	const assessment = assessToolScope(toolName, input, state.scope);
	if (toolName === "bash" && state.policyMode === "strict") {
		return {
			block: true,
			warn: false,
			reason:
				"direct shell execution is disabled in strict Sec mode; select a decision and use security_execute with a registered adapter",
			assessment,
		};
	}
	if (assessment.allowed) return { block: false, warn: false, assessment };
	const reason = assessment.reasons.join("; ") || "target is outside authorized scope";
	return state.policyMode === "autonomous"
		? { block: false, warn: true, reason, assessment }
		: { block: true, warn: false, reason, assessment };
}

export function createSecAgentScopeGuardExtension(runtime: SecAgentRuntime): SecAgentInlineExtension {
	return defineSecAgentExtension("secagent-scope-guard", (pi) => {
		pi.on("before_agent_start", async (event) => ({
			systemPrompt: `${event.systemPrompt}\n\nSecAgent scope policy: strict and competition modes block targets outside security_scope. Direct bash is disabled only in strict mode; in competition and autonomous modes bash remains subject to scope, protected-path, and risk policy (P3 commands still require approval in competition). Autonomous mode requires recorded controlled isolation and one-time authorization; it may continue outside scope only with a high-risk audit warning. Protected credential paths, OS/container isolation, and audit remain mandatory.`,
		}));
		pi.on("tool_call", async (event, ctx) => {
			const input = event.input as Record<string, unknown>;
			const state = runtime.snapshot().state;
			const protectedPathDecision = evaluateProtectedPathGuard(input, ctx.cwd);
			if (protectedPathDecision.block) {
				const record: ToolAuditRecord = {
					id: randomUUID(),
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					decisionId: state.decisions.at(-1)?.id,
					createdAt: new Date().toISOString(),
					risk: assessToolRisk(event.toolName, input),
					scope: assessToolScope(event.toolName, input, state.scope),
					policyMode: state.policyMode,
					policyDecision: "deny",
					blocked: true,
					blockReason: protectedPathDecision.reason,
					inputSummary: summarizeUnknown(input),
				};
				runtime.appendAudit(record);
				return { block: true, reason: `SecAgent protected path block: ${protectedPathDecision.reason}` };
			}
			const decision = evaluateScopeGuard(event.toolName, input, state);
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
	});
}
