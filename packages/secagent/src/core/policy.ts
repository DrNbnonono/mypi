import { maxRiskLevel, resolveToolCall } from "../tools/registry.ts";
import type { PolicyMode, RiskAssessment, RiskLevel, SecurityState } from "./types.ts";

const P3_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
	{
		pattern:
			/\brm\s+(?:(?:-[^\s]*r[^\s]*f[^\s]*|-[^\s]*f[^\s]*r[^\s]*)|(?:-[^\s]*r[^\s]*\s+-[^\s]*f[^\s]*|-[^\s]*f[^\s]*\s+-[^\s]*r[^\s]*)|--recursive)\b/i,
		reason: "recursive destructive file deletion",
	},
	{ pattern: /\b(?:mkfs|wipefs)\b/i, reason: "filesystem destruction" },
	{ pattern: /\bdd\b[^\n]*\bof=\/dev\//i, reason: "raw block-device write" },
	{ pattern: /\b(?:shutdown|reboot|poweroff|halt)\b/i, reason: "host availability impact" },
	{ pattern: /\biptables\b[^\n]*\s-F\b/i, reason: "firewall policy flush" },
	{ pattern: /\b(?:curl|wget)\b[^|\n]*\|\s*(?:sh|bash|zsh)\b/i, reason: "remote code piped directly to shell" },
];

export function assessToolRisk(toolName: string, input: Record<string, unknown>): RiskAssessment {
	const resolution = resolveToolCall(toolName, input);
	let level = resolution.baseRisk;
	const reasons = [...resolution.reasons];
	if (toolName === "bash") {
		const command = typeof input.command === "string" ? input.command : "";
		reasons.unshift("shell execution");
		for (const rule of P3_PATTERNS) {
			if (!rule.pattern.test(command)) continue;
			level = maxRiskLevel(level, "P3");
			reasons.push(rule.reason);
		}
	}
	return { level, reasons: [...new Set(reasons)], resolution };
}

export function decidePermission(mode: PolicyMode, level: RiskLevel): "allow" | "confirm" {
	if (mode === "autonomous") return "allow";
	if (level === "P0" || level === "P1") return "allow";
	if (level === "P2" && mode === "competition") return "allow";
	return "confirm";
}

export function canEnableAutonomous(
	state: SecurityState,
	options: { runtimePackagesReady?: boolean } = {},
): { allowed: boolean; reason?: string } {
	if (!state.task) return { allowed: false, reason: "autonomous mode requires an active security task" };
	if (state.scope.targets.length === 0)
		return { allowed: false, reason: "autonomous mode requires an explicit authorized target scope" };
	if (options.runtimePackagesReady === false)
		return {
			allowed: false,
			reason: "autonomous mode requires all pinned Sec runtime packages at their configured versions",
		};
	if (state.isolation.status === "unverified")
		return {
			allowed: false,
			reason: "autonomous mode requires an active sandbox or declared controlled external isolation",
		};
	if (!state.autonomousAuthorization)
		return { allowed: false, reason: "autonomous mode requires a recorded one-time risk authorization" };
	if (!state.isolation.source || state.autonomousAuthorization.isolationSource !== state.isolation.source) {
		return { allowed: false, reason: "autonomous authorization does not match the active isolation source" };
	}
	return { allowed: true };
}
