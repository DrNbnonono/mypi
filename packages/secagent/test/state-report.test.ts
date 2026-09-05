import { describe, expect, it } from "vitest";
import { appendAuditRecord, readAuditRecords, redactSecurityText } from "../src/core/audit.ts";
import { assessToolRisk } from "../src/core/policy.ts";
import type { SecuritySessionStore } from "../src/core/state.ts";
import { applySecurityEvent, createInitialSecurityState } from "../src/core/state.ts";
import { buildSecurityReportJson, buildSecurityReportMarkdown } from "../src/report/generator.ts";

class MemoryStore implements SecuritySessionStore {
	readonly entries: Array<{ type: string; customType?: string; data?: unknown }> = [];
	getBranch() {
		return [...this.entries];
	}
	appendCustomEntry(customType: string, data?: unknown): string {
		this.entries.push({ type: "custom", customType, data });
		return String(this.entries.length);
	}
}

describe("state replay and reports", () => {
	it("records decisions and their actual outcomes", () => {
		let state = createInitialSecurityState();
		state = applySecurityEvent(state, {
			type: "decision_recorded",
			createdAt: "2026-08-30T00:00:00Z",
			decision: {
				id: "d1",
				createdAt: "2026-08-30T00:00:00Z",
				goal: "lab",
				stage: "analysis",
				evidenceIds: [],
				candidates: [
					{
						id: "a",
						tool: "read",
						description: "inspect",
						goalRelevance: 1,
						informationGain: 1,
						confidence: 1,
						cost: 0,
						preconditions: [],
						risk: 0.05,
						score: 0.8,
					},
				],
				selectedActionId: "a",
				expectedResult: "artifact metadata",
			},
		});
		state = applySecurityEvent(state, {
			type: "decision_completed",
			decisionId: "d1",
			actualResult: "metadata collected",
			status: "succeeded",
			createdAt: "2026-08-30T00:01:00Z",
		});
		expect(state.decisions[0]?.actualResult).toBe("metadata collected");
		const report = buildSecurityReportMarkdown(state, []);
		expect(report).toMatch(/Decision Trace/);
		expect(report).toMatch(/Target and Attack Graph/);
		expect(report).toMatch(/Action Journal/);
	});

	it("redacts secrets in Markdown and JSON exports", () => {
		const state = createInitialSecurityState();
		state.goal = "token=secret-value";
		expect(redactSecurityText("Authorization: BearerSecret")).toContain("[REDACTED]");
		expect(buildSecurityReportJson(state, [])).not.toContain("secret-value");
	});

	it("redacts credentials before audit persistence", () => {
		const store = new MemoryStore();
		appendAuditRecord(store, {
			id: "audit-1",
			toolCallId: "call-1",
			toolName: "curl",
			createdAt: "2026-08-30T00:00:00Z",
			risk: assessToolRisk("curl", { target: "http://127.0.0.1" }),
			scope: { required: true, allowed: true, targets: ["127.0.0.1"], reasons: [] },
			policyMode: "strict",
			policyDecision: "allow",
			blocked: false,
			inputSummary: "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature sk-secretvalue12345",
		});
		const persisted = JSON.stringify(readAuditRecords(store));
		expect(persisted).not.toContain("secretvalue");
		expect(persisted).not.toContain("eyJhbGci");
		expect(persisted).toContain("REDACTED");
	});
});
