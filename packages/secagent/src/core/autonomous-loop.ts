import { randomUUID } from "node:crypto";
import type { SecAgentRuntime } from "../runtime.ts";
import type { SecurityExecutionGateway, SecurityGatewayContext } from "../tools/gateway.ts";
import { buildDefaultActionInput } from "./action-input.ts";
import { runAutomaticVerification } from "./auto-verifier.ts";
import { assessBudget } from "./budget.ts";
import { generateCandidateActions } from "./candidate-generator.ts";
import { assessTermination, observeSecurityState } from "./observer.ts";
import { assessReplanNeed, createReplanRecord, rankCandidates } from "./planner.ts";
import type { SecurityDecision, SecurityObserverSignal, SecurityStage } from "./types.ts";

export type AutonomousStepStatus = "executed" | "complete" | "blocked" | "no-candidate";

export interface AutonomousStepResult {
	status: AutonomousStepStatus;
	reason: string;
	decision?: SecurityDecision;
	selectedTool?: string;
	executionOk?: boolean;
	verificationIds: string[];
	observerSignals: SecurityObserverSignal[];
	termination: ReturnType<typeof assessTermination>;
	candidateGaps: string[];
}

export interface AutonomousRunOptions {
	maxSteps?: number;
	stopOnExecutionFailure?: boolean;
}

export interface AutonomousRunResult {
	status: "complete" | "blocked" | "exhausted" | "no-candidate" | "failed";
	reason: string;
	steps: AutonomousStepResult[];
	finalTermination: ReturnType<typeof assessTermination>;
}

function desiredStage(runtime: SecAgentRuntime): SecurityStage | undefined {
	const state = runtime.snapshot().state;
	if (!state.task) return undefined;
	if (state.stage === "understanding") return "planning";
	if (state.stage === "planning") {
		return state.task.scenario === "incident-response" || state.task.scenario === "reverse-engineering"
			? "analysis"
			: "recon";
	}
	if (
		state.stage === "recon" &&
		state.decisions.some((decision) => decision.stage === "recon" && decision.resultStatus === "succeeded")
	)
		return "analysis";
	if (
		state.stage === "analysis" &&
		state.evidenceGraph.hypotheses.some((hypothesis) => hypothesis.status === "active")
	)
		return "verification";
	if (state.stage === "verification" && assessTermination(state).complete) return "report";
	return undefined;
}

function appendObserverSignals(runtime: SecAgentRuntime): SecurityObserverSignal[] {
	const state = runtime.snapshot().state;
	const existing = new Set(state.observerSignals.map((item) => `${item.kind}:${item.reason}`));
	const appended: SecurityObserverSignal[] = [];
	for (const signal of observeSecurityState(state)) {
		if (existing.has(`${signal.kind}:${signal.reason}`)) continue;
		runtime.append({ type: "observer_signal", signal, createdAt: signal.createdAt });
		appended.push(signal);
	}
	return appended;
}

function hasPendingDecision(runtime: SecAgentRuntime): boolean {
	return runtime.snapshot().state.decisions.some((decision) => decision.resultStatus === "pending");
}

export class AutonomousSearchLoop {
	private readonly runtime: SecAgentRuntime;
	private readonly gateway: SecurityExecutionGateway;

	constructor(runtime: SecAgentRuntime, gateway: SecurityExecutionGateway) {
		this.runtime = runtime;
		this.gateway = gateway;
	}

