import { homedir } from "node:os";
import { resolve } from "node:path";

export interface ProtectedPathAssessment {
	blocked: boolean;
	paths: string[];
	reasons: string[];
}

const PROTECTED_PATH_PATTERNS = [
	/(?:^|\/)\.ssh(?:\/|$)/i,
	/(?:^|\/)\.aws(?:\/|$)/i,
	/(?:^|\/)\.gnupg(?:\/|$)/i,
	/(?:^|\/)\.config\/gcloud(?:\/|$)/i,
	/(?:^|\/)\.kube\/config(?:\/|$)/i,
	/(?:^|\/)\.docker\/config\.json$/i,
	/(?:^|\/)\.pi\/auth\.json$/i,
	/(?:^|\/)(?:\.netrc|\.npmrc)$/i,
	/^\/etc\/(?:shadow|gshadow|sudoers)(?:\/|$)/i,
	/^\/proc\/(?:self|\d+)\/(?:environ|mem)$/i,
	/^\/dev\/mem$/i,
] as const;

function collectStrings(value: unknown, output: string[], seen: Set<object>, depth: number): void {
	if (depth > 8) return;
	if (typeof value === "string") {
		output.push(value);
		return;
	}
	if (!value || typeof value !== "object" || seen.has(value)) return;
	seen.add(value);
	if (Array.isArray(value)) {
		for (const item of value) collectStrings(item, output, seen, depth + 1);
		return;
	}
	for (const item of Object.values(value)) collectStrings(item, output, seen, depth + 1);
}

function candidatePaths(value: string, cwd: string): string[] {
	const withoutUrls = value.replace(/https?:\/\/[^\s|;&]+/gi, "");
	const tokens = [withoutUrls, ...value.split(/[\s|;&]+/)]
		.map((token) => token.trim().replace(/^["'`([{]+|["'`\])},]+$/g, ""))
		.filter(Boolean)
		.filter((token) => !/^https?:\/\//i.test(token));
	return tokens.flatMap((token) => {
		const normalized = token.replaceAll("\\", "/");
		if (normalized.startsWith("~/")) return [normalized, `${homedir().replaceAll("\\", "/")}/${normalized.slice(2)}`];
		if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) return [normalized];
		if (normalized.includes("/") || normalized.startsWith(".")) {
			return [normalized, resolve(cwd, normalized).replaceAll("\\", "/")];
		}
		return [];
	});
}

export function assessProtectedPaths(input: unknown, cwd = process.cwd()): ProtectedPathAssessment {
	const strings: string[] = [];
	collectStrings(input, strings, new Set<object>(), 0);
	const paths = [
		...new Set(
			strings
				.flatMap((value) => candidatePaths(value, cwd))
				.filter((path) => PROTECTED_PATH_PATTERNS.some((pattern) => pattern.test(path))),
		),
	];
	return {
		blocked: paths.length > 0,
		paths,
		reasons: paths.map((path) => `protected credential path is not accessible: ${path}`),
	};
}
