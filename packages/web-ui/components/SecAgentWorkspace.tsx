"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";

interface ScopeTarget { id: string; kind: "host" | "domain" | "ipv4" | "cidr" | "url"; value: string }
interface SecurityEvidence { id: string; summary: string; confidence: number }
interface SecurityFinding { id: string; summary: string; severity: string }
interface SecurityDecision { id: string; selectedActionId: string; rationale?: string; resultStatus?: string }
interface ToolAuditRecord { id: string; createdAt: string; toolName: string; policyDecision: string; blocked: boolean; isError?: boolean }
interface SecAgentDiagnosticCheck { id: string; label: string; status: "pass" | "warn" | "fail"; message: string }
interface SecAgentDiagnostics { createdAt: string; ready: boolean; runtimeReady: boolean; autonomousReady: boolean; demoReady: boolean; checks: SecAgentDiagnosticCheck[] }
interface SecurityProfileSnapshot {
	mode: "sec";
	state: {
		goal: string;
		stage: string;
		policyMode: "strict" | "competition" | "autonomous";
		isolation: { status: "unverified" | "sandbox" | "external"; source?: string };
		scope: { targets: ScopeTarget[]; authorizationSource?: string };
		evidence: SecurityEvidence[];
		hypotheses: string[];
		findings: SecurityFinding[];
		decisions: SecurityDecision[];
	};
	audit: ToolAuditRecord[];
	autonomousReady: boolean;
	autonomousBlockReason?: string;
	diagnostics?: SecAgentDiagnostics;
}

type ProfileMode = "coding" | "sec";
type SecurityStage = "understanding" | "planning" | "recon" | "analysis" | "verification" | "response" | "report";
type Translate = ReturnType<typeof useI18n>["t"];

