import type { CtfChallengeKind, CtfChallengeProfile, SecurityState } from "../core/types.ts";

export interface CtfCapability {
	id: string;
	label: string;
	challengeKinds: CtfChallengeKind[];
	preferredTools: string[];
	expectedEvidence: string[];
	description: string;
}

export const CTF_CAPABILITIES: readonly CtfCapability[] = [
	{
		id: "web-enumeration",
		label: "Web surface enumeration",
		challengeKinds: ["web"],
		preferredTools: ["curl", "nmap"],
		expectedEvidence: ["HTTP status and headers", "reachable routes", "service fingerprint"],
		description: "Map the exposed HTTP surface before attempting deeper validation.",
	},
	{
		id: "web-request-analysis",
		label: "Web request analysis",
		challengeKinds: ["web"],
		preferredTools: ["curl"],
		expectedEvidence: ["response delta", "input/output behavior", "server-side error or validation behavior"],
		description: "Compare bounded request variants and preserve response evidence.",
	},
	{
		id: "binary-triage",
		label: "Binary triage",
		challengeKinds: ["pwn", "reverse"],
		preferredTools: ["file", "strings", "readelf", "objdump", "checksec"],
		expectedEvidence: ["architecture", "protections", "symbols", "interesting strings"],
		description: "Establish binary format, architecture, mitigations and high-signal static facts.",
	},
	{
		id: "reverse-analysis",
		label: "Reverse analysis",
		challengeKinds: ["reverse"],
		preferredTools: ["file", "strings", "objdump", "readelf"],
		expectedEvidence: ["control-flow clue", "comparison constant", "encoded data", "symbol relationship"],
		description: "Turn static artifacts into testable hypotheses without declaring success from one clue.",
	},
	{
		id: "pwn-reasoning",
		label: "Pwn reasoning",
		challengeKinds: ["pwn"],
		preferredTools: ["file", "checksec", "readelf", "objdump", "python"],
		expectedEvidence: ["memory-safety primitive", "mitigation state", "controlled crash or invariant"],
		description: "Reason about memory-safety primitives and mitigations inside the isolated challenge environment.",
	},
	{
		id: "crypto-analysis",
		label: "Cryptographic challenge analysis",
		challengeKinds: ["crypto"],
		preferredTools: ["python"],
		expectedEvidence: ["mathematical invariant", "encoding structure", "reproducible transform"],
		description: "Use scripts and mathematical checks to reduce a crypto challenge to reproducible facts.",
	},
	{
		id: "forensics-triage",
		label: "Forensics triage",
		challengeKinds: ["forensics"],
		preferredTools: ["file", "strings", "binwalk", "exiftool"],
		expectedEvidence: ["metadata", "embedded artifact", "file signature", "recoverable content"],
		description: "Inspect challenge artifacts, metadata and embedded content while retaining hashes and provenance.",
	},
	{
		id: "misc-scripting",
		label: "General CTF scripting",
		challengeKinds: ["misc", "crypto", "forensics", "unknown"],
		preferredTools: ["python", "jq"],
		expectedEvidence: ["reproducible parser output", "transformation result"],
		description: "Use bounded scripting for parsing, transforms and challenge-specific glue logic.",
	},
] as const;

const KIND_KEYWORDS: Readonly<Record<Exclude<CtfChallengeKind, "unknown">, readonly RegExp[]>> = {
	web: [/\bweb\b/i, /http/i, /cookie/i, /endpoint/i, /xss/i, /sql/i],
	pwn: [/\bpwn\b/i, /heap/i, /stack/i, /rop/i, /binary exploitation/i, /memory corruption/i],
	reverse: [/reverse/i, /reversing/i, /decompile/i, /disassembl/i, /apk/i, /crackme/i],
	crypto: [/crypto/i, /cipher/i, /rsa/i, /aes/i, /ecc/i, /modular/i],
	forensics: [/forensic/i, /pcap/i, /memory dump/i, /disk image/i, /stegan/i, /metadata/i],
	misc: [/\bmisc\b/i, /puzzle/i, /encoding/i],
};

export function inferCtfChallengeKind(text: string): CtfChallengeKind {
	let best: { kind: CtfChallengeKind; score: number } = { kind: "unknown", score: 0 };
	for (const [kind, patterns] of Object.entries(KIND_KEYWORDS) as Array<
		[Exclude<CtfChallengeKind, "unknown">, readonly RegExp[]]
	>) {
		const score = patterns.reduce((sum, pattern) => sum + (pattern.test(text) ? 1 : 0), 0);
		if (score > best.score) best = { kind, score };
	}
	return best.kind;
}

export function capabilitiesForCtf(kind: CtfChallengeKind): CtfCapability[] {
	return CTF_CAPABILITIES.filter(
		(capability) => capability.challengeKinds.includes(kind) || capability.challengeKinds.includes("unknown"),
	);
}

export function createCtfChallengeProfile(
	state: SecurityState,
	overrideKind?: CtfChallengeKind,
	description?: string,
): CtfChallengeProfile {
	const corpus = [
		state.goal,
		state.task?.goal,
		description,
		...(state.task?.constraints ?? []),
		...(state.task?.successCriteria ?? []),
	]
		.filter((item): item is string => Boolean(item))
		.join("\n");
	const kind = overrideKind ?? inferCtfChallengeKind(corpus);
	const capabilities = capabilitiesForCtf(kind);
	return {
		kind,
		objective: state.goal || state.task?.goal || "Solve the authorized CTF challenge",
		recommendedCapabilities: capabilities.map((capability) => capability.id),
		flagPatterns: ["flag{...}", "ctf{...}", "FLAG{...}"],
		expectedEvidence: [...new Set(capabilities.flatMap((capability) => capability.expectedEvidence))],
		createdAt: new Date().toISOString(),
	};
}
