import { randomUUID } from "node:crypto";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { formatAuditRecords, readAuditRecords, SECURITY_AUDIT_ENTRY, summarizeUnknown } from "../secagent/core/audit.ts";
import { rankCandidates, riskScoreToLevel } from "../secagent/core/planner.ts";
import { assessToolRisk, decidePermission } from "../secagent/core/policy.ts";
import { assessToolScope, inferScopeTargetKind, normalizeScopeValue } from "../secagent/core/scope.ts";
import {
	appendPolicyChange,
	appendSecurityEvent,
	createInitialSecurityState,
	replaySecurityState,
} from "../secagent/core/state.ts";
import type {
	CandidateActionInput,
	PolicyMode,
	ScopeTarget,
	SecurityDecision,
	SecurityEvidence,
	SecurityFinding,
	SecurityScope,
	SecurityStage,
	SecurityState,
	SecurityToolMetadata,
	ToolAuditRecord,
	ToolCategory,
} from "../secagent/core/types.ts";
import { getSecurityToolMetadata, listSecurityToolMetadata } from "../secagent/tools/registry.ts";

const StageValues = ["understanding", "recon", "analysis", "verification", "response", "report"] as const;
const PolicyModes = ["strict", "competition"] as const;
const EvidenceKinds = ["observation", "artifact", "indicator", "finding"] as const;
const FindingSeverities = ["info", "low", "medium", "high", "critical"] as const;
const ToolCategoryValues = ["internal", "local", "network", "recon", "web", "analysis", "response", "shell"] as const;

const SecurityStateParams = Type.Object({
	action: StringEnum(["show", "start_task", "set_stage", "add_evidence", "add_hypothesis", "add_finding"] as const),
	goal: Type.Optional(Type.String({ description: "Task goal for start_task" })),
	stage: Type.Optional(StringEnum(StageValues)),
	kind: Type.Optional(StringEnum(EvidenceKinds)),
	summary: Type.Optional(Type.String({ description: "Evidence or finding summary" })),
	source: Type.Optional(Type.String({ description: "Evidence source" })),
	confidence: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
	hypothesis: Type.Optional(Type.String()),
	severity: Type.Optional(StringEnum(FindingSeverities)),
});

const SecurityScopeParams = Type.Object({
	action: StringEnum(["show", "set"] as const),
	targets: Type.Optional(
		Type.Array(Type.String({ minLength: 1 }), {
			description: "Authorized hosts, domains, IPv4 addresses, IPv4 CIDRs, or HTTP(S) URLs",
			maxItems: 64,
		}),
	),
	note: Type.Optional(Type.String({ description: "Optional authorization or competition-scope note" })),
});

const CandidateParams = Type.Object({
	id: Type.String(),
	tool: Type.String(),
	description: Type.String(),
	goalRelevance: Type.Number({ minimum: 0, maximum: 1 }),
	informationGain: Type.Number({ minimum: 0, maximum: 1 }),
	confidence: Type.Number({ minimum: 0, maximum: 1 }),
	riskHint: Type.Optional(
		Type.Number({ minimum: 0, maximum: 1, description: "Optional model risk estimate; registry risk is a hard lower bound" }),
	),
	cost: Type.Number({ minimum: 0, maximum: 1 }),
	preconditions: Type.Optional(Type.Array(Type.String())),
});

const SecurityDecisionParams = Type.Object({
	candidates: Type.Array(CandidateParams, { minItems: 2, maxItems: 8 }),
	rationale: Type.Optional(Type.String({ description: "Why these candidate actions were considered" })),
});

const SecurityToolsParams = Type.Object({
	action: StringEnum(["list", "show"] as const),
	name: Type.Optional(Type.String({ description: "Tool or alias for show" })),
	category: Type.Optional(StringEnum(ToolCategoryValues)),
	capability: Type.Optional(Type.String({ description: "Filter list by exact capability" })),
});

function renderScope(scope: SecurityScope): string {
	if (scope.targets.length === 0) return "Authorized scope: (unset)";
	const targets = scope.targets.map((target) => `- ${target.kind}: ${target.value}`);
	return ["Authorized scope:", ...targets, ...(scope.note ? [`Note: ${scope.note}`] : [])].join("\n");
}

