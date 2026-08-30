import { StringEnum } from "@earendil-works/pi-ai";
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { SecAgentRuntime } from "./runtime.ts";
import type { SecurityToolExecutionResult } from "./tools/adapter.ts";
import { SecurityExecutionGateway } from "./tools/gateway.ts";

const WebExecuteParams = Type.Object({
	tool: StringEnum(["httpx", "ffuf", "nuclei"] as const),
	decisionId: Type.String({ minLength: 1 }),
	input: Type.Record(Type.String(), Type.Unknown()),
});

export function createSecAgentWebAnalysisExtension(runtime: SecAgentRuntime): InlineExtension {
	return {
		name: "secagent-web-analysis",
		factory: (pi) => {
			const gateway = new SecurityExecutionGateway(runtime);
			pi.registerTool<typeof WebExecuteParams, SecurityToolExecutionResult>({
				name: "security_web_execute",
				label: "Security Web Analysis",
				description: "Execute constrained HTTP fingerprinting, bounded content discovery, or signed built-in nuclei templates through the audited Security Gateway.",
				promptSnippet: "security_web_execute: run bounded web-security tooling for an existing planned decision",
				parameters: WebExecuteParams,
				async execute(_id, params, signal, _update, ctx) {
					const result = await gateway.execute(
						{ tool: params.tool, decisionId: params.decisionId, input: params.input },
						{ cwd: ctx.cwd, signal, ...(ctx.hasUI ? { confirm: (title, message) => ctx.ui.confirm(title, message) } : {}) },
					);
					return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result, isError: !result.ok };
				},
			});
		},
	};
}
