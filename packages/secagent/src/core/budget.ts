import type { SecurityBudgetLimits, SecurityBudgetState } from "./types.ts";

export const DEFAULT_SECURITY_BUDGET: SecurityBudgetState = {
	limits: { maxDecisions: 40, maxToolCalls: 120, maxReplans: 12 },
	usage: { decisionsUsed: 0, toolCallsUsed: 0, replansUsed: 0 },
};

export type BudgetResource = "decision" | "tool-call" | "replan";

export interface BudgetAssessment {
	allowed: boolean;
	pressure: number;
	reason?: string;
}

function ratio(used: number, limit: number): number {
	if (!Number.isFinite(limit) || limit <= 0) return 1;
	return Math.max(0, Math.min(1, used / limit));
}

export function budgetPressure(budget: SecurityBudgetState): number {
	const values = [
		ratio(budget.usage.decisionsUsed, budget.limits.maxDecisions),
		ratio(budget.usage.toolCallsUsed, budget.limits.maxToolCalls),
		ratio(budget.usage.replansUsed, budget.limits.maxReplans),
	];
	if (budget.limits.deadlineAt) {
		const remaining = Date.parse(budget.limits.deadlineAt) - Date.now();
		if (remaining <= 0) return 1;
		if (remaining < 60_000) values.push(0.95);
		else if (remaining < 5 * 60_000) values.push(0.8);
	}
	return Math.max(...values);
}

export function assessBudget(budget: SecurityBudgetState, resource: BudgetResource, amount = 1): BudgetAssessment {
	if (budget.limits.deadlineAt && Date.now() >= Date.parse(budget.limits.deadlineAt))
		return { allowed: false, pressure: 1, reason: `Budget deadline ${budget.limits.deadlineAt} has expired` };
	const [used, limit] =
		resource === "decision"
			? [budget.usage.decisionsUsed, budget.limits.maxDecisions]
			: resource === "tool-call"
				? [budget.usage.toolCallsUsed, budget.limits.maxToolCalls]
				: [budget.usage.replansUsed, budget.limits.maxReplans];
	if (used + amount > limit)
		return { allowed: false, pressure: 1, reason: `${resource} budget exhausted (${used}/${limit})` };
	return { allowed: true, pressure: budgetPressure(budget) };
}

export function normalizeBudgetLimits(limits: Partial<SecurityBudgetLimits>): SecurityBudgetLimits {
	const normalize = (value: number | undefined, fallback: number): number =>
		value === undefined || !Number.isFinite(value) ? fallback : Math.max(1, Math.trunc(value));
	return {
		maxDecisions: normalize(limits.maxDecisions, DEFAULT_SECURITY_BUDGET.limits.maxDecisions),
		maxToolCalls: normalize(limits.maxToolCalls, DEFAULT_SECURITY_BUDGET.limits.maxToolCalls),
		maxReplans: normalize(limits.maxReplans, DEFAULT_SECURITY_BUDGET.limits.maxReplans),
		deadlineAt: limits.deadlineAt,
	};
}
