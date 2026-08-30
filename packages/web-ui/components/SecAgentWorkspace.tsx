"use client";

import { useCallback, useEffect, useState } from "react";

interface ScopeTarget { id: string; kind: "host" | "domain" | "ipv4" | "cidr" | "url"; value: string }
interface SecurityEvidence { id: string; summary: string; confidence: number }
interface SecurityFinding { id: string; summary: string; severity: string }
interface SecurityDecision { id: string; selectedActionId: string; rationale?: string; resultStatus?: string }
interface ToolAuditRecord { id: string; createdAt: string; toolName: string; policyDecision: string; blocked: boolean; isError?: boolean }
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
}

type ProfileMode = "coding" | "sec";

interface ProfileResponse {
	agentMode?: ProfileMode;
	value: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
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
		&& typeof value.autonomousReady === "boolean";
}

export function targetKind(value: string): ScopeTarget["kind"] {
	if (/^https?:\/\//i.test(value)) return "url";
	if (/^(?:\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/.test(value)) return "cidr";
	if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)) return "ipv4";
	return value.includes(".") ? "domain" : "host";
}

async function readResponse(response: Response): Promise<ProfileResponse> {
	let body: unknown;
	try {
		body = await response.json();
	} catch {
		throw new Error(`Profile API returned invalid JSON (HTTP ${response.status})`);
	}
	if (!isRecord(body)) throw new Error("Profile API returned an invalid response");
	if (!response.ok) {
		const message = typeof body.error === "string" ? body.error : `HTTP ${response.status}`;
		throw new Error(message);
	}
	const agentMode = body.agentMode === "coding" || body.agentMode === "sec" ? body.agentMode : undefined;
	return { agentMode, value: body.data ?? body.profileState ?? null };
}

