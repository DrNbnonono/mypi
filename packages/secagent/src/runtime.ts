import { randomUUID } from "node:crypto";
import type { SecurityBrowserService } from "./browser/service.ts";
import type { CompetitionProvider } from "./competition/provider.ts";
import { type CompetitionAttemptWorkspace, CompetitionScheduler } from "./competition/scheduler.ts";
import { appendAuditRecord, readAuditRecords, redactSecurityValue } from "./core/audit.ts";
import { assessReplanNeed } from "./core/planner.ts";
import { canEnableAutonomous } from "./core/policy.ts";
import { inferScopeTargetKind, normalizeScopeValue } from "./core/scope.ts";
import type { SecuritySessionStore } from "./core/state.ts";
import { appendPolicyChange, appendSecurityEvent, replaySecurityState } from "./core/state.ts";
import type {
	AutonomousAuthorization,
	CompetitionChallenge,
	IsolationState,
	PolicyMode,
	SecurityEvent,
	SecurityScope,
	SecurityState,
	ToolAuditRecord,
} from "./core/types.ts";
import { runSecAgentDiagnostics, type SecAgentDiagnostics } from "./diagnostics.ts";
import { buildSecurityReportJson, buildSecurityReportMarkdown } from "./report/generator.ts";

export type SecAgentRuntimeCommand =
	| { type: "set_scope"; scope: SecurityScope }
	| { type: "set_isolation"; isolation: IsolationState }
	| { type: "authorize_autonomous"; authorization: AutonomousAuthorization }
	| { type: "set_policy"; mode: PolicyMode; operator: string; reason: string }
	| { type: "append_event"; event: SecurityEvent }
	| { type: "run_diagnostics" }
	| { type: "build_report"; format: "markdown" | "json" }
	| { type: "competition_sync" }
	| { type: "competition_start_next" }
	| { type: "competition_start"; code: string }
	| { type: "competition_stop"; code: string }
	| { type: "competition_pause"; code: string }
	| { type: "competition_resume"; code: string }
	| { type: "competition_restart"; code: string }
	| { type: "competition_submit_flag"; code: string; flag: string; evidenceIds?: string[] }
	| { type: "competition_view_hint"; code: string };

export interface SecAgentRuntimeOptions {
	cwd?: string;
	runtimePackagesReady?: boolean;
	competitionProvider?: CompetitionProvider;
	competitionMaxConcurrent?: number;
	competitionCallsPerSecond?: number;
	competitionHintsAllowed?: boolean;
	createCompetitionAttemptWorkspace?: (
		challenge: CompetitionChallenge,
		attemptId: string,
	) => Promise<CompetitionAttemptWorkspace>;
	browserService?: SecurityBrowserService;
}

export interface SecAgentProfileSnapshot {
	mode: "sec";
	state: SecurityState;
	audit: ToolAuditRecord[];
	replanRequired: boolean;
	replanDecisionId?: string;
	replanReason?: string;
	autonomousReady: boolean;
	autonomousBlockReason?: string;
	diagnostics?: SecAgentDiagnostics;
}

export class SecAgentRuntime {
	readonly browserService: SecurityBrowserService | undefined;
	private state: SecurityState;
	private readonly listeners = new Set<(snapshot: SecAgentProfileSnapshot) => void>();
	private readonly store: SecuritySessionStore;
	private readonly cwd: string;
	private diagnostics: SecAgentDiagnostics | undefined;
	private readonly competitionScheduler: CompetitionScheduler | undefined;

	private readonly runtimePackagesReady: boolean | undefined;

	constructor(store: SecuritySessionStore, options: SecAgentRuntimeOptions = {}) {
		this.store = store;
		this.cwd = options.cwd ?? process.cwd();
		this.runtimePackagesReady = options.runtimePackagesReady;
		this.browserService = options.browserService;
		this.state = replaySecurityState(store);
		this.competitionScheduler = options.competitionProvider
			? new CompetitionScheduler(options.competitionProvider, {
					initialState: this.state.competition,
					maxConcurrent: options.competitionMaxConcurrent,
					callsPerSecond: options.competitionCallsPerSecond,
					hintsAllowed: options.competitionHintsAllowed,
					createAttemptWorkspace: options.createCompetitionAttemptWorkspace,
					onStateChange: (competition) =>
						this.append({ type: "competition_state_changed", competition, createdAt: new Date().toISOString() }),
				})
			: undefined;
	}

	readAudit(): ToolAuditRecord[] {
		return readAuditRecords(this.store);
	}

	appendAudit(record: ToolAuditRecord): void {
		appendAuditRecord(this.store, record);
		this.emit();
	}

	reload(): void {
		this.state = replaySecurityState(this.store);
		this.competitionScheduler?.replaceState(this.state.competition);
		this.emit();
	}

	snapshot(): SecAgentProfileSnapshot {
		const autonomous = canEnableAutonomous(this.state, { runtimePackagesReady: this.runtimePackagesReady });
		const replan = assessReplanNeed(this.state);
		return {
			mode: "sec",
			state: structuredClone(this.state),
			audit: structuredClone(readAuditRecords(this.store)),
			replanRequired: replan.required,
			replanDecisionId: replan.decisionId,
			replanReason: replan.reason,
			autonomousReady: autonomous.allowed,
			autonomousBlockReason: autonomous.reason,
			diagnostics: this.diagnostics ? structuredClone(this.diagnostics) : undefined,
		};
	}

