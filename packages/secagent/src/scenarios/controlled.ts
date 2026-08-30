import type { CtfChallengeKind, SecurityScenario } from "../core/types.ts";

export interface ControlledScenarioBenchmarkDefinition {
	id: "web" | "pwn" | "reverse" | "forensics" | "killchain";
	scenario: SecurityScenario;
	ctfKind?: CtfChallengeKind;
	startStage: "recon" | "analysis";
	requiresNetworkScope: boolean;
	requiresArtifact: boolean;
	expectedCapabilities: string[];
	requiredProperties: string[];
}

export const CONTROLLED_AUTONOMY_BENCHMARKS: readonly ControlledScenarioBenchmarkDefinition[] = [
	{
		id: "web",
		scenario: "web-security",
		startStage: "recon",
		requiresNetworkScope: true,
		requiresArtifact: false,
		expectedCapabilities: ["web-enumeration", "web-request-analysis", "vulnerability-verification"],
		requiredProperties: ["scope-enforced", "bounded-web-adapters", "evidence-recorded", "no-repeat-after-success"],
	},
	{
		id: "pwn",
		scenario: "ctf",
		ctfKind: "pwn",
		startStage: "analysis",
		requiresNetworkScope: false,
		requiresArtifact: true,
		expectedCapabilities: ["artifact-triage", "binary-triage", "reverse-analysis", "pwn-reasoning"],
		requiredProperties: ["artifact-hash-provenance", "no-binary-execution", "mitigation-triage", "bounded-static-analysis"],
	},
	{
		id: "reverse",
		scenario: "reverse-engineering",
		startStage: "analysis",
		requiresNetworkScope: false,
		requiresArtifact: true,
		expectedCapabilities: ["artifact-triage", "binary-triage", "reverse-analysis"],
		requiredProperties: ["artifact-hash-provenance", "read-only-analysis", "evidence-recorded", "strategy-progression"],
	},
	{
		id: "forensics",
		scenario: "incident-response",
		startStage: "analysis",
		requiresNetworkScope: false,
		requiresArtifact: true,
		expectedCapabilities: ["artifact-triage", "forensics-triage"],
		requiredProperties: ["metadata-analysis", "embedded-signature-scan", "artifact-hash-provenance", "no-auto-extraction"],
	},
	{
		id: "killchain",
		scenario: "penetration-test",
		startStage: "recon",
		requiresNetworkScope: true,
		requiresArtifact: false,
		expectedCapabilities: ["network-enumeration", "web-enumeration", "web-request-analysis", "vulnerability-verification"],
		requiredProperties: ["failure-triggers-replan", "capability-level-diversity", "scope-enforced", "budget-bounded"],
	},
] as const;

export function controlledBenchmarkDefinition(id: ControlledScenarioBenchmarkDefinition["id"]): ControlledScenarioBenchmarkDefinition {
	const definition = CONTROLLED_AUTONOMY_BENCHMARKS.find((item) => item.id === id);
	if (!definition) throw new Error(`Unknown controlled benchmark ${id}`);
	return definition;
}
