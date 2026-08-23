import type { RiskLevel, SecurityToolMetadata, ToolResolution } from "../core/types.ts";
import { SECURITY_TOOL_CATALOG } from "./catalog.ts";

const RISK_RANK: Record<RiskLevel, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
const RISK_SCORE: Record<RiskLevel, number> = { P0: 0.05, P1: 0.3, P2: 0.65, P3: 1 };

const metadataByName = new Map<string, SecurityToolMetadata>();
for (const metadata of SECURITY_TOOL_CATALOG) {
	metadataByName.set(metadata.name.toLowerCase(), metadata);
	for (const alias of metadata.aliases) metadataByName.set(alias.toLowerCase(), metadata);
}

const SHELL_PREFIX_COMMANDS = new Set(["command", "env", "nice", "nohup", "sudo", "time", "timeout"]);

export function riskLevelRank(level: RiskLevel): number {
	return RISK_RANK[level];
}

export function riskLevelToScore(level: RiskLevel): number {
	return RISK_SCORE[level];
}

export function maxRiskLevel(left: RiskLevel, right: RiskLevel): RiskLevel {
	return riskLevelRank(left) >= riskLevelRank(right) ? left : right;
}

export function getSecurityToolMetadata(name: string): SecurityToolMetadata | undefined {
	return metadataByName.get(name.trim().toLowerCase());
}

export function listSecurityToolMetadata(): SecurityToolMetadata[] {
	return SECURITY_TOOL_CATALOG.map((metadata) => ({
		...metadata,
		aliases: [...metadata.aliases],
		capabilities: [...metadata.capabilities],
		preconditions: [...metadata.preconditions],
		postconditions: [...metadata.postconditions],
		recommendedAgents: [...metadata.recommendedAgents],
	}));
}

function tokenizeShellSegment(segment: string): string[] {
	return segment
		.trim()
		.split(/\s+/)
		.map((token) => token.replace(/^["']|["']$/g, ""))
		.filter(Boolean);
}

function executableFromSegment(segment: string): string | undefined {
	const tokens = tokenizeShellSegment(segment);
	let index = 0;
	while (index < tokens.length) {
		const token = tokens[index];
		if (!token) return undefined;
		if (/^[A-Za-z_][A-Za-z0-9_]*=.*/.test(token)) {
			index += 1;
			continue;
		}
		if (SHELL_PREFIX_COMMANDS.has(token.toLowerCase())) {
			index += 1;
			if (token.toLowerCase() === "timeout" && tokens[index] && /^\d/.test(tokens[index] ?? "")) index += 1;
			continue;
		}
		return token.split("/").pop()?.toLowerCase();
	}
	return undefined;
}

export function extractShellExecutables(command: string): string[] {
	const executables = command
		.split(/(?:&&|\|\||;|\||\n)/)
		.map(executableFromSegment)
		.filter((name): name is string => Boolean(name));
	return [...new Set(executables)];
}

export function resolveToolCall(toolName: string, input: Record<string, unknown>): ToolResolution {
	if (toolName !== "bash") {
		const metadata = getSecurityToolMetadata(toolName);
		if (!metadata) {
			return {
				known: false,
				resolvedTools: [toolName],
				capabilities: [],
				baseRisk: "P1",
				requiresScope: false,
				reasons: ["tool is not present in the SecAgent registry; conservative P1 fallback"],
			};
		}
		return {
			known: true,
			resolvedTools: [metadata.name],
			capabilities: [...metadata.capabilities],
			baseRisk: metadata.baseRisk,
			requiresScope: metadata.scopeMode === "network-target",
			reasons: [`registry metadata: ${metadata.name} ${metadata.baseRisk}`],
		};
	}

	const command = typeof input.command === "string" ? input.command : "";
	const executables = extractShellExecutables(command);
	const nested = executables
		.map((name) => getSecurityToolMetadata(name))
		.filter((metadata): metadata is SecurityToolMetadata => Boolean(metadata));
	const resolvedTools = nested.length > 0 ? [...new Set(nested.map((metadata) => metadata.name))] : ["bash"];
	const capabilities = [...new Set(["process.execute", ...nested.flatMap((metadata) => metadata.capabilities)])];
	let baseRisk: RiskLevel = "P1";
	for (const metadata of nested) baseRisk = maxRiskLevel(baseRisk, metadata.baseRisk);
	const requiresScope = nested.some((metadata) => metadata.scopeMode === "network-target");
	return {
		known: nested.length === executables.length && executables.length > 0,
		resolvedTools,
		capabilities,
		baseRisk,
		requiresScope,
		reasons:
			nested.length > 0
				? [`shell resolved through registry: ${resolvedTools.join(", ")}`]
				: ["shell command has no registry-specific nested executable; bash P1 fallback"],
	};
}

export function planningRiskForTool(toolName: string, riskHint?: number): number {
	const metadata = getSecurityToolMetadata(toolName);
	const floor = riskLevelToScore(metadata?.baseRisk ?? "P1");
	if (riskHint === undefined || !Number.isFinite(riskHint)) return floor;
	return Math.max(floor, Math.max(0, Math.min(1, riskHint)));
}
