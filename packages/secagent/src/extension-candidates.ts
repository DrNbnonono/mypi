import { StringEnum } from "@earendil-works/pi-ai";
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { generateCandidateActions, type GeneratedCandidateSet } from "./core/candidate-generator.ts";
import type { SecAgentRuntime } from "./runtime.ts";

const CandidateGenerationParams = Type.Object({ action: StringEnum(["generate"] as const) });

export function createSecAgentCandidateExtension(runtime: SecAgentRuntime): InlineExtension {
	return {
		name: "secagent-candidates",
		factory: (pi) => {
			pi.on("before_agent_start", async (event) => ({
				systemPrompt: `${event.systemPrompt}\n\nSecAgent candidate rule: when the next action space is unclear, use security_candidates to obtain deterministic runnable strategy candidates derived from scenario, stage, scope, artifact availability, and the audited adapter registry. Treat those candidates as a baseline; security_plan remains the authority that ranks alternatives and records replanning.`,
			}));
			pi.registerTool<typeof CandidateGenerationParams, GeneratedCandidateSet>({
				name: "security_candidates",
				label: "Security Candidates",
				description: "Generate deterministic runnable action candidates from SecAgent state instead of relying only on model-self-reported alternatives.",
				promptSnippet: "security_candidates: derive runnable state-aware action alternatives",
				parameters: CandidateGenerationParams,
				async execute() {
					const generated = generateCandidateActions(runtime.snapshot().state);
					return { content: [{ type: "text", text: JSON.stringify(generated, null, 2) }], details: generated };
				},
			});
		},
	};
}
