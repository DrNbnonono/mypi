import type { SecurityFinding, SecurityState, ToolAuditRecord } from "../core/types.ts";

export interface SecurityReportOptions {
	title?: string;
	includeAudit?: boolean;
	auditLimit?: number;
	redact?: boolean;
}
export interface SecurityReportDocument {
	generatedAt: string;
	goal: string;
	stage: SecurityState["stage"];
	policyMode: SecurityState["policyMode"];
	isolation: SecurityState["isolation"];
	scope: SecurityState["scope"];
	task: SecurityState["task"];
	evidence: SecurityState["evidence"];
	hypotheses: string[];
	rejectedHypotheses: string[];
	findings: SecurityState["findings"];
	decisions: SecurityState["decisions"];
	audit: ToolAuditRecord[];
}

const SECRET_PATTERN = /((?:api[_-]?key|token|password|authorization|cookie)["'\s:=]+)([^\s,"'}]+)/gi;
const SEVERITY_ORDER: SecurityFinding["severity"][] = ["critical", "high", "medium", "low", "info"];

export function redactSecurityText(text: string): string {
	return text.replace(SECRET_PATTERN, "$1[REDACTED]");
}
function redactUnknown<T>(value: T): T {
	return JSON.parse(redactSecurityText(JSON.stringify(value))) as T;
}
function limit(value: number | undefined): number {
	return value === undefined || !Number.isFinite(value) ? 50 : Math.max(0, Math.min(500, Math.trunc(value)));
}

export function buildSecurityReportDocument(
	state: SecurityState,
	records: ToolAuditRecord[],
	options: SecurityReportOptions = {},
): SecurityReportDocument {
	const document: SecurityReportDocument = {
		generatedAt: new Date().toISOString(),
		goal: state.goal,
		stage: state.stage,
		policyMode: state.policyMode,
		isolation: structuredClone(state.isolation),
		scope: structuredClone(state.scope),
		task: state.task ? structuredClone(state.task) : undefined,
		evidence: structuredClone(state.evidence),
		hypotheses: [...state.hypotheses],
		rejectedHypotheses: [...state.rejectedHypotheses],
		findings: structuredClone(state.findings),
		decisions: structuredClone(state.decisions),
		audit: options.includeAudit === false ? [] : structuredClone(records.slice(-limit(options.auditLimit))),
	};
	return options.redact === false ? document : redactUnknown(document);
}

export function buildSecurityReportJson(
	state: SecurityState,
	records: ToolAuditRecord[],
	options: SecurityReportOptions = {},
): string {
	return JSON.stringify(buildSecurityReportDocument(state, records, options), null, 2);
}

function findingSummary(findings: SecurityFinding[]): string {
	return (
		SEVERITY_ORDER.map(
			(severity) => [severity, findings.filter((item) => item.severity === severity).length] as const,
		)
			.filter(([, count]) => count > 0)
			.map(([severity, count]) => `${severity}=${count}`)
			.join(", ") || "none"
	);
}

export function buildSecurityReportMarkdown(
	state: SecurityState,
	records: ToolAuditRecord[],
	options: SecurityReportOptions = {},
): string {
	const document = buildSecurityReportDocument(state, records, options);
	const lines = [
		`# ${options.title?.trim() || "SecAgent Security Report"}`,
		"",
		`Generated: ${document.generatedAt}`,
		`Goal: ${document.goal || "(unset)"}`,
		`Stage: ${document.stage}`,
		`Policy: ${document.policyMode}`,
		`Isolation: ${document.isolation.status}${document.isolation.source ? ` (${document.isolation.source})` : ""}`,
		"",
		"## Authorized Scope",
		"",
		...(document.scope.targets.length
			? document.scope.targets.map((target) => `- ${target.kind}: \`${target.value}\``)
			: ["- (unset)"]),
		"",
		"## Summary",
		"",
		`- Evidence: ${document.evidence.length}`,
		`- Findings: ${document.findings.length} (${findingSummary(document.findings)})`,
		`- Decisions: ${document.decisions.length}`,
		`- Audit records: ${document.audit.length}`,
		"",
		"## Evidence",
		"",
		...(document.evidence.length
			? document.evidence.map(
					(item) =>
						`- ${item.id} [${item.kind}] confidence=${item.confidence.toFixed(2)}${item.sha256 ? ` sha256=${item.sha256}` : ""}: ${item.summary}`,
				)
			: ["No evidence recorded."]),
		"",
		"## Active Hypotheses",
		"",
		...(document.hypotheses.length ? document.hypotheses.map((item, index) => `${index + 1}. ${item}`) : ["None."]),
		"",
		"## Rejected Hypotheses",
		"",
		...(document.rejectedHypotheses.length ? document.rejectedHypotheses.map((item) => `- ${item}`) : ["None."]),
		"",
		"## Confirmed Findings",
		"",
		...(document.findings.length
			? document.findings.map(
					(item) =>
						`- ${item.id} [${item.severity}]: ${item.summary}${item.remediation ? `; remediation: ${item.remediation}` : ""}`,
				)
			: ["No confirmed findings recorded."]),
		"",
		"## Decision Trace",
		"",
	];
	if (document.decisions.length === 0) lines.push("No decisions recorded.", "");
	for (const decision of document.decisions) {
		lines.push(
			`### ${decision.id}`,
			`- Selected: ${decision.selectedActionId}`,
			`- Status: ${decision.resultStatus ?? "pending"}`,
			`- Rationale: ${decision.rationale ?? "(not recorded)"}`,
			`- Expected: ${decision.expectedResult ?? "(not recorded)"}`,
			`- Actual: ${decision.actualResult ?? "(pending)"}`,
			"- Candidates:",
		);
		for (const candidate of decision.candidates)
			lines.push(
				`  - ${candidate.id}: tool=${candidate.tool} score=${candidate.score.toFixed(4)} risk=${candidate.risk.toFixed(2)} cost=${candidate.cost.toFixed(2)}`,
			);
		lines.push("");
	}
	lines.push("## Tool Audit Timeline", "");
	if (document.audit.length === 0) lines.push("No audit records included.");
	for (const record of document.audit)
		lines.push(
			`- ${record.createdAt} ${record.blocked ? "BLOCKED" : record.isError ? "ERROR" : "COMPLETED"} ${record.toolName} ${record.risk.level}; policy=${record.policyMode}/${record.policyDecision}; targets=${record.scope.targets.join(", ") || "n/a"}${record.warnings?.length ? `; warnings=${record.warnings.join("; ")}` : ""}`,
		);
	return `${lines.join("\n").trimEnd()}\n`;
}