	async step(context: SecurityGatewayContext): Promise<AutonomousStepResult> {
		const initial = this.runtime.snapshot().state;
		const initialTermination = assessTermination(initial);
		if (initialTermination.complete) {
			return {
				status: "complete",
				reason: initialTermination.reason,
				verificationIds: [],
				observerSignals: [],
				termination: initialTermination,
				candidateGaps: [],
			};
		}
		if (!initial.task) {
			return {
				status: "blocked",
				reason: "security_intake must start a task before autonomous execution",
				verificationIds: [],
				observerSignals: [],
				termination: initialTermination,
				candidateGaps: [],
			};
		}
		if (hasPendingDecision(this.runtime)) {
			return {
				status: "blocked",
				reason: "a pending decision already exists; resolve it before starting another autonomous step",
				verificationIds: [],
				observerSignals: [],
				termination: initialTermination,
				candidateGaps: [],
			};
		}

		const nextStage = desiredStage(this.runtime);
		if (nextStage && nextStage !== this.runtime.snapshot().state.stage)
			this.runtime.append({ type: "stage_changed", stage: nextStage, createdAt: new Date().toISOString() });

		const preVerification = runAutomaticVerification(this.runtime);
		const preSignals = appendObserverSignals(this.runtime);
		const state = this.runtime.snapshot().state;
		const decisionBudget = assessBudget(state.budget, "decision");
		if (!decisionBudget.allowed) {
			const termination = assessTermination(state);
			return {
				status: "blocked",
				reason: decisionBudget.reason ?? "decision budget exhausted",
				verificationIds: preVerification.map((item) => item.id),
				observerSignals: preSignals,
				termination,
				candidateGaps: [],
			};
		}

		const generated = generateCandidateActions(state);
		if (generated.candidates.length === 0) {
			const termination = assessTermination(state);
			return {
				status: "no-candidate",
				reason: generated.gaps.join("; ") || "no runnable candidate is available for the current state",
				verificationIds: preVerification.map((item) => item.id),
				observerSignals: preSignals,
				termination,
				candidateGaps: generated.gaps,
			};
		}

		const replanAssessment = assessReplanNeed(state);
		let replanId: string | undefined;
		if (replanAssessment.required) {
			const replanBudget = assessBudget(state.budget, "replan");
			if (!replanBudget.allowed) {
				const termination = assessTermination(state);
				return {
					status: "blocked",
					reason: replanBudget.reason ?? "replan budget exhausted",
					verificationIds: preVerification.map((item) => item.id),
					observerSignals: preSignals,
					termination,
					candidateGaps: generated.gaps,
				};
			}
			const replan = createReplanRecord(replanAssessment);
			if (replan) {
				replanId = replan.id;
				this.runtime.append({ type: "replan_recorded", replan, createdAt: replan.createdAt });
				this.runtime.append({
					type: "budget_consumed",
					resource: "replan",
					amount: 1,
					createdAt: new Date().toISOString(),
				});
			}
		}

		const current = this.runtime.snapshot().state;
		const ranked = rankCandidates(generated.candidates, { state: current });
		const selected = ranked[0];
		if (!selected) {
			const termination = assessTermination(current);
			return {
				status: "no-candidate",
				reason: "candidate ranking produced no action",
				verificationIds: preVerification.map((item) => item.id),
				observerSignals: preSignals,
				termination,
				candidateGaps: generated.gaps,
			};
		}
		const defaultInput = buildDefaultActionInput(current, selected);
		if (!defaultInput.ok || !defaultInput.input) {
			const termination = assessTermination(current);
			return {
				status: "no-candidate",
				reason: defaultInput.reason ?? `no deterministic input for ${selected.tool}`,
				verificationIds: preVerification.map((item) => item.id),
				observerSignals: preSignals,
				termination,
				candidateGaps: [...generated.gaps, defaultInput.reason ?? "input construction failed"],
			};
		}

		const decision: SecurityDecision = {
			id: randomUUID(),
			createdAt: new Date().toISOString(),
			goal: current.goal,
			stage: current.stage,
			evidenceIds: current.evidence.slice(-12).map((item) => item.id),
			candidates: ranked,
			selectedActionId: selected.id,
			rationale: `Autonomous state-space selection: strategy=${selected.capability ?? selected.tool}; utility=${selected.score.toFixed(4)}`,
			expectedResult: selected.expectedEvidence?.join("; "),
			resultStatus: "pending",
			planRevision: current.decisions.length + 1,
			attempt: current.decisions.filter((item) => item.goal === current.goal).length + 1,
			replanId,
			budgetSnapshot: structuredClone(current.budget),
		};
		this.runtime.append({ type: "decision_recorded", decision, createdAt: decision.createdAt });
		this.runtime.append({
			type: "budget_consumed",
			resource: "decision",
			amount: 1,
			createdAt: new Date().toISOString(),
		});

		const execution = await this.gateway.execute(
			{ tool: selected.tool, input: defaultInput.input, decisionId: decision.id },
			context,
		);
		const verification = runAutomaticVerification(this.runtime);
		const observerSignals = [...preSignals, ...appendObserverSignals(this.runtime)];
		const termination = assessTermination(this.runtime.snapshot().state);
		return {
			status: termination.complete ? "complete" : "executed",
			reason: termination.complete
				? termination.reason
				: execution.ok
					? `Executed ${selected.tool}`
					: (execution.diagnostic?.message ?? `${selected.tool} failed`),
			decision: this.runtime.snapshot().state.decisions.find((item) => item.id === decision.id),
			selectedTool: selected.tool,
			executionOk: execution.ok,
			verificationIds: [...preVerification, ...verification].map((item) => item.id),
			observerSignals,
			termination,
			candidateGaps: generated.gaps,
		};
	}

	async run(context: SecurityGatewayContext, options: AutonomousRunOptions = {}): Promise<AutonomousRunResult> {
		const maxSteps = Math.max(1, Math.min(50, Math.trunc(options.maxSteps ?? 8)));
		const steps: AutonomousStepResult[] = [];
		for (let index = 0; index < maxSteps; index += 1) {
			const step = await this.step(context);
			steps.push(step);
			if (step.status === "complete")
				return { status: "complete", reason: step.reason, steps, finalTermination: step.termination };
			if (step.status === "blocked")
				return { status: "blocked", reason: step.reason, steps, finalTermination: step.termination };
			if (step.status === "no-candidate")
				return { status: "no-candidate", reason: step.reason, steps, finalTermination: step.termination };
			if (options.stopOnExecutionFailure && step.executionOk === false)
				return { status: "failed", reason: step.reason, steps, finalTermination: step.termination };
		}
		const finalTermination = assessTermination(this.runtime.snapshot().state);
		return {
			status: finalTermination.complete ? "complete" : "exhausted",
			reason: finalTermination.complete ? finalTermination.reason : `Reached autonomous step limit ${maxSteps}`,
			steps,
			finalTermination,
		};
	}
}
