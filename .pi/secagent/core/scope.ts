import { isIP } from "node:net";
import type { ScopeAssessment, ScopeTarget, ScopeTargetKind, SecurityScope } from "./types.ts";
import { resolveToolCall } from "../tools/registry.ts";

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

function parseIpv4(value: string): number[] | undefined {
	if (isIP(value) !== 4) return undefined;
	const octets = value.split(".").map((part) => Number.parseInt(part, 10));
	return octets.length === 4 ? octets : undefined;
}

function ipv4ToNumber(value: string): number | undefined {
	const octets = parseIpv4(value);
	if (!octets) return undefined;
	return (((octets[0] ?? 0) << 24) | ((octets[1] ?? 0) << 16) | ((octets[2] ?? 0) << 8) | (octets[3] ?? 0)) >>> 0;
}

function ipv4InCidr(ip: string, cidr: string): boolean {
	const [network, prefixText] = cidr.split("/");
	if (!network || prefixText === undefined) return false;
	const prefix = Number.parseInt(prefixText, 10);
	if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
	const ipNumber = ipv4ToNumber(ip);
	const networkNumber = ipv4ToNumber(network);
	if (ipNumber === undefined || networkNumber === undefined) return false;
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
	if (kind === "url") {
		const hostname = hostnameFromUrl(trimmed);
		return hostname ?? normalizeHostname(trimmed);
	}
	if (kind === "domain" || kind === "host") return normalizeHostname(trimmed);
	if (kind === "cidr") {
		const [network, prefix] = trimmed.split("/");
		return `${network ?? ""}/${prefix ?? ""}`;
	}
	return trimmed;
}

export function isTargetInScope(candidate: string, target: ScopeTarget): boolean {
	const rawCandidate = stripTrailingPunctuation(candidate.trim());
	if (!rawCandidate) return false;
	const candidateHost = hostnameFromUrl(rawCandidate) ?? normalizeHostname(rawCandidate.split(":")[0] ?? rawCandidate);
	const scopeValue = normalizeScopeValue(target.value, target.kind);

	if (target.kind === "cidr") return ipv4InCidr(candidateHost, scopeValue);
	if (target.kind === "ipv4") return candidateHost === scopeValue;
	if (target.kind === "url" || target.kind === "domain") {
		return candidateHost === scopeValue || candidateHost.endsWith(`.${scopeValue}`);
	}
	return candidateHost === scopeValue;
}

function extractTextTargets(text: string): string[] {
	const values = new Set<string>();
	for (const match of text.matchAll(URL_PATTERN)) values.add(stripTrailingPunctuation(match[0]));
	for (const match of text.matchAll(IPV4_PATTERN)) values.add(stripTrailingPunctuation(match[0]));
	for (const match of text.matchAll(DOMAIN_PATTERN)) values.add(stripTrailingPunctuation(match[0]));
	return [...values];
}

function collectInputTargets(input: Record<string, unknown>): string[] {
	const targets = new Set<string>();
	for (const [key, value] of Object.entries(input)) {
		if (!NETWORK_INPUT_KEYS.has(key.toLowerCase())) continue;
		if (typeof value === "string") {
			const extracted = extractTextTargets(value);
			for (const candidate of extracted) targets.add(candidate);
			if (extracted.length === 0 && value.trim()) targets.add(value.trim());
			continue;
		}
		if (Array.isArray(value)) {
			for (const item of value) {
				if (typeof item === "string" && item.trim()) targets.add(item.trim());
			}
		}
	}
	return [...targets];
}

export function assessToolScope(toolName: string, input: Record<string, unknown>, scope: SecurityScope): ScopeAssessment {
	if (toolName.startsWith("security_")) {
		return { required: false, allowed: true, targets: [], reasons: ["internal SecAgent control tool"] };
	}

	const resolution = resolveToolCall(toolName, input);
	let required = resolution.requiresScope;
	let targets: string[] = [];

	if (toolName === "bash") {
		const command = typeof input.command === "string" ? input.command : "";
		if (required) targets = extractTextTargets(command);
	} else {
		targets = collectInputTargets(input);
		if (!resolution.known && targets.length > 0) required = true;
	}

	if (!required) {
		return { required: false, allowed: true, targets: [], reasons: ["registry metadata does not require network target scope"] };
	}

	if (scope.targets.length === 0) {
		return {
			required: true,
			allowed: false,
			targets,
			reasons: ["no authorized target scope is configured"],
		};
	}

	if (targets.length === 0) {
		return {
			required: true,
			allowed: false,
			targets: [],
			reasons: ["network action target could not be determined before execution"],
		};
	}

	const outside = targets.filter((candidate) => !scope.targets.some((target) => isTargetInScope(candidate, target)));
	if (outside.length > 0) {
		return {
			required: true,
			allowed: false,
			targets,
			reasons: [`out-of-scope target(s): ${outside.join(", ")}`],
		};
	}

	return {
		required: true,
		allowed: true,
		targets,
		reasons: ["all detected network targets are inside the authorized scope"],
	};
}
