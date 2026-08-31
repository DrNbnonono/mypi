import type { SecuritySessionStore } from "./state.ts";
import type { ToolAuditRecord } from "./types.ts";

export const SECURITY_AUDIT_ENTRY = "secagent:audit";

const NAMED_SECRET_PATTERN = /((?:api[_-]?key|token|password|authorization|cookie|secret)["'\s:=]+)([^\s,"'}]+)/gi;
const BEARER_PATTERN = /(bearer\s+)[A-Za-z0-9._~+/=-]+/gi;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const PROVIDER_KEY_PATTERN = /\b(?:sk|pk)-[A-Za-z0-9_-]{12,}\b/g;
const AWS_ACCESS_KEY_PATTERN = /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g;
const PEM_PATTERN = /-----BEGIN [A-Z ]+ PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+ PRIVATE KEY-----/g;

export function redactSecurityText(text: string): string {
	return text
		.replace(PEM_PATTERN, "[REDACTED PRIVATE KEY]")
		.replace(NAMED_SECRET_PATTERN, "$1[REDACTED]")
		.replace(BEARER_PATTERN, "$1[REDACTED]")
		.replace(JWT_PATTERN, "[REDACTED JWT]")
		.replace(PROVIDER_KEY_PATTERN, "[REDACTED API KEY]")
		.replace(AWS_ACCESS_KEY_PATTERN, "[REDACTED AWS KEY]");
}

export function redactSecurityValue<T>(value: T): T {
	if (typeof value === "string") return redactSecurityText(value) as T;
	try {
		return JSON.parse(redactSecurityText(JSON.stringify(value))) as T;
	} catch {
		return value;
	}
}

export function summarizeUnknown(value: unknown, maxLength = 220): string {
	let text: string;
	if (typeof value === "string") text = value;
	else {
		try {
			text = JSON.stringify(value);
		} catch {
			text = String(value);
		}
	}
	const singleLine = redactSecurityText(text).replace(/\s+/g, " ").trim();
	return singleLine.length <= maxLength ? singleLine : `${singleLine.slice(0, maxLength - 1)}…`;
}

export function readAuditRecords(store: SecuritySessionStore): ToolAuditRecord[] {
	const records: ToolAuditRecord[] = [];
	for (const entry of store.getBranch()) {
		if (entry.type !== "custom" || entry.customType !== SECURITY_AUDIT_ENTRY) continue;
		if (entry.data && typeof entry.data === "object") records.push(entry.data as ToolAuditRecord);
	}
	return records;
}

export function appendAuditRecord(store: SecuritySessionStore, record: ToolAuditRecord): void {
	store.appendCustomEntry(SECURITY_AUDIT_ENTRY, redactSecurityValue(record));
}

export function formatAuditRecords(records: ToolAuditRecord[], limit = 20): string {
	const selected = records.slice(-Math.max(1, limit));
	if (selected.length === 0) return "No SecAgent audit records in this branch.";
	return selected
		.map((record) => {
			const approval = record.userApproved === undefined ? "n/a" : record.userApproved ? "approved" : "rejected";
			const targets = record.scope.targets.join(", ") || "n/a";
			const suffix = record.blockReason ? `\n  blocked: ${record.blockReason}` : "";
			return `${record.createdAt} ${record.toolName} ${record.risk.level}\n  policy: ${record.policyMode}/${record.policyDecision} blocked=${record.blocked} approval=${approval}\n  scope: required=${record.scope.required} allowed=${record.scope.allowed} targets=${targets}\n  input: ${record.inputSummary}${suffix}`;
		})
		.join("\n\n");
}
