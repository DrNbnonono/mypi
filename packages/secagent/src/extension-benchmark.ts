import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { defineSecAgentExtension, type SecAgentInlineExtension } from "./host-contract.ts";
import type { SecAgentRuntime } from "./runtime.ts";
import { scoreCompetitionRun } from "./scenarios/benchmark.ts";
import {
	CONTROLLED_AUTONOMY_BENCHMARKS,
	type ControlledScenarioEvaluation,
	controlledBenchmarkDefinition,
	evaluateControlledScenario,
} from "./scenarios/controlled.ts";
import { type ControlledScenarioHarnessResult, runControlledScenarioBenchmark } from "./scenarios/harness.ts";

const BenchmarkParams = Type.Object({
	action: StringEnum(["inspect", "catalog", "controlled", "run-controlled"] as const),
	scenario: Type.Optional(StringEnum(["web", "pwn", "reverse", "forensics", "killchain"] as const)),
	maxSteps: Type.Optional(Type.Number({ minimum: 1, maximum: 50 })),
	injectFailure: Type.Optional(Type.Boolean()),
});

type BenchmarkDetails =
	| ReturnType<typeof scoreCompetitionRun>
	| ControlledScenarioEvaluation
	| ControlledScenarioHarnessResult
	| typeof CONTROLLED_AUTONOMY_BENCHMARKS;

export function createSecAgentBenchmarkExtension(runtime: SecAgentRuntime): SecAgentInlineExtension {
	return defineSecAgentExtension("secagent-benchmark", (pi) => {
		pi.registerTool<typeof BenchmarkParams, BenchmarkDetails>({
			name: "security_benchmark",
			label: "Security Benchmark",
			description:
				"Score the current run, evaluate its trace, or execute an isolated deterministic Web/Pwn/Reverse/Forensics/Killchain harness through the real SecAgent loop, gateway, policy, scope and adapters. Project self-evaluation only; not an official competition score.",
			promptSnippet:
				"security_benchmark: measure competition readiness with trace evaluation or isolated end-to-end controlled scenarios",
			parameters: BenchmarkParams,
			async execute(_id, params) {
				if (params.action === "catalog") {
					return {
						content: [{ type: "text", text: JSON.stringify(CONTROLLED_AUTONOMY_BENCHMARKS, null, 2) }],
						details: CONTROLLED_AUTONOMY_BENCHMARKS,
					};
				}
				if (params.action === "run-controlled") {
					if (!params.scenario) {
						return {
							content: [{ type: "text", text: "scenario is required for run-controlled" }],
							details: CONTROLLED_AUTONOMY_BENCHMARKS,
							isError: true,
						};
					}
					const result = await runControlledScenarioBenchmark(params.scenario, {
						maxSteps: params.maxSteps,
						injectFailure: params.injectFailure,
					});
					return {
						content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
						details: result,
						isError: !result.evaluation.passed,
					};
				}
				if (params.action === "controlled") {
					if (!params.scenario) {
						return {
							content: [{ type: "text", text: "scenario is required for controlled evaluation" }],
							details: CONTROLLED_AUTONOMY_BENCHMARKS,
							isError: true,
						};
					}
					const result = evaluateControlledScenario(
						controlledBenchmarkDefinition(params.scenario),
						runtime.snapshot().state,
						runtime.readAudit(),
					);
					return {
						content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
						details: result,
						isError: !result.passed,
					};
				}
				const result = scoreCompetitionRun(runtime.snapshot().state, runtime.readAudit());
				return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
			},
		});
	});
}