function renderState(state: SecurityState): string {
	const recentEvidence = state.evidence.slice(-5).map((item) => `- [${item.kind}] ${item.summary}`);
	const recentFindings = state.findings.slice(-5).map((item) => `- [${item.severity}] ${item.summary}`);
	return [
		`Goal: ${state.goal || "(unset)"}`,
		`Stage: ${state.stage}`,
		`Policy: ${state.policyMode}`,
		`Revision: ${state.revision}`,
		renderScope(state.scope),
		`Evidence: ${state.evidence.length}`,
		...(recentEvidence.length > 0 ? ["Recent evidence:", ...recentEvidence] : []),
		`Hypotheses: ${state.hypotheses.length}`,
		`Findings: ${state.findings.length}`,
		...(recentFindings.length > 0 ? ["Recent findings:", ...recentFindings] : []),
		`Decisions: ${state.decisions.length}`,
	].join("\n");
}

function renderToolMetadata(metadata: SecurityToolMetadata): string {
	return [
		`${metadata.name} [${metadata.category}] ${metadata.baseRisk}`,
		`Description: ${metadata.description}`,
		`Aliases: ${metadata.aliases.join(", ") || "none"}`,
		`Scope: ${metadata.scopeMode}`,
		`Capabilities: ${metadata.capabilities.join(", ") || "none"}`,
		`Preconditions: ${metadata.preconditions.join("; ") || "none"}`,
		`Postconditions: ${metadata.postconditions.join("; ") || "none"}`,
		`Recommended agents: ${metadata.recommendedAgents.join(", ") || "none"}`,
	].join("\n");
}

function restoreState(ctx: ExtensionContext): SecurityState {
	return replaySecurityState(ctx);
}

function now(): string {
	return new Date().toISOString();
}

function normalizeCandidate(candidate: {
	id: string;
	tool: string;
	description: string;
	goalRelevance: number;
	informationGain: number;
	confidence: number;
	riskHint?: number;
	cost: number;
	preconditions?: string[];
}): CandidateActionInput {
	return {
		...candidate,
		preconditions: candidate.preconditions ?? [],
	};
}

function buildScope(targetValues: string[], note: string | undefined): SecurityScope {
	const deduplicated = new Map<string, ScopeTarget>();
	for (const raw of targetValues) {
		const trimmed = raw.trim();
		if (!trimmed) continue;
		const kind = inferScopeTargetKind(trimmed);
		const value = normalizeScopeValue(trimmed, kind);
		const key = `${kind}:${value}`;
		deduplicated.set(key, { id: randomUUID(), kind, value });
	}
	return {
		targets: [...deduplicated.values()],
		note: note?.trim() || undefined,
		updatedAt: now(),
	};
}

