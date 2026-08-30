export type SecurityStage =
	| "understanding"
	| "planning"
	| "recon"
	| "analysis"
	| "verification"
	| "response"
	| "report";

export type SecurityScenario =
	| "penetration-test"
	| "incident-response"
	| "vulnerability-research"
	| "web-security"
	| "reverse-engineering"
	| "ctf";
export type CtfChallengeKind = "web" | "pwn" | "reverse" | "crypto" | "forensics" | "misc" | "unknown";
export type RiskLevel = "P0" | "P1" | "P2" | "P3";
export type PolicyMode = "strict" | "competition" | "autonomous";
export type EvidenceKind = "observation" | "artifact" | "indicator" | "finding";
export type EvidenceRelation = "supports" | "contradicts" | "derived-from" | "duplicates" | "verifies";
export type VerificationStatus = "verified" | "contradicted" | "insufficient";
export type ScopeTargetKind = "host" | "domain" | "ipv4" | "cidr" | "url";
export type ToolCategory =
	| "internal"
	| "local"
	| "network"
	| "recon"
	| "web"
	| "analysis"
	| "response"
	| "reverse"
	| "shell";
export type ToolScopeMode = "none" | "network-target" | "dynamic";
export type ReplanTrigger =
	| "decision-failed"
	| "decision-contradicted"
	| "decision-stalled"
	| "repeated-failure"
	| "verification-contradicted"
	| "evidence-insufficient"
	| "budget-pressure"
	| "observer-drift";
export type ObserverSignalKind = "stalled" | "drift" | "repeated-failure" | "context-pressure" | "termination-risk";
export type SecurityAgentRole =
	| "coordinator"
	| "sec-recon"
	| "sec-web"
	| "sec-analysis"
	| "sec-response"
	| "sec-vuln"
	| "sec-reverse"
	| "ctf-specialist";

export interface ScopeTarget {
	id: string;
	kind: ScopeTargetKind;
	value: string;
}

export interface SecurityScope {
	targets: ScopeTarget[];
	note?: string;
	authorizationSource?: string;
	updatedAt?: string;
}

export interface SecurityInputAsset {
	id: string;
	name: string;
	kind: "text" | "image" | "json" | "yaml" | "csv" | "pdf" | "openapi" | "archive" | "unknown";
	path?: string;
	mimeType?: string;
	sha256?: string;
	size?: number;
}

export interface SecurityTaskSpec {
	id: string;
	goal: string;
	scenario: SecurityScenario;
	assets: SecurityInputAsset[];
	constraints: string[];
	successCriteria: string[];
	declaredAuthorization: string[];
	pendingConfirmations: string[];
	createdAt: string;
}

export interface IsolationState {
	status: "unverified" | "sandbox" | "external";
	source?: string;
	verifiedAt?: string;
}

export interface AutonomousAuthorization {
	operator: string;
	reason: string;
	isolationSource: string;
	confirmedAt: string;
}

export interface SecurityEvidence {
	id: string;
	kind: EvidenceKind;
	summary: string;
	source?: string;
	sha256?: string;
	confidence: number;
	decisionIds?: string[];
	targetRefs?: string[];
	agentRole?: SecurityAgentRole;
	createdAt: string;
}

export interface SecurityEvidenceEdge {
	id: string;
	fromEvidenceId: string;
	toEvidenceId?: string;
	toHypothesisId?: string;
	relation: EvidenceRelation;
	confidence: number;
	createdAt: string;
}

export interface SecurityHypothesisRecord {
	id: string;
	statement: string;
	status: "active" | "verified" | "contradicted" | "rejected";
	createdAt: string;
	updatedAt: string;
}

export interface SecurityVerificationRecord {
	id: string;
	hypothesisId: string;
	status: VerificationStatus;
	score: number;
	evidenceIds: string[];
	independentSources: number;
	reason: string;
	createdAt: string;
}

export interface SecurityEvidenceGraph {
	edges: SecurityEvidenceEdge[];
	hypotheses: SecurityHypothesisRecord[];
	verifications: SecurityVerificationRecord[];
}

export interface SecurityFinding {
	id: string;
	summary: string;
	severity: "info" | "low" | "medium" | "high" | "critical";
	evidenceIds?: string[];
	verificationId?: string;
	verified?: boolean;
	remediation?: string;
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
	capability?: string;
	targets?: string[];
	expectedEvidence?: string[];
	successCriteria?: string[];
	stopConditions?: string[];
	fallbackActionIds?: string[];
	estimatedDurationMs?: number;
}

export interface ScoredAction extends CandidateActionInput {
	risk: number;
	score: number;
	noveltyPenalty?: number;
	budgetPenalty?: number;
}

export interface SecurityBudgetLimits {
	maxDecisions: number;
	maxToolCalls: number;
	maxReplans: number;
	deadlineAt?: string;
}

