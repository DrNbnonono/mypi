import assert from "node:assert/strict";
import test from "node:test";
import type { SecurityState, ToolAuditRecord } from "../core/types.ts";
import { buildSecurityReportJson, buildSecurityReportMarkdown } from "../report/generator.ts";

const state: SecurityState = {
	version: 3,
	revision: 4,
	goal: "Assess the authorized lab web service",
	stage: "report",
	policyMode: "strict",
	scope: { targets: [{ id: "scope-1", kind: "domain", value: "lab.example.com" }] },
	evidence: [{ id: "ev-1", kind: "observation", summary: "HTTP service responded", confidence: 0.9, createdAt: "2026-08-23T00:00:00Z" }],
	hypotheses: ["The application may expose an outdated component"],
	findings: [{ id: "f-1", severity: "medium", summary: "Outdated component confirmed", createdAt: "2026-08-23T00:01:00Z" }],
	decisions: [{
		id: "d-1",
		createdAt: "2026-08-23T00:00:30Z",
		goal: "Assess the authorized lab web service",
		stage: "analysis",
		candidates: [{ id: "a", tool: "curl", description: "inspect headers", goalRelevance: 1, informationGain: 0.8, confidence: 0.9, risk: 0.3, cost: 0.1, preconditions: [], score: 0.8 }],
		selectedActionId: "a",
	}],
};

const audit: ToolAuditRecord[] = [{
	id: "audit-1",
	toolCallId: "call-1",
	toolName: "bash",
	createdAt: "2026-08-23T00:00:40Z",
	risk: { level: "P1", reasons: ["shell execution"], resolution: { known: true, resolvedTools: ["curl"], capabilities: ["network.http.request"], baseRisk: "P1", requiresScope: true, reasons: [] } },
	scope: { required: true, allowed: true, targets: ["https://lab.example.com"], reasons: [] },
	policyMode: "strict",
	policyDecision: "allow",
	blocked: false,
	inputSummary: "curl https://lab.example.com",
	resultSummary: "HTTP/1.1 200 OK",
}];

test("markdown report separates evidence, hypotheses, findings, decisions, and audit", () => {
	const report = buildSecurityReportMarkdown(state, audit);
	assert.match(report, /## Authorized Scope/);
	assert.match(report, /lab\.example\.com/);
	assert.match(report, /## Evidence/);
	assert.match(report, /## Hypotheses/);
	assert.match(report, /## Confirmed Findings/);
	assert.match(report, /## Decision Trace/);
	assert.match(report, /## Tool Audit Timeline/);
});

test("json report can omit audit records", () => {
	const parsed = JSON.parse(buildSecurityReportJson(state, audit, { includeAudit: false })) as { audit: unknown[]; findings: unknown[] };
	assert.equal(parsed.audit.length, 0);
	assert.equal(parsed.findings.length, 1);
});