export default function securityAgentExtension(pi: ExtensionAPI) {
	let state = createInitialSecurityState();
	const pendingAudit = new Map<string, ToolAuditRecord>();

	const syncState = (ctx: ExtensionContext) => {
		state = restoreState(ctx);
	};

	pi.on("session_start", async (_event, ctx) => syncState(ctx));
	pi.on("session_tree", async (_event, ctx) => syncState(ctx));

	pi.on("before_agent_start", async (event) => {
		const protocol = [
			"SecAgent operating protocol:",
			"- Act as the coordinator for a controlled cybersecurity workflow, not as an unrestricted shell assistant.",
			"- Work only within the user-authorized environment and task scope.",
			"- Start each non-trivial task with security_state start_task, then set the authorized targets with security_scope before any network action.",
			"- Never bypass an out-of-scope block. If the target cannot be proven to be authorized, stop and ask for scope clarification.",
			"- Keep an explicit security state and record important observations as evidence and confirmed issues as findings.",
			"- Consult security_tools when selecting an unfamiliar tool; registry risk is authoritative and cannot be reduced by model-provided risk hints.",
			"- Before a non-trivial next step, provide at least two candidate actions to security_decide and follow its ranked recommendation unless new evidence invalidates it.",
			"- Delegate bounded specialist work to project subagents when useful: sec-recon, sec-web, sec-analysis, sec-response.",
			"- If a tool is blocked by policy, do not bypass the block; re-plan with a safer action.",
			"- Distinguish observations, hypotheses, and confirmed findings. Do not report hypotheses as facts.",
			"- Prefer reversible, low-risk, high-information actions before intrusive actions.",
		].join("\n");

		return { systemPrompt: `${event.systemPrompt}\n\n${protocol}` };
	});

	pi.registerTool({
		name: "security_state",
		label: "Security State",
		description:
			"Read or update the explicit SecAgent task state. Use start_task once per new security task, then record stage changes, evidence, hypotheses, and findings.",
		promptSnippet: "security_state: maintain explicit security task state and evidence",
		parameters: SecurityStateParams,
		async execute(_toolCallId, params) {
			switch (params.action) {
				case "show":
					return { content: [{ type: "text", text: renderState(state) }], details: state };
				case "start_task": {
					if (!params.goal?.trim()) {
						return { content: [{ type: "text", text: "Error: goal is required for start_task" }], details: state };
					}
					state = appendSecurityEvent(pi, state, {
						type: "task_started",
						goal: params.goal.trim(),
						createdAt: now(),
					});
					return {
						content: [{ type: "text", text: `Started security task: ${state.goal}. Authorized network scope is now unset.` }],
						details: state,
					};
				}
				case "set_stage": {
					if (!params.stage) {
						return { content: [{ type: "text", text: "Error: stage is required for set_stage" }], details: state };
					}
					state = appendSecurityEvent(pi, state, {
						type: "stage_changed",
						stage: params.stage as SecurityStage,
						createdAt: now(),
					});
					return { content: [{ type: "text", text: `Security stage set to ${state.stage}` }], details: state };
				}
				case "add_evidence": {
					if (!params.summary?.trim()) {
						return { content: [{ type: "text", text: "Error: summary is required for add_evidence" }], details: state };
					}
					const evidence: SecurityEvidence = {
						id: randomUUID(),
						kind: params.kind ?? "observation",
						summary: params.summary.trim(),
						source: params.source?.trim() || undefined,
						confidence: params.confidence ?? 0.8,
						createdAt: now(),
					};
					state = appendSecurityEvent(pi, state, {
						type: "evidence_added",
						evidence,
						createdAt: evidence.createdAt,
					});
					return { content: [{ type: "text", text: `Recorded evidence ${evidence.id}: ${evidence.summary}` }], details: state };
				}
				case "add_hypothesis": {
					if (!params.hypothesis?.trim()) {
						return { content: [{ type: "text", text: "Error: hypothesis is required" }], details: state };
					}
					state = appendSecurityEvent(pi, state, {
						type: "hypothesis_added",
						hypothesis: params.hypothesis.trim(),
						createdAt: now(),
					});
					return { content: [{ type: "text", text: "Recorded security hypothesis" }], details: state };
				}
				case "add_finding": {
					if (!params.summary?.trim()) {
						return { content: [{ type: "text", text: "Error: summary is required for add_finding" }], details: state };
					}
					const finding: SecurityFinding = {
						id: randomUUID(),
						summary: params.summary.trim(),
						severity: params.severity ?? "medium",
						createdAt: now(),
					};
					state = appendSecurityEvent(pi, state, {
						type: "finding_added",
						finding,
						createdAt: finding.createdAt,
					});
					return { content: [{ type: "text", text: `Recorded finding ${finding.id}: ${finding.summary}` }], details: state };
				}
			}
		},
	});

	pi.registerTool({
		name: "security_scope",
		label: "Security Scope",
		description:
			"Show or set the explicit authorized target scope for this task. Network tools are blocked when their target cannot be proven to fit this scope.",
		promptSnippet: "security_scope: set explicit authorized targets before network actions",
		parameters: SecurityScopeParams,
		async execute(_toolCallId, params) {
			if (params.action === "show") {
				return { content: [{ type: "text", text: renderScope(state.scope) }], details: state.scope };
			}

			const targets = params.targets ?? [];
			if (targets.length === 0) {
				return {
					content: [{ type: "text", text: "Error: at least one authorized target is required for security_scope set" }],
					details: state.scope,
				};
			}

			const scope = buildScope(targets, params.note);
			state = appendSecurityEvent(pi, state, {
				type: "scope_set",
				scope,
				createdAt: scope.updatedAt ?? now(),
			});
			return {
				content: [{ type: "text", text: `Authorized ${scope.targets.length} scope target(s).\n${renderScope(scope)}` }],
				details: scope,
			};
		},
	});

	pi.registerTool({
		name: "security_tools",
		label: "Security Tool Registry",
		description:
			"Inspect the structured SecAgent security-tool registry. Registry risk levels are authoritative lower bounds for planning and permission decisions.",
		promptSnippet: "security_tools: inspect tool risk, capabilities, scope behavior, and preconditions",
		parameters: SecurityToolsParams,
		async execute(_toolCallId, params) {
			if (params.action === "show") {
				if (!params.name?.trim()) {
					return { content: [{ type: "text", text: "Error: name is required for security_tools show" }] };
				}
				const metadata = getSecurityToolMetadata(params.name);
				if (!metadata) {
					return { content: [{ type: "text", text: `Tool not found in SecAgent registry: ${params.name}` }] };
				}
				return { content: [{ type: "text", text: renderToolMetadata(metadata) }], details: metadata };
			}

			const category = params.category as ToolCategory | undefined;
			const capability = params.capability?.trim();
			const selected = listSecurityToolMetadata().filter((metadata) => {
				if (category && metadata.category !== category) return false;
				if (capability && !metadata.capabilities.includes(capability)) return false;
				return true;
			});
			const text = selected.length
				? selected
						.map((metadata) =>
							`${metadata.name} ${metadata.baseRisk} scope=${metadata.scopeMode} capabilities=${metadata.capabilities.join(",")}`,
						)
						.join("\n")
				: "No tools matched the requested registry filters.";
			return { content: [{ type: "text", text }], details: selected };
		},
	});

	pi.registerTool({
		name: "security_decide",
		label: "Security Decision",
		description:
			"Rank candidate next actions with the SecAgent decision kernel. Scores favor goal relevance, information gain, and confidence while penalizing registry-derived risk and cost.",
		promptSnippet: "security_decide: rank candidate security actions before non-trivial execution",
		parameters: SecurityDecisionParams,
		async execute(_toolCallId, params) {
			const ranked = rankCandidates(params.candidates.map(normalizeCandidate));
			const selected = ranked[0];
			if (!selected) {
				return { content: [{ type: "text", text: "Error: at least two candidates are required" }] };
			}

			const decision: SecurityDecision = {
				id: randomUUID(),
				createdAt: now(),
				goal: state.goal,
				stage: state.stage,
				candidates: ranked,
				selectedActionId: selected.id,
				rationale: params.rationale,
			};
			state = appendSecurityEvent(pi, state, {
				type: "decision_recorded",
				decision,
				createdAt: decision.createdAt,
			});

			const table = ranked
				.map((item, index) => {
					const risk = riskScoreToLevel(item.risk);
					return `${index + 1}. ${item.id} score=${item.score.toFixed(4)} risk=${risk} tool=${item.tool} - ${item.description}`;
				})
				.join("\n");

			return {
				content: [{ type: "text", text: `Recommended action: ${selected.id}\n${table}` }],
				details: decision,
			};
		},
	});

	pi.on("tool_call", async (event, ctx) => {
		const input = event.input as Record<string, unknown>;
		const risk = assessToolRisk(event.toolName, input);
		const scope = assessToolScope(event.toolName, input, state.scope);
		const policyDecision = decidePermission(state.policyMode, risk.level);
		const record: ToolAuditRecord = {
			id: randomUUID(),
			toolCallId: event.toolCallId,
			toolName: event.toolName,
			createdAt: now(),
			risk,
			scope,
			policyMode: state.policyMode,
			policyDecision,
			blocked: false,
			inputSummary: summarizeUnknown(input),
		};

		if (!scope.allowed) {
			record.blocked = true;
			record.blockReason = scope.reasons.join("; ");
			pi.appendEntry<ToolAuditRecord>(SECURITY_AUDIT_ENTRY, record);
			return { block: true, reason: `SecAgent scope block: ${record.blockReason}` };
		}

		if (policyDecision === "deny") {
			record.blocked = true;
			record.blockReason = `${risk.level} denied by ${state.policyMode} policy`;
			pi.appendEntry<ToolAuditRecord>(SECURITY_AUDIT_ENTRY, record);
			return { block: true, reason: record.blockReason };
		}

		if (policyDecision === "confirm") {
			if (!ctx.hasUI) {
				record.blocked = true;
				record.userApproved = false;
				record.blockReason = `${risk.level} action requires interactive approval`;
				pi.appendEntry<ToolAuditRecord>(SECURITY_AUDIT_ENTRY, record);
				return { block: true, reason: record.blockReason };
			}

			const approved = await ctx.ui.confirm(
				`SecAgent ${risk.level} approval`,
				`${event.toolName}\n${record.inputSummary}\n\nRegistry: ${risk.resolution.resolvedTools.join(", ")}\nCapabilities: ${risk.resolution.capabilities.join(", ") || "n/a"}\nReasons: ${risk.reasons.join(", ")}\nScope: ${scope.reasons.join(", ")}`,
			);
			record.userApproved = approved;
			if (!approved) {
				record.blocked = true;
				record.blockReason = `Blocked by SecAgent ${risk.level} policy`;
				pi.appendEntry<ToolAuditRecord>(SECURITY_AUDIT_ENTRY, record);
				return { block: true, reason: record.blockReason };
			}
		}

		pendingAudit.set(event.toolCallId, record);
		return undefined;
	});

	pi.on("tool_result", async (event) => {
		const record = pendingAudit.get(event.toolCallId);
		if (!record) return;
		pendingAudit.delete(event.toolCallId);

		record.completedAt = now();
		record.isError = event.isError;
		record.resultSummary = summarizeUnknown(event.content);
		pi.appendEntry<ToolAuditRecord>(SECURITY_AUDIT_ENTRY, record);
	});

	pi.registerCommand("sec-state", {
		description: "Show the current SecAgent security state",
		handler: async (_args, ctx) => {
			syncState(ctx);
			if (ctx.hasUI) {
				await ctx.ui.editor("SecAgent state", renderState(state));
				return;
			}
			ctx.ui.notify(renderState(state), "info");
		},
	});

	pi.registerCommand("sec-scope", {
		description: "Show the current SecAgent authorized target scope",
		handler: async (_args, ctx) => {
			syncState(ctx);
			ctx.ui.notify(renderScope(state.scope), "info");
		},
	});

	pi.registerCommand("sec-tools", {
		description: "Show the SecAgent structured tool registry",
		handler: async (_args, ctx) => {
			const text = listSecurityToolMetadata()
				.map((metadata) => `${metadata.name.padEnd(15)} ${metadata.baseRisk} ${metadata.category} ${metadata.scopeMode}`)
				.join("\n");
			if (ctx.hasUI) {
				await ctx.ui.editor("SecAgent tool registry", text);
				return;
			}
			ctx.ui.notify(text, "info");
		},
	});

	pi.registerCommand("sec-audit", {
		description: "Show recent SecAgent tool audit records",
		handler: async (args, ctx) => {
			const requested = Number.parseInt(args.trim(), 10);
			const limit = Number.isFinite(requested) && requested > 0 ? Math.min(requested, 100) : 20;
			const text = formatAuditRecords(readAuditRecords(ctx), limit);
			if (ctx.hasUI) {
				await ctx.ui.editor("SecAgent audit", text);
				return;
			}
			ctx.ui.notify(text, "info");
		},
	});

	pi.registerCommand("sec-mode", {
		description: "Set SecAgent policy mode: strict or competition",
		handler: async (args, ctx) => {
			const requested = args.trim() as PolicyMode;
			if (!PolicyModes.includes(requested)) {
				ctx.ui.notify(`Usage: /sec-mode ${PolicyModes.join("|")}`, "error");
				return;
			}
			state = appendPolicyChange(pi, state, requested);
			ctx.ui.notify(`SecAgent policy mode: ${state.policyMode}`, "info");
		},
	});
}