function errorText(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

export function SecAgentWorkspace({ sessionId }: { sessionId: string | null }) {
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
	const [policyReason, setPolicyReason] = useState("Competition task configuration");
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
			const result = await readResponse(response);
			if (signal.aborted) return;
			if (result.agentMode === "coding") {
				setSnapshot(null);
				setLoadState("coding");
				return;
			}
			if (!isSecurityProfileSnapshot(result.value)) throw new Error("Sec profile returned an empty or invalid snapshot");
			setSnapshot(result.value);
			setLoadState("ready");
		} catch (cause) {
			if (!signal.aborted) {
				setLoadState("idle");
				setError(errorText(cause));
			}
		}
	}, [sessionId]);

	const command = useCallback(async (body: Record<string, unknown>): Promise<unknown> => {
		if (!sessionId) throw new Error("Security session has not started");
		setBusy(true);
		setError(null);
		try {
			const result = await readResponse(await fetch(`/api/agent/${encodeURIComponent(sessionId)}/profile`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			}));
			if (result.agentMode === "coding") throw new Error("This session is a coding session; security commands are unavailable");
			if (isSecurityProfileSnapshot(result.value)) setSnapshot(result.value);
			return result.value;
		} finally {
			setBusy(false);
		}
	}, [sessionId]);

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
				setConnectionError("实时安全状态事件格式无效");
			}
		};
		source.onerror = () => setConnectionError("安全状态实时连接失败，浏览器将自动重连");
		return () => source.close();
	}, [loadState, sessionId]);

	const updateScope = async () => {
		const values = scopeText.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
		if (values.length === 0) throw new Error("至少提供一个授权目标");
		if (!authorizationSource.trim()) throw new Error("必须填写授权来源；附件内容不会自动授予授权");
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
			if (!isolationSource.trim()) throw new Error("Autonomous requires a sandbox or controlled external isolation source");
			if (!window.confirm("Autonomous mode may execute P2/P3 security actions inside the authorized scope. Confirm this controlled environment?")) return;
			const confirmedAt = new Date().toISOString();
			await command({ type: "set_isolation", isolation: { status: isolationKind, source: isolationSource.trim(), verifiedAt: confirmedAt } });
			await command({ type: "authorize_autonomous", authorization: { operator: "web-user", reason: policyReason, isolationSource: isolationSource.trim(), confirmedAt } });
		}
		await command({ type: "set_policy", mode, operator: "web-user", reason: policyReason });
	};

	const buildReport = async (format: "markdown" | "json") => {
		const value = await command({ type: "build_report", format });
		if (typeof value === "string") setReport({ format, content: value });
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
	if (loadState === "coding") return null;
	return (
		<div style={{ flexShrink: 0, borderBottom: "1px solid var(--border)", background: "var(--bg-panel)", fontSize: 12 }}>
			<button type="button" onClick={() => setExpanded((value) => !value)} style={{ width: "100%", border: 0, background: "transparent", color: "var(--text)", padding: "7px 12px", textAlign: "left", cursor: "pointer", fontWeight: 600 }}>
				SEC WORKSPACE · {snapshot?.state.stage ?? "not started"} · {snapshot?.state.policyMode ?? "strict"} {expanded ? "▾" : "▸"}
			</button>
			{expanded && (
				<div style={{ maxHeight: 330, overflow: "auto", padding: "0 12px 12px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 8 }}>
					{!sessionId && <div style={sectionStyle}>The Sec runtime starts when the new session is first used.</div>}
					{sessionId && loadState === "loading" && <div style={sectionStyle}>Loading Sec profile…</div>}
					{error && <div role="alert" style={{ ...sectionStyle, color: "#dc2626" }}>{error}</div>}
					{connectionError && <div role="status" style={{ ...sectionStyle, color: "#b45309" }}>{connectionError}</div>}
					<div style={sectionStyle}>
						<div style={{ fontWeight: 600, marginBottom: 6 }}>Task and authorization scope</div>
						<div>{snapshot?.state.goal || "Goal not extracted"}</div>
						<textarea aria-label="Authorized targets" value={scopeText} onChange={(event) => setScopeText(event.target.value)} placeholder="One authorized host, CIDR, domain or URL per line" style={{ width: "100%", minHeight: 52, marginTop: 6, background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)" }} />
						<input aria-label="Authorization source" value={authorizationSource} onChange={(event) => setAuthorizationSource(event.target.value)} placeholder="Authorization source" style={{ width: "100%", marginTop: 4 }} />
						<button type="button" onClick={() => void updateScope().catch((cause) => setError(errorText(cause)))} disabled={!sessionId || busy}>Set scope</button>
						<div style={{ marginTop: 5 }}>{snapshot?.state.scope.targets.map((target) => target.value).join(", ") || "No authorized targets"}</div>
					</div>
					<div style={sectionStyle}>
						<div style={{ fontWeight: 600, marginBottom: 6 }}>Policy and isolation</div>
						<div>Isolation: {snapshot?.state.isolation.status ?? "unverified"} {snapshot?.state.isolation.source ?? ""}</div>
						<select aria-label="Isolation type" value={isolationKind} onChange={(event) => setIsolationKind(event.target.value as "sandbox" | "external")} disabled={busy} style={{ width: "100%", marginTop: 5 }}>
							<option value="sandbox">pi-sandbox / container</option>
							<option value="external">Organizer controlled external isolation</option>
						</select>
						<input aria-label="Isolation source" value={isolationSource} onChange={(event) => setIsolationSource(event.target.value)} placeholder="Sandbox/container or organizer environment" style={{ width: "100%", marginTop: 5 }} />
						<input aria-label="Policy change reason" value={policyReason} onChange={(event) => setPolicyReason(event.target.value)} placeholder="Reason" style={{ width: "100%", marginTop: 4 }} />
						<div style={{ display: "flex", gap: 4, marginTop: 5, flexWrap: "wrap" }}>
							{(["strict", "competition", "autonomous"] as const).map((mode) => <button type="button" key={mode} onClick={() => void updatePolicy(mode).catch((cause) => setError(errorText(cause)))} disabled={!sessionId || busy}>{mode}</button>)}
						</div>
						{snapshot?.autonomousBlockReason && <div style={{ color: "var(--text-dim)", marginTop: 5 }}>{snapshot.autonomousBlockReason}</div>}
					</div>
					<div style={sectionStyle}>
						<div style={{ fontWeight: 600, marginBottom: 6 }}>Evidence and findings</div>
						<div>{snapshot?.state.evidence.length ?? 0} evidence · {snapshot?.state.hypotheses.length ?? 0} hypotheses · {snapshot?.state.findings.length ?? 0} findings</div>
						{snapshot?.state.findings.slice(-4).map((finding) => <div key={finding.id}>[{finding.severity}] {finding.summary}</div>)}
					</div>
					<div style={sectionStyle}>
						<div style={{ fontWeight: 600, marginBottom: 6 }}>Decision and tool audit</div>
						<div>{snapshot?.state.decisions.length ?? 0} decisions · {snapshot?.audit.length ?? 0} tool calls</div>
						{snapshot?.audit.slice(-4).map((record) => <div key={record.id}>{record.blocked ? "BLOCK" : record.isError ? "ERROR" : "OK"} {record.toolName} · {record.policyDecision}</div>)}
					</div>
					<div style={{ ...sectionStyle, gridColumn: "1 / -1" }}>
						<div style={{ display: "flex", gap: 5, alignItems: "center" }}><strong>Report</strong><button type="button" disabled={!sessionId || busy} onClick={() => void buildReport("markdown").catch((cause) => setError(errorText(cause)))}>Markdown</button><button type="button" disabled={!sessionId || busy} onClick={() => void buildReport("json").catch((cause) => setError(errorText(cause)))}>JSON</button><button type="button" disabled={!report} onClick={downloadReport}>Download</button></div>
						{report && <pre style={{ maxHeight: 150, overflow: "auto", whiteSpace: "pre-wrap", marginBottom: 0 }}>{report.content}</pre>}
					</div>
				</div>
			)}
		</div>
	);
}
