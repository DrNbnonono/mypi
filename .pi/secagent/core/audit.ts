import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ToolAuditRecord } from "./types.ts";

export const SECURITY_AUDIT_ENTRY = "secagent:audit";

export function summarizeUnknown(value: unknown, maxLength = 220): string {
	let text: string;
	if (typeof value === "string") {
		text = value;
	} else {
		try {
			text = JSON.stringify(value);
		} catch {
			text = String(value);
		}
	}

	const singleLine = text.replace(/\s+/g, " ").trim();
	return singleLine.length <= maxLength ? singleLine : `${singleLine.slice(0, maxLength - 1)}…`;
}

export function readAuditRecords(ctx: ExtensionContext): ToolAuditRecord[] {
	const records: ToolAuditRecord[] = [];
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "custom" || entry.customType !== SECURITY_AUDIT_ENTRY) continue;
		const record = entry.data as ToolAuditRecord | undefined;
		if (record) records.push(record);
	}
	return records;
}

export function formatAuditRecords(records: ToolAuditRecord[], limit = 20): string {
	const selected = records.slice(-Math.max(1, limit));
	if (selected.length === 0) return "No SecAgent audit records in this branch.";

	return selected
		.map((record) => {
			const approval = record.userApproved === undefined ? "n/a" : record.userApproved ? "approved" : "rejected";
			const result = record.resultSummary ? `\n  result: ${record.resultSummary}` : "";
			const scopeTargets = record.scope.targets.length > 0 ? record.scope.targets.join(", ") : "n/a";
			const blockReason = record.blockReason ? `\n  blocked: ${record.blockReason}` : "";
			const tools = record.risk.resolution.resolvedTools.join(", ");
			const capabilities = record.risk.resolution.capabilities.join(", ") || "n/a";
			return [
				`${record.createdAt} ${record.toolName} ${record.risk.level}`,
				`  registry: tools=${tools} known=${record.risk.resolution.known} capabilities=${capabilities}`,
				`  policy: ${record.policyMode}/${record.policyDecision} blocked=${record.blocked} approval=${approval}`,
				`  scope: required=${record.scope.required} allowed=${record.scope.allowed} targets=${scopeTargets}`,
				`  input: ${record.inputSummary}${result}${blockReason}`,
			].join("\n");
		})
		.join("\n\n");
}
