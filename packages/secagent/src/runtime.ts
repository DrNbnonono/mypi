import { appendAuditRecord, readAuditRecords } from "./core/audit.ts";
import { assessReplanNeed } from "./core/planner.ts";
import { canEnableAutonomous } from "./core/policy.ts";
import type { SecuritySessionStore } from "./core/state.ts";
import { appendPolicyChange, appendSecurityEvent, replaySecurityState } from "./core/state.ts";
import type {
	AutonomousAuthorization,
	IsolationState,
	PolicyMode,
	SecurityEvent,
	SecurityScope,
	SecurityState,
	ToolAuditRecord,
} from "./core/types.ts";
import { buildSecurityReportJson, buildSecurityReportMarkdown } from "./report/generator.ts";

export type SecAgentRuntimeCommand =
	| { type: "set_scope"; scope: SecurityScope }
	| { type: "set_isolation"; isolation: IsolationState }
	| { type: "authorize_autonomous"; authorization: AutonomousAuthorization }
	| { type: "set_policy"; mode: PolicyMode; operator: string; reason: string }
	| { type: "append_event"; event: SecurityEvent }
	| { type: "build_report"; format: "markdown" | "json" };

export interface SecAgentProfileSnapshot {
	mode: "sec";
	state: SecurityState;
	audit: ToolAuditRecord[];
	replanRequired: boolean;
	replanDecisionId?: string;
	replanReason?: string;
	autonomousReady: boolean;
	autonomousBlockReason?: string;
}

export class SecAgentRuntime {
	private state: SecurityState;
	private readonly listeners = new Set<(snapshot: SecAgentProfileSnapshot) => void>();
	private readonly store: SecuritySessionStore;

	constructor(store: SecuritySessionStore) {
		this.store = store;
		this.state = replaySecurityState(store);
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
		this.emit();
	}

	snapshot(): SecAgentProfileSnapshot {
		const autonomous = canEnableAutonomous(this.state);
		const replan = assessReplanNeed(this.state.decisions);
		return {
			mode: "sec",
			state: structuredClone(this.state),
			audit: structuredClone(readAuditRecords(this.store)),
			replanRequired: replan.required,
			replanDecisionId: replan.decisionId,
			replanReason: replan.reason,
			autonomousReady: autonomous.allowed,
			autonomousBlockReason: autonomous.reason,
		};
	}

	subscribe(listener: (snapshot: SecAgentProfileSnapshot) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	command(command: SecAgentRuntimeCommand): SecAgentProfileSnapshot | string {
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
			case "build_report": {
				const records = readAuditRecords(this.store);
				return command.format === "json"
					? buildSecurityReportJson(this.state, records)
					: buildSecurityReportMarkdown(this.state, records);
			}
			case "set_policy": {
				if (command.mode === "autonomous") {
					const readiness = canEnableAutonomous(this.state);
					if (!readiness.allowed) throw new Error(readiness.reason);
				}
				this.state = appendPolicyChange(this.store, this.state, command.mode, command.operator, command.reason);
				this.emit();
				break;
			}
		}
		return this.snapshot();
	}

	append(event: SecurityEvent): SecurityState {
		this.state = appendSecurityEvent(this.store, this.state, event);
		this.emit();
		return this.state;
	}

	private emit(): void {
		const snapshot = this.snapshot();
		for (const listener of this.listeners) listener(snapshot);
	}
}
