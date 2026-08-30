import { StringEnum } from "@earendil-works/pi-ai";
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { SecAgentRuntime } from "./runtime.ts";
import type { SecurityToolExecutionResult } from "./tools/adapter.ts";
import { SecurityExecutionGateway } from "./tools/gateway.ts";

const StaticExecuteParams = Type.Object({
	tool: StringEnum(["readelf", "objdump", "binwalk", "exiftool"] as const),
	decisionId: Type.String({ minLength: 1 }),
	input: Type.Record(Type.String(), Type.Unknown()),
});

export function createSecAgentStaticAnalysisExtension(runtime: SecAgentRuntime): InlineExtension {
	return {
		name: "secagent-static-analysis",
		factory: (pi) => {
			const gateway = new SecurityExecutionGateway(runtime);
			pi.registerTool<typeof StaticExecuteParams, SecurityToolExecutionResult>({
				name: "security_static_execute",
				label: "Security Static Analysis",
				description: "Execute constrained read-only binary or forensic artifact analysis through the same decision, policy, evidence, and audit gateway.",
				promptSnippet: "security_static_execute: run bounded read-only artifact analysis for an existing planned decision",
				parameters: StaticExecuteParams,
				async execute(_id, params, signal, _update, ctx) {
					const result = await gateway.execute(
						{ tool: params.tool, decisionId: params.decisionId, input: params.input },
						{ cwd: ctx.cwd, signal, ...(ctx.hasUI ? { confirm: (title, message) => ctx.ui.confirm(title, message) } : {}) },
					);
					return {
						content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
						details: result,
						isError: !result.ok,
					};
				},
			});
		},
	};
}
