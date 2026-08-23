import { isIP } from "node:net";
import type { RiskLevel, ToolResolution } from "../core/types.ts";

const READ_ONLY_TOOL_HINT = /(?:^|_)(?:get|list|read|search|query|fetch|inspect|describe|status|view|lookup|find)(?:_|$)/i;
const MUTATING_TOOL_HINT = /(?:^|_)(?:create|update|write|set|patch|upload|send|merge|deploy|publish|change|modify)(?:_|$)/i;
const HIGH_RISK_TOOL_HINT = /(?:^|_)(?:delete|remove|destroy|drop|terminate|kill|wipe|reset|revoke|disable|execute|exec|shell|command|exploit)(?:_|$)/i;

const TARGET_KEYS = new Set([
	"target",
	"targets",
	"host",
	"hosts",
	"hostname",
	"url",
	"urls",
	"uri",
	"uris",
	"domain",
	"domains",
	"address",
	"addresses",
	"ip",
	"ips",
	"endpoint",
	"endpoints",
	"origin",
	"site",
	"baseurl",
	"base_url",
	"targeturl",
	"target_url",
]);

const URL_PATTERN = /https?:\/\/[^\s"'`<>]+/gi;
const IPV4_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?\b/g;
const DOMAIN_PATTERN = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}\b/gi;

function parseArgs(value: unknown): unknown {
	if (typeof value !== "string") return value;
	const trimmed = value.trim();
	if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
	try {
		return JSON.parse(trimmed) as unknown;
	} catch {
		return value;
	}
}

function addTextTargets(value: string, targets: Set<string>, allowBareDomain: boolean): void {
	for (const match of value.matchAll(URL_PATTERN)) targets.add(match[0]);
	for (const match of value.matchAll(IPV4_PATTERN)) {
		const candidate = match[0];
		const ip = candidate.split("/")[0] ?? candidate;
		if (isIP(ip) === 4) targets.add(candidate);
	}
	if (allowBareDomain) {
		for (const match of value.matchAll(DOMAIN_PATTERN)) targets.add(match[0]);
	}
}

function visit(value: unknown, targets: Set<string>, key: string | undefined, depth: number, budget: { remaining: number }): void {
	if (depth > 6 || budget.remaining <= 0) return;
	budget.remaining -= 1;

	if (typeof value === "string") {
		addTextTargets(value, targets, key ? TARGET_KEYS.has(key.toLowerCase()) : false);
		return;
	}

	if (Array.isArray(value)) {
		for (const item of value) visit(item, targets, key, depth + 1, budget);
		return;
	}

	if (!value || typeof value !== "object") return;
	for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
		visit(childValue, targets, childKey, depth + 1, budget);
	}
}

export function extractMcpNetworkTargets(input: Record<string, unknown>): string[] {
	const targets = new Set<string>();
	const payload = "args" in input ? parseArgs(input.args) : input;
	visit(payload, targets, undefined, 0, { remaining: 256 });
	return [...targets];
}

function riskForMcpToolName(toolName: string): RiskLevel {
	if (HIGH_RISK_TOOL_HINT.test(toolName)) return "P3";
	if (MUTATING_TOOL_HINT.test(toolName)) return "P2";
	if (READ_ONLY_TOOL_HINT.test(toolName)) return "P1";
	return "P2";
}

function controlRisk(input: Record<string, unknown>): RiskLevel {
	if (typeof input.connect === "string" && input.connect.trim()) return "P1";
	const action = typeof input.action === "string" ? input.action.toLowerCase() : "";
	if (action.includes("auth")) return "P1";
	return "P0";
}

export function resolveMcpProxyCall(input: Record<string, unknown>): ToolResolution {
	const delegatedTool = typeof input.tool === "string" ? input.tool.trim() : "";
	if (!delegatedTool) {
		const baseRisk = controlRisk(input);
		return {
			known: true,
			resolvedTools: ["mcp"],
			capabilities: [baseRisk === "P0" ? "mcp.discover" : "mcp.connect"],
			baseRisk,
			requiresScope: false,
			reasons: [baseRisk === "P0" ? "MCP metadata/discovery operation" : "MCP connection or authentication operation"],
		};
	}

	const targets = extractMcpNetworkTargets(input);
	const baseRisk = riskForMcpToolName(delegatedTool);
	return {
		known: true,
		resolvedTools: [`mcp:${delegatedTool}`],
		capabilities: ["mcp.tool.call"],
		baseRisk,
		requiresScope: targets.length > 0,
		reasons: [
			`MCP delegated tool ${delegatedTool} classified as ${baseRisk}`,
			...(targets.length > 0 ? [`MCP arguments contain network target(s): ${targets.join(", ")}`] : []),
		],
	};
}
