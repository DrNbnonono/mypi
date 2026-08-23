import type { SecurityFinding, SecurityState, ToolAuditRecord } from "../core/types.ts";

export interface SecurityReportOptions {
	title?: string;
	includeAudit?: boolean;
	auditLimit?: number;
}

export interface SecurityReportDocument {
	generatedAt: string;
	goal: string;
	stage: SecurityState["stage"];
	policyMode: SecurityState["policyMode"];
	scope: SecurityState["scope"];
	evidence: SecurityState["evidence"];
	hypotheses: SecurityState["hypotheses"];
	findings: SecurityState["findings"];
	decisions: SecurityState["decisions"];
	audit: ToolAuditRecord[];
}

const SEVERITY_ORDER: SecurityFinding["severity"][] = ["critical", "high", "medium", "low", "info"];

function clampAuditLimit(value: number | undefined): number {
	if (value === undefined || !Number.isFinite(value)) return 50;
	return Math.max(0, Math.min(500, Math.trunc(value)));
}

function formatScope(state: SecurityState): string[] {
	if (state.scope.targets.length === 0) return ["- (unset)"];
	const lines = state.scope.targets.map((target) => `- ${target.kind}: \`${target.value}\``);
	if (state.scope.note) lines.push(`- Note: ${state.scope.note}`);
	return lines;
}

function findingSummary(findings: SecurityFinding[]): string {
	if (findings.length === 0) return "No confirmed findings recorded.";
	const counts = new Map<SecurityFinding["severity"], number>();
	for (const finding of findings) counts.set(finding.severity, (counts.get(finding.severity) ?? 0) + 1);
	return SEVERITY_ORDER.filter((severity) => counts.has(severity))
		.map((severity) => `${severity}=${counts.get(severity) ?? 0}`)
		.join(", ");
}

export function buildSecurityReportDocument(
	state: SecurityState,
	auditRecords: ToolAuditRecord[],
	options: SecurityReportOptions = {},
): SecurityReportDocument {
	const auditLimit = clampAuditLimit(options.auditLimit);
	return {
		generatedAt: new Date().toISOString(),
		goal: state.goal,
		stage: state.stage,
		policyMode: state.policyMode,
		scope: {
			...state.scope,
			targets: state.scope.targets.map((target) => ({ ...target })),
		},
		evidence: state.evidence.map((item) => ({ ...item })),
		hypotheses: [...state.hypotheses],
		findings: state.findings.map((item) => ({ ...item })),
		decisions: state.decisions.map((decision) => ({
			...decision,
			candidates: decision.candidates.map((candidate) => ({ ...candidate, preconditions: [...candidate.preconditions] })),
		})),
		audit: options.includeAudit === false ? [] : auditRecords.slice(-auditLimit).map((record) => ({
			...record,
			risk: {
				...record.risk,
				reasons: [...record.risk.reasons],
				resolution: {
					...record.risk.resolution,
					resolvedTools: [...record.risk.resolution.resolvedTools],
					capabilities: [...record.risk.resolution.capabilities],
					reasons: [...record.risk.resolution.reasons],
				},
			},
			scope: { ...record.scope, targets: [...record.scope.targets], reasons: [...record.scope.reasons] },
		})),
	};
}

export function buildSecurityReportJson(
	state: SecurityState,
	auditRecords: ToolAuditRecord[],
	options: SecurityReportOptions = {},
): string {
	return JSON.stringify(buildSecurityReportDocument(state, auditRecords, options), null, 2);
}

export function buildSecurityReportMarkdown(
	state: SecurityState,
	auditRecords: ToolAuditRecord[],
	options: SecurityReportOptions = {},
): string {
	const document = buildSecurityReportDocument(state, auditRecords, options);
	const title = options.title?.trim() || "SecAgent Security Report";
	const lines: string[] = [
		`# ${title}`,
		"",
		`Generated: ${document.generatedAt}`,
		`Goal: ${document.goal || "(unset)"}`,
		`Stage: ${document.stage}`,
		`Policy mode: ${document.policyMode}`,
		"",
		"## Authorized Scope",
		"",
		...formatScope(state),
		"",
		"## Summary",
		"",
		`- Evidence items: ${document.evidence.length}`,
		`- Hypotheses: ${document.hypotheses.length}`,
		`- Confirmed findings: ${document.findings.length} (${findingSummary(document.findings)})`,
		`- Recorded decisions: ${document.decisions.length}`,
		`- Included audit records: ${document.audit.length}`,
		"",
		"## Evidence",
		"",
	];

	if (document.evidence.length === 0) {
		lines.push("No evidence recorded.");
	} else {
		for (const evidence of document.evidence) {
			const source = evidence.source ? ` source=${evidence.source}` : "";
			lines.push(`- ${evidence.id} [${evidence.kind}] confidence=${evidence.confidence.toFixed(2)}${source}: ${evidence.summary}`);
		}
	}

	lines.push("", "## Hypotheses", "");
	if (document.hypotheses.length === 0) lines.push("No active hypotheses recorded.");
	else document.hypotheses.forEach((hypothesis, index) => lines.push(`${index + 1}. ${hypothesis}`));

	lines.push("", "## Confirmed Findings", "");
	if (document.findings.length === 0) lines.push("No confirmed findings recorded.");
	else {
		for (const finding of document.findings) {
			lines.push(`- ${finding.id} [${finding.severity}]: ${finding.summary}`);
		}
	}

	lines.push("", "## Decision Trace", "");
	if (document.decisions.length === 0) lines.push("No decisions recorded.");
	else {
		for (const decision of document.decisions) {
			const selected = decision.candidates.find((candidate) => candidate.id === decision.selectedActionId);
			lines.push(`### ${decision.id}`);
			lines.push(`- Stage: ${decision.stage}`);
			lines.push(`- Selected: ${selected ? `${selected.id} / ${selected.tool}` : decision.selectedActionId}`);
			if (decision.rationale) lines.push(`- Rationale: ${decision.rationale}`);
			lines.push("- Candidates:");
			for (const candidate of decision.candidates) {
				lines.push(`  - ${candidate.id}: tool=${candidate.tool} score=${candidate.score.toFixed(4)} risk=${candidate.risk.toFixed(2)} cost=${candidate.cost.toFixed(2)}`);
			}
			lines.push("");
		}
	}

	if (options.includeAudit !== false) {
		lines.push("## Tool Audit Timeline", "");
		if (document.audit.length === 0) lines.push("No audit records included.");
		else {
			for (const record of document.audit) {
				const status = record.blocked ? "BLOCKED" : record.isError ? "ERROR" : "COMPLETED";
				const targets = record.scope.targets.length > 0 ? record.scope.targets.join(", ") : "n/a";
				lines.push(`- ${record.createdAt} ${status} ${record.toolName} ${record.risk.level}; policy=${record.policyMode}/${record.policyDecision}; targets=${targets}`);
				if (record.blockReason) lines.push(`  - Block reason: ${record.blockReason}`);
			}
		}
	}

	return `${lines.join("\n").trimEnd()}\n`;
}