interface ProfileResponse {
	agentMode?: ProfileMode;
	value: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

const stageKeys: Record<SecurityStage, string> = {
	understanding: "sec.stage.understanding",
	planning: "sec.stage.planning",
	recon: "sec.stage.recon",
	analysis: "sec.stage.analysis",
	verification: "sec.stage.verification",
	response: "sec.stage.response",
	report: "sec.stage.report",
};

const policyModeKeys = {
	strict: "sec.policy.mode.strict",
	competition: "sec.policy.mode.competition",
	autonomous: "sec.policy.mode.autonomous",
} as const;

const isolationStatusKeys = {
	unverified: "sec.isolation.status.unverified",
	sandbox: "sec.isolation.status.sandbox",
	external: "sec.isolation.status.external",
} as const;

const diagnosticStatusKeys = {
	pass: "sec.diagnostics.status.pass",
	warn: "sec.diagnostics.status.warn",
	fail: "sec.diagnostics.status.fail",
} as const;

const policyDecisionKeys = {
	allow: "sec.audit.decision.allow",
	confirm: "sec.audit.decision.confirm",
	deny: "sec.audit.decision.deny",
	warn: "sec.audit.decision.warn",
} as const;

function translateStructuredValue(value: string, keys: Record<string, string>, t: Translate): string {
	const key = keys[value];
	return key ? t(key) : value;
}

function stageLabel(stage: string, t: Translate): string {
	return translateStructuredValue(stage, stageKeys, t);
}

function policyModeLabel(mode: SecurityProfileSnapshot["state"]["policyMode"], t: Translate): string {
	return t(policyModeKeys[mode]);
}

function isolationStatusLabel(status: SecurityProfileSnapshot["state"]["isolation"]["status"], t: Translate): string {
	return t(isolationStatusKeys[status]);
}

function diagnosticStatusLabel(status: SecAgentDiagnosticCheck["status"], t: Translate): string {
	return t(diagnosticStatusKeys[status]);
}

function policyDecisionLabel(decision: string, t: Translate): string {
	return translateStructuredValue(decision, policyDecisionKeys, t);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isSecAgentDiagnostics(value: unknown): value is SecAgentDiagnostics {
	return isRecord(value)
		&& typeof value.createdAt === "string"
		&& typeof value.ready === "boolean"
		&& typeof value.runtimeReady === "boolean"
		&& typeof value.autonomousReady === "boolean"
		&& typeof value.demoReady === "boolean"
		&& Array.isArray(value.checks)
		&& value.checks.every((check) => isRecord(check)
			&& typeof check.id === "string"
			&& typeof check.label === "string"
			&& (check.status === "pass" || check.status === "warn" || check.status === "fail")
			&& typeof check.message === "string");
}

export function isSecurityProfileSnapshot(value: unknown): value is SecurityProfileSnapshot {
	if (!isRecord(value) || value.mode !== "sec" || !isRecord(value.state)) return false;
	const state = value.state;
	const scope = state.scope;
	const isolation = state.isolation;
	return typeof state.goal === "string"
		&& typeof state.stage === "string"
		&& (state.policyMode === "strict" || state.policyMode === "competition" || state.policyMode === "autonomous")
		&& isRecord(isolation)
		&& (isolation.status === "unverified" || isolation.status === "sandbox" || isolation.status === "external")
		&& isRecord(scope)
		&& Array.isArray(scope.targets)
		&& scope.targets.every((target) => isRecord(target) && typeof target.id === "string" && typeof target.value === "string")
		&& Array.isArray(state.evidence)
		&& Array.isArray(state.findings)
		&& isStringArray(state.hypotheses)
		&& Array.isArray(state.decisions)
		&& Array.isArray(value.audit)
		&& typeof value.autonomousReady === "boolean"
		&& (value.diagnostics === undefined || isSecAgentDiagnostics(value.diagnostics));
}

export function targetKind(value: string): ScopeTarget["kind"] {
	if (/^https?:\/\//i.test(value)) return "url";
	if (/^(?:\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/.test(value)) return "cidr";
	if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)) return "ipv4";
	return value.includes(".") ? "domain" : "host";
}

async function readResponse(response: Response, t: Translate): Promise<ProfileResponse> {
	let body: unknown;
	try {
		body = await response.json();
	} catch {
		throw new Error(`${t("sec.error.invalidJson")} (HTTP ${response.status})`);
	}
	if (!isRecord(body)) throw new Error(t("sec.error.invalidResponse"));
	if (!response.ok) {
		const message = typeof body.error === "string" ? body.error : t("sec.error.httpStatus", { status: response.status });
		throw new Error(message);
	}
	const agentMode = body.agentMode === "coding" || body.agentMode === "sec" ? body.agentMode : undefined;
	return { agentMode, value: body.data ?? body.profileState ?? null };
}

function errorText(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

export function SecAgentWorkspace({ sessionId }: { sessionId: string | null }) {
	const { t } = useI18n();
	const [snapshot, setSnapshot] = useState<SecurityProfileSnapshot | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [connectionError, setConnectionError] = useState<string | null>(null);
	const [loadState, setLoadState] = useState<"idle" | "loading" | "ready" | "coding">("idle");
	const [busy, setBusy] = useState(false);
	const [expanded, setExpanded] = useState(true);
	const [scopeText, setScopeText] = useState("");
	const [authorizationSource, setAuthorizationSource] = useState("");
	const [isolationSource, setIsolationSource] = useState("");
	const [isolationKind, setIsolationKind] = useState<"sandbox" | "external">("sandbox");
	const [policyReason, setPolicyReason] = useState("");
	const [report, setReport] = useState<{ format: "markdown" | "json"; content: string } | null>(null);

	const load = useCallback(async (signal: AbortSignal) => {
		if (!sessionId) {
			setLoadState("idle");
			setSnapshot(null);
			return;
		}
		setLoadState("loading");
		setSnapshot(null);
		setError(null);
		setConnectionError(null);
		try {
			const response = await fetch(`/api/agent/${encodeURIComponent(sessionId)}/profile`, { cache: "no-store", signal });
			const result = await readResponse(response, t);
			if (signal.aborted) return;
			if (result.agentMode === "coding") {
				setSnapshot(null);
				setLoadState("coding");
				return;
			}
			if (!isSecurityProfileSnapshot(result.value)) throw new Error(t("sec.error.invalidSnapshot"));
			setSnapshot(result.value);
			setLoadState("ready");
		} catch (cause) {
			if (!signal.aborted) {
				setLoadState("idle");
				setError(errorText(cause));
			}
		}
	}, [sessionId, t]);

	const command = useCallback(async (body: Record<string, unknown>): Promise<unknown> => {
		if (!sessionId) throw new Error(t("sec.error.sessionNotStarted"));
		setBusy(true);
		setError(null);
		try {
			const result = await readResponse(
				await fetch(`/api/agent/${encodeURIComponent(sessionId)}/profile`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(body),
				}),
				t,
			);
			if (result.agentMode === "coding") throw new Error(t("sec.error.codingSession"));
			if (isSecurityProfileSnapshot(result.value)) setSnapshot(result.value);
			return result.value;
		} finally {
			setBusy(false);
		}
	}, [sessionId, t]);

	useEffect(() => {
		const controller = new AbortController();
		setReport(null);
		void load(controller.signal);
		return () => controller.abort();
	}, [load]);
	useEffect(() => {
		if (!snapshot) return;
		setScopeText((value) => value || snapshot.state.scope.targets.map((target) => target.value).join("\n"));
		setAuthorizationSource((value) => value || snapshot.state.scope.authorizationSource || "");
		setIsolationSource((value) => value || snapshot.state.isolation.source || "");
		if (snapshot.state.isolation.status === "sandbox" || snapshot.state.isolation.status === "external") {
			setIsolationKind(snapshot.state.isolation.status);
		}
	}, [snapshot]);
	useEffect(() => {
		if (!sessionId || loadState !== "ready") return;
		const source = new EventSource(`/api/agent/${encodeURIComponent(sessionId)}/events`);
		source.onopen = () => setConnectionError(null);
		source.onmessage = (message) => {
			try {
				const event = JSON.parse(message.data) as Record<string, unknown>;
				if (event.type === "profile_state" && isSecurityProfileSnapshot(event.profileState)) setSnapshot(event.profileState);
			} catch {
				setConnectionError(t("sec.error.invalidEvent"));
			}
		};
		source.onerror = () => setConnectionError(t("sec.error.connectionFailed"));
		return () => source.close();
	}, [loadState, sessionId, t]);

	const updateScope = async () => {
		const values = scopeText.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
		if (values.length === 0) throw new Error(t("sec.error.scopeRequired"));
		if (!authorizationSource.trim()) throw new Error(t("sec.error.authorizationRequired"));
		await command({
			type: "set_scope",
			scope: {
				targets: values.map((value, index) => ({ id: `web-scope-${index}-${value}`, kind: targetKind(value), value })),
				authorizationSource: authorizationSource.trim(),
			},
		});
	};

	const updatePolicy = async (mode: "strict" | "competition" | "autonomous") => {
		if (mode === "autonomous") {
			if (!isolationSource.trim()) throw new Error(t("sec.error.autonomousIsolationRequired"));
			if (!window.confirm(t("sec.confirm.autonomous"))) return;
			const confirmedAt = new Date().toISOString();
			await command({ type: "set_isolation", isolation: { status: isolationKind, source: isolationSource.trim(), verifiedAt: confirmedAt } });
			await command({ type: "authorize_autonomous", authorization: { operator: "web-user", reason: policyReason.trim() || t("sec.policy.defaultReason"), isolationSource: isolationSource.trim(), confirmedAt } });
		}
		await command({ type: "set_policy", mode, operator: "web-user", reason: policyReason.trim() || t("sec.policy.defaultReason") });
	};

	const buildReport = async (format: "markdown" | "json") => {
		const value = await command({ type: "build_report", format });
		if (typeof value === "string") setReport({ format, content: value });
	};

	const runDiagnostics = async () => {
		const value = await command({ type: "run_diagnostics" });
		if (!isSecAgentDiagnostics(value)) throw new Error(t("sec.error.invalidDiagnostics"));
		setSnapshot((current) => current ? { ...current, diagnostics: value } : current);
	};

	const downloadReport = () => {
		if (!report) return;
		const blob = new Blob([report.content], { type: report.format === "json" ? "application/json" : "text/markdown" });
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.download = `secagent-report.${report.format === "json" ? "json" : "md"}`;
		link.click();
		setTimeout(() => URL.revokeObjectURL(url), 0);
	};

	const sectionStyle = { border: "1px solid var(--border)", borderRadius: 6, padding: 8, minWidth: 0 } as const;
	const currentStage = snapshot ? stageLabel(snapshot.state.stage, t) : t("sec.stage.notStarted");
	const currentPolicy = snapshot ? policyModeLabel(snapshot.state.policyMode, t) : policyModeLabel("strict", t);
	const currentIsolation = snapshot ? isolationStatusLabel(snapshot.state.isolation.status, t) : isolationStatusLabel("unverified", t);
	if (loadState === "coding") return null;
	return (
		<div style={{ flexShrink: 0, borderBottom: "1px solid var(--border)", background: "var(--bg-panel)", fontSize: 12 }}>
			<button type="button" onClick={() => setExpanded((value) => !value)} style={{ width: "100%", border: 0, background: "transparent", color: "var(--text)", padding: "7px 12px", textAlign: "left", cursor: "pointer", fontWeight: 600 }}>
				{t("sec.title")} · {currentStage} · {currentPolicy} {expanded ? "▾" : "▸"}
			</button>
			{expanded && (
				<div style={{ maxHeight: 330, overflow: "auto", padding: "0 12px 12px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 8 }}>
					{!sessionId && <div style={sectionStyle}>{t("sec.runtimeStarts")}</div>}
					{sessionId && loadState === "loading" && <div style={sectionStyle}>{t("sec.loading")}</div>}
					{error && <div role="alert" style={{ ...sectionStyle, color: "#dc2626" }}>{error}</div>}
					{connectionError && <div role="status" style={{ ...sectionStyle, color: "#b45309" }}>{connectionError}</div>}
					<div style={sectionStyle}>
						<div style={{ fontWeight: 600, marginBottom: 6 }}>{t("sec.scope.title")}</div>
						<div>{snapshot?.state.goal || t("sec.scope.goalNotExtracted")}</div>
						<textarea aria-label={t("sec.scope.authorizedTargets")} value={scopeText} onChange={(event) => setScopeText(event.target.value)} placeholder={t("sec.scope.authorizedTargetsPlaceholder")} style={{ width: "100%", minHeight: 52, marginTop: 6, background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)" }} />
						<input aria-label={t("sec.scope.authorizationSource")} value={authorizationSource} onChange={(event) => setAuthorizationSource(event.target.value)} placeholder={t("sec.scope.authorizationSourcePlaceholder")} style={{ width: "100%", marginTop: 4 }} />
						<button type="button" onClick={() => void updateScope().catch((cause) => setError(errorText(cause)))} disabled={!sessionId || busy}>{t("sec.scope.set")}</button>
						<div style={{ marginTop: 5 }}>{snapshot?.state.scope.targets.map((target) => target.value).join(", ") || t("sec.scope.noAuthorizedTargets")}</div>
					</div>
					<div style={sectionStyle}>
						<div style={{ fontWeight: 600, marginBottom: 6 }}>{t("sec.policy.title")}</div>
						<div>{t("sec.policy.isolation", { status: currentIsolation })} {snapshot?.state.isolation.source ?? ""}</div>
						<select aria-label={t("sec.policy.isolationType")} value={isolationKind} onChange={(event) => setIsolationKind(event.target.value as "sandbox" | "external")} disabled={busy} style={{ width: "100%", marginTop: 5 }}>
							<option value="sandbox">{t("sec.isolation.type.sandbox")}</option>
							<option value="external">{t("sec.isolation.type.external")}</option>
						</select>
						<input aria-label={t("sec.policy.isolationSource")} value={isolationSource} onChange={(event) => setIsolationSource(event.target.value)} placeholder={t("sec.policy.isolationSourcePlaceholder")} style={{ width: "100%", marginTop: 5 }} />
						<input aria-label={t("sec.policy.changeReason")} value={policyReason} onChange={(event) => setPolicyReason(event.target.value)} placeholder={t("sec.policy.reasonPlaceholder")} style={{ width: "100%", marginTop: 4 }} />
						<div style={{ display: "flex", gap: 4, marginTop: 5, flexWrap: "wrap" }}>
							{(["strict", "competition", "autonomous"] as const).map((mode) => <button type="button" key={mode} onClick={() => void updatePolicy(mode).catch((cause) => setError(errorText(cause)))} disabled={!sessionId || busy}>{t(policyModeKeys[mode])}</button>)}
						</div>
						{snapshot?.autonomousBlockReason && <div style={{ color: "var(--text-dim)", marginTop: 5 }}>{snapshot.autonomousBlockReason}</div>}
					</div>
					<div style={sectionStyle}>
						<div style={{ fontWeight: 600, marginBottom: 6 }}>{t("sec.evidence.title")}</div>
						<div>{t("sec.evidence.summary", { evidence: snapshot?.state.evidence.length ?? 0, hypotheses: snapshot?.state.hypotheses.length ?? 0, findings: snapshot?.state.findings.length ?? 0 })}</div>
						{snapshot?.state.findings.slice(-4).map((finding) => <div key={finding.id}>[{finding.severity}] {finding.summary}</div>)}
					</div>
					<div style={sectionStyle}>
						<div style={{ fontWeight: 600, marginBottom: 6 }}>{t("sec.audit.title")}</div>
						<div>{t("sec.audit.summary", { decisions: snapshot?.state.decisions.length ?? 0, calls: snapshot?.audit.length ?? 0 })}</div>
						{snapshot?.audit.slice(-4).map((record) => <div key={record.id}>{t("sec.audit.entry", { status: record.blocked ? t("sec.audit.status.blocked") : record.isError ? t("sec.audit.status.error") : t("sec.audit.status.ok"), tool: record.toolName, decision: policyDecisionLabel(record.policyDecision, t) })}</div>)}
					</div>
					<div style={{ ...sectionStyle, gridColumn: "1 / -1" }}>
						<div style={{ display: "flex", gap: 5, alignItems: "center" }}>
							<strong>{t("sec.diagnostics.title")}</strong>
							<button type="button" disabled={!sessionId || busy} onClick={() => void runDiagnostics().catch((cause) => setError(errorText(cause)))}>{t("sec.diagnostics.run")}</button>
							{snapshot?.diagnostics && <span>{t("sec.diagnostics.summary", { runtime: snapshot.diagnostics.runtimeReady ? t("sec.status.ready") : t("sec.status.blocked"), autonomous: snapshot.diagnostics.autonomousReady ? t("sec.status.ready") : t("sec.status.blocked"), demo: snapshot.diagnostics.demoReady ? t("sec.status.ready") : t("sec.status.blocked") })}</span>}
						</div>
						{snapshot?.diagnostics?.checks.map((check) => <div key={check.id}>[{diagnosticStatusLabel(check.status, t)}] {check.label}: {check.message}</div>)}
					</div>
					<div style={{ ...sectionStyle, gridColumn: "1 / -1" }}>
						<div style={{ display: "flex", gap: 5, alignItems: "center" }}><strong>{t("sec.report.title")}</strong><button type="button" disabled={!sessionId || busy} onClick={() => void buildReport("markdown").catch((cause) => setError(errorText(cause)))}>Markdown</button><button type="button" disabled={!sessionId || busy} onClick={() => void buildReport("json").catch((cause) => setError(errorText(cause)))}>JSON</button><button type="button" disabled={!report} onClick={downloadReport}>{t("sec.report.download")}</button></div>
						{report && <pre style={{ maxHeight: 150, overflow: "auto", whiteSpace: "pre-wrap", marginBottom: 0 }}>{report.content}</pre>}
					</div>
				</div>
			)}
		</div>
	);
}