	subscribe(listener: (snapshot: SecAgentProfileSnapshot) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	command(command: SecAgentRuntimeCommand): unknown | Promise<unknown> {
		const commandType = (command as { type?: unknown } | undefined)?.type;
		if (
			![
				"set_scope",
				"set_isolation",
				"authorize_autonomous",
				"set_policy",
				"append_event",
				"run_diagnostics",
				"build_report",
				"competition_sync",
				"competition_start_next",
				"competition_start",
				"competition_stop",
				"competition_pause",
				"competition_resume",
				"competition_restart",
				"competition_submit_flag",
				"competition_view_hint",
			].includes(typeof commandType === "string" ? commandType : "")
		) {
			throw new Error("Unsupported SecAgent profile command");
		}
		switch (command.type) {
			case "set_scope":
				this.append({ type: "scope_set", scope: command.scope, createdAt: new Date().toISOString() });
				break;
			case "set_isolation":
				this.append({
					type: "isolation_changed",
					isolation: command.isolation,
					createdAt: new Date().toISOString(),
				});
				break;
			case "authorize_autonomous":
				this.append({
					type: "autonomous_authorized",
					authorization: command.authorization,
					createdAt: new Date().toISOString(),
				});
				break;
			case "append_event":
				this.append(command.event);
				break;
			case "run_diagnostics":
				return this.runDiagnostics();
			case "build_report": {
				const records = readAuditRecords(this.store);
				return command.format === "json"
					? buildSecurityReportJson(this.state, records)
					: buildSecurityReportMarkdown(this.state, records);
			}
			case "competition_sync":
				return this.requireCompetitionScheduler().syncChallenges();
			case "competition_start_next":
				return this.requireCompetitionScheduler()
					.startNext()
					.then((attempt) => {
						if (attempt) this.authorizeCompetitionEntrypoints(attempt.entrypoints, attempt.challengeCode);
						return attempt;
					});
			case "competition_start":
				return this.requireCompetitionScheduler()
					.startChallenge(command.code)
					.then((attempt) => {
						this.authorizeCompetitionEntrypoints(attempt.entrypoints, attempt.challengeCode);
						return attempt;
					});
			case "competition_stop":
				return this.requireCompetitionScheduler()
					.stopChallenge(command.code)
					.then(() => this.snapshot());
			case "competition_pause":
				return this.requireCompetitionScheduler()
					.pauseChallenge(command.code)
					.then(() => this.snapshot());
			case "competition_resume":
				return this.requireCompetitionScheduler()
					.resumeChallenge(command.code)
					.then((attempt) => {
						this.authorizeCompetitionEntrypoints(attempt.entrypoints, attempt.challengeCode);
						return attempt;
					});
			case "competition_restart":
				return this.requireCompetitionScheduler()
					.restartChallenge(command.code)
					.then((attempt) => {
						this.authorizeCompetitionEntrypoints(attempt.entrypoints, attempt.challengeCode);
						return attempt;
					});
			case "competition_submit_flag":
				return this.requireCompetitionScheduler().submitFlag(command.code, command.flag, command.evidenceIds);
			case "competition_view_hint":
				return this.requireCompetitionScheduler().viewHint(command.code);
			case "set_policy": {
				if (command.mode === "autonomous") {
					const readiness = canEnableAutonomous(this.state, { runtimePackagesReady: this.runtimePackagesReady });
					if (!readiness.allowed) throw new Error(readiness.reason);
				}
				this.state = appendPolicyChange(this.store, this.state, command.mode, command.operator, command.reason);
				this.emit();
				break;
			}
		}
		return this.snapshot();
	}

	async runDiagnostics(): Promise<SecAgentDiagnostics> {
		this.diagnostics = await runSecAgentDiagnostics({
			cwd: this.cwd,
			isolation: this.state.isolation,
			executionContext: { browser: this.browserService },
		});
		this.emit();
		return structuredClone(this.diagnostics);
	}

	append(event: SecurityEvent): SecurityState {
		this.state = appendSecurityEvent(this.store, this.state, redactSecurityValue(event));
		this.emit();
		return this.state;
	}

	private emit(): void {
		const snapshot = this.snapshot();
		for (const listener of this.listeners) listener(snapshot);
	}

	private requireCompetitionScheduler(): CompetitionScheduler {
		if (!this.competitionScheduler)
			throw new Error("Competition provider is not configured for this SecAgent profile");
		return this.competitionScheduler;
	}

	private authorizeCompetitionEntrypoints(entrypoints: readonly string[], challengeCode: string): void {
		const existing = new Map(this.state.scope.targets.map((target) => [`${target.kind}:${target.value}`, target]));
		for (const raw of entrypoints) {
			const kind = inferScopeTargetKind(raw);
			const value = normalizeScopeValue(raw, kind);
			if (value) existing.set(`${kind}:${value}`, { id: randomUUID(), kind, value });
		}
		this.append({
			type: "scope_set",
			scope: {
				targets: [...existing.values()],
				note: `Competition platform authorized challenge ${challengeCode}`,
				authorizationSource: `competition-provider:${this.state.competition?.providerId ?? "configured"}`,
				updatedAt: new Date().toISOString(),
			},
			createdAt: new Date().toISOString(),
		});
	}
}
