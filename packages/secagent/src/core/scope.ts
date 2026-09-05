import { isIP } from "node:net";
import { extractMcpNetworkTargets } from "../integrations/mcp-policy.ts";
import { resolveToolCall } from "../tools/registry.ts";
import type { ScopeAssessment, ScopeTarget, ScopeTargetKind, SecurityScope } from "./types.ts";

const NETWORK_INPUT_KEYS = new Set([
	"target",
	"targets",
	"host",
	"hosts",
	"hostname",
	"url",
	"urls",
	"domain",
	"domains",
	"address",
	"addresses",
	"ip",
	"ips",
	"endpoint",
	"endpoints",
]);
const URL_PATTERN = /https?:\/\/[^\s"'`<>]+/gi;
const IPV4_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?\b/g;
const DOMAIN_PATTERN = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}\b/gi;

function stripTrailingPunctuation(value: string): string {
	return value.replace(/[),.;:]+$/g, "");
}
function ipv4ToNumber(value: string): number | undefined {
	if (isIP(value) !== 4) return undefined;
	const octets = value.split(".").map((part) => Number.parseInt(part, 10));
	return (((octets[0] ?? 0) << 24) | ((octets[1] ?? 0) << 16) | ((octets[2] ?? 0) << 8) | (octets[3] ?? 0)) >>> 0;
}
function ipv4InCidr(ip: string, cidr: string): boolean {
	const [network, prefixText] = cidr.split("/");
	if (!network || prefixText === undefined) return false;
	const prefix = Number.parseInt(prefixText, 10);
	const ipNumber = ipv4ToNumber(ip);
	const networkNumber = ipv4ToNumber(network);
	if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32 || ipNumber === undefined || networkNumber === undefined)
		return false;
	const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
	return (ipNumber & mask) === (networkNumber & mask);
}
function normalizeHostname(value: string): string {
	return value.trim().toLowerCase().replace(/\.$/, "");
}
function hostnameFromUrl(value: string): string | undefined {
	try {
		return new URL(value).hostname.toLowerCase();
	} catch {
		return undefined;
	}
}

export function inferScopeTargetKind(value: string): ScopeTargetKind {
	const trimmed = value.trim();
	if (/^https?:\/\//i.test(trimmed) && hostnameFromUrl(trimmed)) return "url";
	if (trimmed.includes("/")) {
		const [network, prefix] = trimmed.split("/");
		if (network && prefix !== undefined && isIP(network) === 4 && /^\d{1,2}$/.test(prefix)) return "cidr";
	}
	if (isIP(trimmed) === 4) return "ipv4";
	if (trimmed.includes(".")) return "domain";
	return "host";
}

export function normalizeScopeValue(value: string, kind: ScopeTargetKind): string {
	const trimmed = value.trim();
	if (kind === "url") return hostnameFromUrl(trimmed) ?? normalizeHostname(trimmed);
	if (kind === "domain" || kind === "host") return normalizeHostname(trimmed);
	return trimmed;
}

export function isTargetInScope(candidate: string, target: ScopeTarget): boolean {
	const raw = stripTrailingPunctuation(candidate.trim());
	if (!raw) return false;
	const candidateHost = hostnameFromUrl(raw) ?? normalizeHostname(raw.split(":")[0] ?? raw);
	const scopeValue = normalizeScopeValue(target.value, target.kind);
	if (target.kind === "cidr") return ipv4InCidr(candidateHost, scopeValue);
	if (target.kind === "ipv4") return candidateHost === scopeValue;
	if (target.kind === "url" || target.kind === "domain")
		return candidateHost === scopeValue || candidateHost.endsWith(`.${scopeValue}`);
	return candidateHost === scopeValue;
}

function extractTextTargets(text: string, options: { urlsAndIpsOnly?: boolean } = {}): string[] {
	const values = new Set<string>();
	let rest = text;
	for (const match of text.matchAll(URL_PATTERN)) {
		// The URL itself is the scope candidate; its hostname is what gets
		// checked. Scrub the matched region so DOMAIN_PATTERN does not also
		// lift phantom hosts out of URL paths (e.g. "19px.png", "security.txt").
		values.add(stripTrailingPunctuation(match[0]));
		rest = rest.replace(match[0], " ");
	}
	for (const match of rest.matchAll(IPV4_PATTERN)) values.add(stripTrailingPunctuation(match[0]));
	if (options.urlsAndIpsOnly) return [...values];
	for (const match of rest.matchAll(DOMAIN_PATTERN)) {
		// Skip path segments: "docs/notes.md" and URL-adjacent file names are
		// not hosts. A real domain never appears directly after a "/".
		const previous = match.index !== undefined && match.index > 0 ? rest[match.index - 1] : undefined;
		if (previous === "/") continue;
		values.add(stripTrailingPunctuation(match[0]));
	}
	return [...values];
}

function collectInputTargets(input: Record<string, unknown>): string[] {
	const targets = new Set<string>();
	for (const [key, value] of Object.entries(input)) {
		if (!NETWORK_INPUT_KEYS.has(key.toLowerCase())) continue;
		const values = Array.isArray(value) ? value : [value];
		for (const item of values) {
			if (typeof item !== "string" || !item.trim()) continue;
			const extracted = extractTextTargets(item);
			if (extracted.length === 0) targets.add(item.trim());
			else for (const candidate of extracted) targets.add(candidate);
		}
	}
	return [...targets];
}

export function assessToolScope(
	toolName: string,
	input: Record<string, unknown>,
	scope: SecurityScope,
): ScopeAssessment {
	if (toolName.startsWith("security_"))
		return { required: false, allowed: true, targets: [], reasons: ["internal SecAgent control tool"] };
	const resolution = resolveToolCall(toolName, input);
	let required = resolution.requiresScope;
	let targets: string[] = [];
	if (toolName === "bash") {
		// Shell free text mixes URLs with file names; only explicit URL and IP
		// candidates are scope-checked so "cat notes.md" is not a host.
		if (required)
			targets = extractTextTargets(typeof input.command === "string" ? input.command : "", { urlsAndIpsOnly: true });
	} else if (toolName === "mcp") {
		targets = extractMcpNetworkTargets(input);
		required = targets.length > 0;
	} else {
		targets = collectInputTargets(input);
		if (!resolution.known && targets.length > 0) required = true;
	}
	if (!required)
		return { required: false, allowed: true, targets: [], reasons: ["tool does not require network target scope"] };
	if (scope.targets.length === 0)
		return { required: true, allowed: false, targets, reasons: ["no authorized target scope is configured"] };
	if (targets.length === 0)
		return {
			required: true,
			allowed: false,
			targets: [],
			reasons: ["network action target could not be determined before execution"],
		};
	const outside = targets.filter((candidate) => !scope.targets.some((target) => isTargetInScope(candidate, target)));
	if (outside.length > 0)
		return { required: true, allowed: false, targets, reasons: [`out-of-scope target(s): ${outside.join(", ")}`] };
	return {
		required: true,
		allowed: true,
		targets,
		reasons: ["all detected network targets are inside the authorized scope"],
	};
}
