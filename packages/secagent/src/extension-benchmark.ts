import { StringEnum } from "@earendil-works/pi-ai";
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { SecAgentRuntime } from "./runtime.ts";
import { scoreCompetitionRun } from "./scenarios/benchmark.ts";

const BenchmarkParams = Type.Object({ action: StringEnum(["inspect"] as const) });

export function createSecAgentBenchmarkExtension(runtime: SecAgentRuntime): InlineExtension {
	return {
		name: "secagent-benchmark",
		factory: (pi) => {
			pi.registerTool<typeof BenchmarkParams, ReturnType<typeof scoreCompetitionRun>>({
				name: "security_benchmark",
				label: "Security Benchmark",
				description: "Score the current run using deterministic SecAgent safety, evidence, planning, efficiency, and completion diagnostics. This is a project self-evaluation, not an official competition score.",
				promptSnippet: "security_benchmark: inspect deterministic competition-readiness metrics",
				parameters: BenchmarkParams,
				async execute() {
					const result = scoreCompetitionRun(runtime.snapshot().state, runtime.readAudit());
					return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
				},
			});
		},
	};
}
