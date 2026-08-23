export type SecurityStage =
	| "understanding"
	| "recon"
	| "analysis"
	| "verification"
	| "response"
	| "report";

export type RiskLevel = "P0" | "P1" | "P2" | "P3";

export type PolicyMode = "strict" | "competition";

export type EvidenceKind = "observation" | "artifact" | "indicator" | "finding";

export type ScopeTargetKind = "host" | "domain" | "ipv4" | "cidr" | "url";

export type ToolCategory = "internal" | "local" | "network" | "recon" | "web" | "analysis" | "response" | "shell";

export type ToolScopeMode = "none" | "network-target" | "dynamic";

export interface ScopeTarget {
	id: string;
	kind: ScopeTargetKind;
	value: string;
}

export interface SecurityScope {
	targets: ScopeTarget[];
	note?: string;
	updatedAt?: string;
}

export interface SecurityEvidence {
	id: string;
	kind: EvidenceKind;
	summary: string;
	source?: string;
	confidence: number;
	createdAt: string;
}

export interface SecurityFinding {
	id: string;
	summary: string;
	severity: "info" | "low" | "medium" | "high" | "critical";
	createdAt: string;
}

export interface SecurityToolMetadata {
	name: string;
	aliases: string[];
	category: ToolCategory;
	baseRisk: RiskLevel;
	scopeMode: ToolScopeMode;
	capabilities: string[];
	preconditions: string[];
	postconditions: string[];
	recommendedAgents: string[];
	description: string;
}

export interface ToolResolution {
	known: boolean;
	resolvedTools: string[];
	capabilities: string[];
	baseRisk: RiskLevel;
	requiresScope: boolean;
	reasons: string[];
}

export interface CandidateActionInput {
	id: string;
	tool: string;
	description: string;
	goalRelevance: number;
	informationGain: number;
	confidence: number;
	riskHint?: number;
	cost: number;
	preconditions: string[];
}

export interface CandidateAction extends CandidateActionInput {
	risk: number;
}

export interface ScoredAction extends CandidateAction {
	score: number;
}

export interface SecurityDecision {
	id: string;
	createdAt: string;
	goal: string;
	stage: SecurityStage;
	candidates: ScoredAction[];
	selectedActionId: string;
	rationale?: string;
}

export interface SecurityState {
	version: 3;
	revision: number;
	goal: string;
	stage: SecurityStage;
	policyMode: PolicyMode;
	scope: SecurityScope;
	evidence: SecurityEvidence[];
	hypotheses: string[];
	findings: SecurityFinding[];
	decisions: SecurityDecision[];
}

export type SecurityEvent =
	| {
			type: "task_started";
			goal: string;
			createdAt: string;
	  }
	| {
			type: "stage_changed";
			stage: SecurityStage;
			createdAt: string;
	  }
	| {
			type: "policy_changed";
			mode: PolicyMode;
			createdAt: string;
	  }
	| {
			type: "scope_set";
			scope: SecurityScope;
			createdAt: string;
	  }
	| {
			type: "evidence_added";
			evidence: SecurityEvidence;
			createdAt: string;
	  }
	| {
			type: "hypothesis_added";
			hypothesis: string;
			createdAt: string;
	  }
	| {
			type: "finding_added";
			finding: SecurityFinding;
			createdAt: string;
	  }
	| {
			type: "decision_recorded";
			decision: SecurityDecision;
			createdAt: string;
	  };

export interface RiskAssessment {
	level: RiskLevel;
	reasons: string[];
	resolution: ToolResolution;
}

export interface ScopeAssessment {
	required: boolean;
	allowed: boolean;
	targets: string[];
	reasons: string[];
}

export interface ToolAuditRecord {
	id: string;
	toolCallId: string;
	toolName: string;
	createdAt: string;
	completedAt?: string;
	risk: RiskAssessment;
	scope: ScopeAssessment;
	policyMode: PolicyMode;
	policyDecision: "allow" | "confirm" | "deny";
	userApproved?: boolean;
	blocked: boolean;
	blockReason?: string;
	isError?: boolean;
	inputSummary: string;
	resultSummary?: string;
}
