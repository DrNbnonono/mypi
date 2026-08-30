import { graphIntegrityErrors } from "../core/evidence-graph.ts";
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
	budget: SecurityState["budget"];
	ctfProfile: SecurityState["ctfProfile"];
	evidence: SecurityState["evidence"];
	evidenceGraph: SecurityState["evidenceGraph"];
	hypotheses: string[];
	rejectedHypotheses: string[];
	findings: SecurityState["findings"];
	decisions: SecurityState["decisions"];
	replans: SecurityState["replans"];
	observerSignals: SecurityState["observerSignals"];
	delegations: SecurityState["delegations"];
	graphIntegrityErrors: string[];
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
		budget: structuredClone(state.budget),
		ctfProfile: state.ctfProfile ? structuredClone(state.ctfProfile) : undefined,
		evidence: structuredClone(state.evidence),
		evidenceGraph: structuredClone(state.evidenceGraph),
		hypotheses: [...state.hypotheses],
		rejectedHypotheses: [...state.rejectedHypotheses],
		findings: structuredClone(state.findings),
		decisions: structuredClone(state.decisions),
		replans: structuredClone(state.replans),
		observerSignals: structuredClone(state.observerSignals),
		delegations: structuredClone(state.delegations),
		graphIntegrityErrors: graphIntegrityErrors(state),
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
		SEVERITY_ORDER.map((severity) => [severity, findings.filter((item) => item.severity === severity).length] as const)
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
	const verifiedFindings = document.findings.filter((finding) => finding.verified);
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
		...(document.scope.targets.length ? document.scope.targets.map((target) => `- ${target.kind}: \`${target.value}\``) : ["- (unset)"]),
		"",
		"## Competition Runtime Summary",
		"",
		`- Evidence: ${document.evidence.length}`,
		`- Evidence edges: ${document.evidenceGraph.edges.length}`,
		`- Verifications: ${document.evidenceGraph.verifications.length}`,
		`- Findings: ${document.findings.length} (${findingSummary(document.findings)}), verified=${verifiedFindings.length}`,
		`- Decisions: ${document.decisions.length}`,
		`- Replans: ${document.replans.length}`,
		`- Observer signals: ${document.observerSignals.length}`,
		`- Delegations: ${document.delegations.length}`,
		`- Budget: decisions ${document.budget.usage.decisionsUsed}/${document.budget.limits.maxDecisions}, tools ${document.budget.usage.toolCallsUsed}/${document.budget.limits.maxToolCalls}, replans ${document.budget.usage.replansUsed}/${document.budget.limits.maxReplans}`,
		`- Graph integrity errors: ${document.graphIntegrityErrors.length}`,
		...(document.ctfProfile ? [`- CTF profile: ${document.ctfProfile.kind}; capabilities=${document.ctfProfile.recommendedCapabilities.join(", ")}`] : []),
		"",
		"## Evidence",
		"",
		...(document.evidence.length
			? document.evidence.map((item) => `- ${item.id} [${item.kind}] confidence=${item.confidence.toFixed(2)}${item.sha256 ? ` sha256=${item.sha256}` : ""}: ${item.summary}`)
			: ["No evidence recorded."]),
		"",
		"## Hypothesis Verification",
		"",
		...(document.evidenceGraph.verifications.length
			? document.evidenceGraph.verifications.map((item) => `- ${item.id} ${item.status} hypothesis=${item.hypothesisId} score=${item.score.toFixed(3)} sources=${item.independentSources}: ${item.reason}`)
			: ["No verification records."]),
		"",
		"## Confirmed Findings",
		"",
		...(document.findings.length
			? document.findings.map((item) => `- ${item.id} [${item.severity}] verified=${item.verified === true}: ${item.summary}${item.remediation ? `; remediation: ${item.remediation}` : ""}`)
			: ["No confirmed findings recorded."]),
		"",
		"## Replanning Trace",
		"",
		...(document.replans.length
			? document.replans.map((item) => `- ${item.createdAt} ${item.trigger}${item.previousDecisionId ? ` after ${item.previousDecisionId}` : ""}: ${item.reason}`)
			: ["No replans recorded."]),
		"",
		"## Observer Trace",
		"",
		...(document.observerSignals.length
			? document.observerSignals.map((item) => `- ${item.createdAt} ${item.severity}/${item.kind}: ${item.reason}`)
			: ["No observer signals recorded."]),
		"",
		"## Delegation Trace",
		"",
		...(document.delegations.length
			? document.delegations.map((item) => `- ${item.createdAt} ${item.role} ${item.status}: ${item.objective}`)
			: ["No delegations recorded."]),
		"",
		"## Decision Trace",
		"",
	];
	if (document.decisions.length === 0) lines.push("No decisions recorded.", "");
	for (const decision of document.decisions) {
		lines.push(
			`### ${decision.id}`,
			`- Revision/attempt: ${decision.planRevision ?? "n/a"}/${decision.attempt ?? "n/a"}`,
			`- Selected: ${decision.selectedActionId}`,
			`- Status: ${decision.resultStatus ?? "pending"}`,
			`- Rationale: ${decision.rationale ?? "(not recorded)"}`,
			`- Expected: ${decision.expectedResult ?? "(not recorded)"}`,
			`- Actual: ${decision.actualResult ?? "(pending)"}`,
			"- Candidates:",
		);
		for (const candidate of decision.candidates)
			lines.push(`  - ${candidate.id}: tool=${candidate.tool} score=${candidate.score.toFixed(4)} risk=${candidate.risk.toFixed(2)} cost=${candidate.cost.toFixed(2)} novelty=${candidate.noveltyPenalty?.toFixed(2) ?? "0"} budget=${candidate.budgetPenalty?.toFixed(2) ?? "0"}`);
		lines.push("");
	}
	lines.push("## Tool Audit Timeline", "");
	if (document.audit.length === 0) lines.push("No audit records included.");
	for (const record of document.audit)
		lines.push(`- ${record.createdAt} ${record.blocked ? "BLOCKED" : record.isError ? "ERROR" : "COMPLETED"} ${record.toolName} ${record.risk.level}; policy=${record.policyMode}/${record.policyDecision}; targets=${record.scope.targets.join(", ") || "n/a"}${record.warnings?.length ? `; warnings=${record.warnings.join("; ")}` : ""}`);
	return `${lines.join("\n").trimEnd()}\n`;
}