export interface SecurityBudgetUsage {
	decisionsUsed: number;
	toolCallsUsed: number;
	replansUsed: number;
}

export interface SecurityBudgetState {
	limits: SecurityBudgetLimits;
	usage: SecurityBudgetUsage;
}

export interface SecurityDecision {
	id: string;
	createdAt: string;
	goal: string;
	stage: SecurityStage;
	evidenceIds: string[];
	candidates: ScoredAction[];
	selectedActionId: string;
	rationale?: string;
	expectedResult?: string;
	actualResult?: string;
	resultStatus?: "pending" | "succeeded" | "failed" | "contradicted";
	planRevision?: number;
	attempt?: number;
	replanId?: string;
	budgetSnapshot?: SecurityBudgetState;
}

export interface SecurityReplanRecord {
	id: string;
	trigger: ReplanTrigger;
	reason: string;
	previousDecisionId?: string;
	createdAt: string;
}

export interface SecurityObserverSignal {
	id: string;
	kind: ObserverSignalKind;
	severity: "info" | "warning" | "critical";
	reason: string;
	decisionIds: string[];
	createdAt: string;
}

export interface SecurityDelegationRecord {
	id: string;
	role: SecurityAgentRole;
	objective: string;
	parentDecisionId?: string;
	status: "planned" | "running" | "completed" | "failed" | "cancelled";
	evidenceIds: string[];
	createdAt: string;
	completedAt?: string;
}

export interface CtfChallengeProfile {
	kind: CtfChallengeKind;
	objective: string;
	recommendedCapabilities: string[];
	flagPatterns: string[];
	expectedEvidence: string[];
	createdAt: string;
}

export interface SecurityState {
	version: 5;
	revision: number;
	task?: SecurityTaskSpec;
	goal: string;
	stage: SecurityStage;
	policyMode: PolicyMode;
	isolation: IsolationState;
	autonomousAuthorization?: AutonomousAuthorization;
	scope: SecurityScope;
	evidence: SecurityEvidence[];
	evidenceGraph: SecurityEvidenceGraph;
	hypotheses: string[];
	rejectedHypotheses: string[];
	findings: SecurityFinding[];
	decisions: SecurityDecision[];
	replans: SecurityReplanRecord[];
	observerSignals: SecurityObserverSignal[];
	delegations: SecurityDelegationRecord[];
	budget: SecurityBudgetState;
	ctfProfile?: CtfChallengeProfile;
}

export type SecurityEvent =
	| { type: "task_started"; task: SecurityTaskSpec; createdAt: string }
	| { type: "stage_changed"; stage: SecurityStage; createdAt: string }
	| { type: "policy_changed"; mode: PolicyMode; operator: string; reason: string; createdAt: string }
	| { type: "isolation_changed"; isolation: IsolationState; createdAt: string }
	| { type: "autonomous_authorized"; authorization: AutonomousAuthorization; createdAt: string }
	| { type: "scope_set"; scope: SecurityScope; createdAt: string }
	| { type: "evidence_added"; evidence: SecurityEvidence; createdAt: string }
	| { type: "evidence_linked"; edge: SecurityEvidenceEdge; createdAt: string }
	| { type: "hypothesis_added"; hypothesis: string; createdAt: string }
	| { type: "hypothesis_rejected"; hypothesis: string; createdAt: string }
	| { type: "hypothesis_recorded"; hypothesis: SecurityHypothesisRecord; createdAt: string }
	| { type: "hypothesis_verified"; verification: SecurityVerificationRecord; createdAt: string }
	| { type: "finding_added"; finding: SecurityFinding; createdAt: string }
	| { type: "decision_recorded"; decision: SecurityDecision; createdAt: string }
	| {
			type: "decision_completed";
			decisionId: string;
			actualResult: string;
			status: "succeeded" | "failed" | "contradicted";
			createdAt: string;
	  }
	| { type: "replan_recorded"; replan: SecurityReplanRecord; createdAt: string }
	| { type: "observer_signal"; signal: SecurityObserverSignal; createdAt: string }
	| { type: "delegation_recorded"; delegation: SecurityDelegationRecord; createdAt: string }
	| { type: "budget_configured"; limits: SecurityBudgetLimits; createdAt: string }
	| { type: "budget_consumed"; resource: "decision" | "tool-call" | "replan"; amount: number; createdAt: string }
	| { type: "ctf_profiled"; profile: CtfChallengeProfile; createdAt: string };

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
	decisionId?: string;
	createdAt: string;
	completedAt?: string;
	risk: RiskAssessment;
	scope: ScopeAssessment;
	policyMode: PolicyMode;
	policyDecision: "allow" | "confirm" | "deny" | "warn";
	userApproved?: boolean;
	blocked: boolean;
	blockReason?: string;
	warnings?: string[];
	isError?: boolean;
	inputSummary: string;
	resultSummary?: string;
}
