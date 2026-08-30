import { StringEnum } from "@earendil-works/pi-ai";
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { SecAgentRuntime } from "./runtime.ts";
import { scoreCompetitionRun } from "./scenarios/benchmark.ts";
import {
	CONTROLLED_AUTONOMY_BENCHMARKS,
	controlledBenchmarkDefinition,
	evaluateControlledScenario,
	type ControlledScenarioEvaluation,
} from "./scenarios/controlled.ts";

const BenchmarkParams = Type.Object({
	action: StringEnum(["inspect", "catalog", "controlled"] as const),
	scenario: Type.Optional(StringEnum(["web", "pwn", "reverse", "forensics", "killchain"] as const)),
});

type BenchmarkDetails = ReturnType<typeof scoreCompetitionRun> | ControlledScenarioEvaluation | typeof CONTROLLED_AUTONOMY_BENCHMARKS;

export function createSecAgentBenchmarkExtension(runtime: SecAgentRuntime): InlineExtension {
	return {
		name: "secagent-benchmark",
		factory: (pi) => {
			pi.registerTool<typeof BenchmarkParams, BenchmarkDetails>({
				name: "security_benchmark",
				label: "Security Benchmark",
				description: "Score the current run or evaluate it against the controlled Web/Pwn/Reverse/Forensics/Killchain scenario matrix. These are project self-evaluations, not official competition scores.",
				promptSnippet: "security_benchmark: inspect deterministic competition-readiness and controlled scenario invariants",
				parameters: BenchmarkParams,
				async execute(_id, params) {
					if (params.action === "catalog") {
						return { content: [{ type: "text", text: JSON.stringify(CONTROLLED_AUTONOMY_BENCHMARKS, null, 2) }], details: CONTROLLED_AUTONOMY_BENCHMARKS };
					}
					if (params.action === "controlled") {
						if (!params.scenario) {
							return { content: [{ type: "text", text: "scenario is required for controlled evaluation" }], details: CONTROLLED_AUTONOMY_BENCHMARKS, isError: true };
						}
						const result = evaluateControlledScenario(
							controlledBenchmarkDefinition(params.scenario),
							runtime.snapshot().state,
							runtime.readAudit(),
						);
						return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result, isError: !result.passed };
					}
					const result = scoreCompetitionRun(runtime.snapshot().state, runtime.readAudit());
					return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
				},
			});
		},
	};
}
