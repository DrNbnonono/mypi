import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { type AutonomousRunResult, AutonomousSearchLoop, type AutonomousStepResult } from "./core/autonomous-loop.ts";
import { defineSecAgentExtension, type SecAgentInlineExtension } from "./host-contract.ts";
import type { SecAgentRuntime } from "./runtime.ts";
import { SecurityExecutionGateway } from "./tools/gateway.ts";

const AutonomousParams = Type.Object({
	action: StringEnum(["step", "run", "inspect"] as const),
	maxSteps: Type.Optional(Type.Number({ minimum: 1, maximum: 50 })),
	stopOnExecutionFailure: Type.Optional(Type.Boolean()),
});

type AutonomousDetails = AutonomousRunResult | AutonomousStepResult | ReturnType<SecAgentRuntime["snapshot"]>;

export function createSecAgentAutonomousExtension(runtime: SecAgentRuntime): SecAgentInlineExtension {
	return defineSecAgentExtension("secagent-autonomous", (pi) => {
		const loop = new AutonomousSearchLoop(runtime, new SecurityExecutionGateway(runtime));
		pi.on("before_agent_start", async (event) => ({
			systemPrompt: `${event.systemPrompt}\n\nSecAgent autonomous loop: use security_autonomous when bounded execution should continue across candidate generation, planning, gateway execution, evidence capture, observer supervision, verification, and replanning. Out-of-scope execution is permitted only after autonomous isolation and authorization prerequisites and must remain a high-risk audited warning. The loop never bypasses protected paths, isolation, audit, or deterministic adapter inputs.`,
		}));
		pi.registerTool<typeof AutonomousParams, AutonomousDetails>({
			name: "security_autonomous",
			label: "Security Autonomous Loop",
			description:
				"Execute one or more bounded state-space search steps through Candidate Generator -> Planner -> Gateway -> Evidence -> Observer/Verifier -> Replanner.",
			promptSnippet: "security_autonomous: run the bounded SecAgent search loop",
			parameters: AutonomousParams,
			async execute(_id, params, signal, _update, ctx) {
				if (params.action === "inspect") {
					const snapshot = runtime.snapshot();
					return { content: [{ type: "text", text: JSON.stringify(snapshot, null, 2) }], details: snapshot };
				}
				const gatewayContext = {
					cwd: ctx.cwd,
					signal,
					...(ctx.hasUI ? { confirm: (title: string, message: string) => ctx.ui.confirm(title, message) } : {}),
				};
				const result =
					params.action === "step"
						? await loop.step(gatewayContext)
						: await loop.run(gatewayContext, {
								maxSteps: params.maxSteps,
								stopOnExecutionFailure: params.stopOnExecutionFailure,
							});
				const failed = "status" in result && (result.status === "blocked" || result.status === "failed");
				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
					details: result,
					isError: failed,
				};
			},
		});
	});
}
