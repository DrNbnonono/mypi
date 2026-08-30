import type { SecuritySessionStore } from "./state.ts";
import type { ToolAuditRecord } from "./types.ts";

export const SECURITY_AUDIT_ENTRY = "secagent:audit";

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
	const singleLine = text.replace(/\s+/g, " ").trim();
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
	store.appendCustomEntry(SECURITY_AUDIT_ENTRY, record);
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
