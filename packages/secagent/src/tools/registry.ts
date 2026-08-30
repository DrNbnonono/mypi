import type { RiskLevel, SecurityToolMetadata, ToolResolution } from "../core/types.ts";
import { resolveMcpProxyCall } from "../integrations/mcp-policy.ts";
import type { SecurityToolAdapter } from "./adapter.ts";
import { SECURITY_TOOL_CATALOG } from "./catalog.ts";
import { createCurlAdapter } from "./curl.ts";
import { createFileAdapter, createStringsAdapter } from "./file.ts";
import { createForensicsAdapter } from "./forensics.ts";
import { createNmapAdapter } from "./nmap.ts";
import { createStaticAnalysisAdapter } from "./static-analysis.ts";
import { createWebAdapter } from "./web.ts";

const RISK_RANK: Record<RiskLevel, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
const RISK_SCORE: Record<RiskLevel, number> = { P0: 0.05, P1: 0.3, P2: 0.65, P3: 1 };
const metadataByName = new Map<string, SecurityToolMetadata>();
for (const metadata of SECURITY_TOOL_CATALOG) {
	metadataByName.set(metadata.name.toLowerCase(), metadata);
	for (const alias of metadata.aliases) metadataByName.set(alias.toLowerCase(), metadata);
}
const SHELL_PREFIX_COMMANDS = new Set(["command", "env", "nice", "nohup", "sudo", "time", "timeout"]);
const adapterByName = new Map<string, SecurityToolAdapter>();

export function riskLevelRank(level: RiskLevel): number { return RISK_RANK[level]; }
export function riskLevelToScore(level: RiskLevel): number { return RISK_SCORE[level]; }
export function maxRiskLevel(left: RiskLevel, right: RiskLevel): RiskLevel { return riskLevelRank(left) >= riskLevelRank(right) ? left : right; }
export function getSecurityToolMetadata(name: string): SecurityToolMetadata | undefined { return metadataByName.get(name.trim().toLowerCase()); }
export function listSecurityToolMetadata(): SecurityToolMetadata[] {
	return SECURITY_TOOL_CATALOG.map((metadata) => ({ ...metadata, aliases: [...metadata.aliases], capabilities: [...metadata.capabilities], preconditions: [...metadata.preconditions], postconditions: [...metadata.postconditions], recommendedAgents: [...metadata.recommendedAgents] }));
}

export function getSecurityToolAdapter(name: string): SecurityToolAdapter | undefined {
	const metadata = getSecurityToolMetadata(name);
	if (!metadata) return undefined;
	const existing = adapterByName.get(metadata.name);
	if (existing) return existing;
	const adapter = metadata.name === "curl" ? createCurlAdapter(metadata)
		: metadata.name === "nmap" ? createNmapAdapter(metadata)
		: metadata.name === "file" ? createFileAdapter(metadata)
		: metadata.name === "strings" ? createStringsAdapter(metadata)
		: metadata.name === "readelf" ? createStaticAnalysisAdapter(metadata, "readelf")
		: metadata.name === "objdump" ? createStaticAnalysisAdapter(metadata, "objdump")
		: metadata.name === "binwalk" ? createForensicsAdapter(metadata, "binwalk")
		: metadata.name === "exiftool" ? createForensicsAdapter(metadata, "exiftool")
		: metadata.name === "httpx" ? createWebAdapter(metadata, "httpx")
		: metadata.name === "ffuf" ? createWebAdapter(metadata, "ffuf")
		: metadata.name === "nuclei" ? createWebAdapter(metadata, "nuclei")
		: undefined;
	if (adapter) adapterByName.set(metadata.name, adapter);
	return adapter;
}
export function listSecurityToolAdapters(): SecurityToolAdapter[] {
	return ["nmap", "curl", "file", "strings", "readelf", "objdump", "binwalk", "exiftool", "httpx", "ffuf", "nuclei"]
		.map((name) => getSecurityToolAdapter(name)).filter((adapter): adapter is SecurityToolAdapter => Boolean(adapter));
}
function executableFromSegment(segment: string): string | undefined {
	const tokens = segment.trim().split(/\s+/).map((token) => token.replace(/^["']|["']$/g, "")).filter(Boolean);
	let index = 0;
	while (index < tokens.length) {
		const token = tokens[index];
		if (!token) return undefined;
		if (/^[A-Za-z_][A-Za-z0-9_]*=.*/.test(token)) { index += 1; continue; }
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
	return [...new Set(command.split(/(?:&&|\|\||;|\||\n)/).map(executableFromSegment).filter((name): name is string => Boolean(name)))];
}
export function resolveToolCall(toolName: string, input: Record<string, unknown>): ToolResolution {
	if (toolName === "mcp") return resolveMcpProxyCall(input);
	if (toolName !== "bash") {
		const metadata = getSecurityToolMetadata(toolName);
		if (!metadata) return { known: false, resolvedTools: [toolName], capabilities: [], baseRisk: "P2", requiresScope: false, reasons: ["tool is not present in the SecAgent registry; conservative P2 fallback"] };
		return { known: true, resolvedTools: [metadata.name], capabilities: [...metadata.capabilities], baseRisk: metadata.baseRisk, requiresScope: metadata.scopeMode === "network-target", reasons: [`registry metadata: ${metadata.name} ${metadata.baseRisk}`] };
	}
	const command = typeof input.command === "string" ? input.command : "";
	const executables = extractShellExecutables(command);
	const nested = executables.map(getSecurityToolMetadata).filter((metadata): metadata is SecurityToolMetadata => Boolean(metadata));
	const unknownExecutables = executables.filter((name) => !getSecurityToolMetadata(name));
	const resolvedTools = nested.length > 0 ? [...new Set(nested.map((metadata) => metadata.name))] : ["bash"];
	let baseRisk: RiskLevel = unknownExecutables.length > 0 ? "P2" : "P1";
	for (const metadata of nested) baseRisk = maxRiskLevel(baseRisk, metadata.baseRisk);
	return {
		known: unknownExecutables.length === 0 && executables.length > 0,
		resolvedTools,
		capabilities: [...new Set(["process.execute", ...nested.flatMap((metadata) => metadata.capabilities)])],
		baseRisk,
		requiresScope: nested.some((metadata) => metadata.scopeMode === "network-target"),
		reasons: nested.length > 0
			? [`shell resolved through registry: ${resolvedTools.join(", ")}`, ...(unknownExecutables.length > 0 ? [`unknown shell executable(s): ${unknownExecutables.join(", ")}`] : [])]
			: ["shell command has no registry-specific executable; conservative fallback"],
	};
}
export function planningRiskForTool(toolName: string, riskHint?: number): number {
	const metadata = getSecurityToolMetadata(toolName);
	const floor = toolName === "mcp" ? riskLevelToScore("P2") : riskLevelToScore(metadata?.baseRisk ?? "P2");
	if (riskHint === undefined || !Number.isFinite(riskHint)) return floor;
	return Math.max(floor, Math.max(0, Math.min(1, riskHint)));
}
