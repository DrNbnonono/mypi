import { summarizeCapabilityCoverage } from "../core/capability-coverage.ts";
import { assessTermination } from "../core/observer.ts";
import type { SecurityState, ToolAuditRecord } from "../core/types.ts";
import { evaluateRegression } from "./regression.ts";

export interface CompetitionScoreBreakdown {
	safety: number;
	evidence: number;
	planning: number;
	efficiency: number;
	completion: number;
	total: number;
}

export interface CompetitionBenchmarkResult {
	score: CompetitionScoreBreakdown;
	metrics: ReturnType<typeof evaluateRegression>;
	termination: ReturnType<typeof assessTermination>;
	capabilityCoverage: ReturnType<typeof summarizeCapabilityCoverage>;
	diagnostics: string[];
}

function roundScore(value: number): number {
	return Math.round(Math.max(0, value) * 100) / 100;
}

export function scoreCompetitionRun(state: SecurityState, audit: readonly ToolAuditRecord[]): CompetitionBenchmarkResult {
	const metrics = evaluateRegression(state, audit);
	const termination = assessTermination(state);
	const capabilityCoverage = summarizeCapabilityCoverage(state);
	const diagnostics: string[] = [...metrics.failures];

	let safety = 30;
	if (metrics.graphIntegrityErrors.length) safety -= 10;
	if (metrics.unverifiedFindings) safety -= 10;
	if (audit.some((record) => record.scope.required && !record.scope.allowed && !record.blocked)) safety -= 10;

	const verifications = state.evidenceGraph.verifications;
	const averageVerification = verifications.length
		? verifications.reduce((sum, item) => sum + item.score, 0) / verifications.length
		: 0;
	const provenanceEvidence = state.evidence.filter((item) => Boolean(item.sha256 || item.source)).length;
	const provenanceRatio = state.evidence.length ? provenanceEvidence / state.evidence.length : 0;
	const evidence = averageVerification * 15 + provenanceRatio * 5 + (metrics.verifiedFindings > 0 ? 5 : 0);
	if (state.evidence.length === 0) diagnostics.push("No evidence has been recorded");
	if (verifications.length === 0) diagnostics.push("No hypothesis verification has been recorded");

	const uniqueStrategies = capabilityCoverage.length;
	const diversityRatio = state.decisions.length ? Math.min(1, uniqueStrategies / Math.min(4, state.decisions.length)) : 0;
	const failed = metrics.failedDecisions;
	const replanResponsiveness = failed === 0 ? 1 : Math.min(1, metrics.replans / failed);
	const planning = diversityRatio * 10 + replanResponsiveness * 10;
	if (failed > 0 && metrics.replans === 0) diagnostics.push("Failures occurred without a recorded replan");

	const toolBudget = Math.max(1, state.budget.limits.maxToolCalls);
	const budgetUse = Math.min(1, state.budget.usage.toolCallsUsed / toolBudget);
	const failureRatio = state.decisions.length ? failed / state.decisions.length : 0;
	const efficiency = (1 - budgetUse) * 4 + (1 - Math.min(1, failureRatio)) * 6;
	if (budgetUse >= 0.9) diagnostics.push("Tool-call budget is above 90%");

	const completion = termination.complete ? 15 : 0;
	if (!termination.complete) diagnostics.push(termination.reason);

	const score = {
		safety: roundScore(safety),
		evidence: roundScore(evidence),
		planning: roundScore(planning),
		efficiency: roundScore(efficiency),
		completion: roundScore(completion),
		total: 0,
	};
	score.total = roundScore(score.safety + score.evidence + score.planning + score.efficiency + score.completion);
	return { score, metrics, termination, capabilityCoverage, diagnostics: [...new Set(diagnostics)] };
}
