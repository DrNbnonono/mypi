import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname } from "node:path";
import type { SecurityInputAsset, SecurityScenario, SecurityTaskSpec } from "../core/types.ts";

export interface SecurityIntakeInput {
	goal: string;
	scenario?: SecurityScenario;
	assets?: Array<{ name: string; path?: string; mimeType?: string; content?: string }>;
	constraints?: string[];
	successCriteria?: string[];
	declaredAuthorization?: string[];
}

function classifyAsset(name: string, mimeType?: string): SecurityInputAsset["kind"] {
	const extension = extname(name).toLowerCase();
	if (mimeType?.startsWith("image/") || [".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(extension)) return "image";
	if (mimeType === "application/pdf" || extension === ".pdf") return "pdf";
	if ([".zip", ".tar", ".tgz", ".gz", ".7z"].includes(extension)) return "archive";
	if (extension === ".json") return "json";
	if ([".yaml", ".yml"].includes(extension)) return "yaml";
	if (extension === ".csv") return "csv";
	if ([".txt", ".md", ".log"].includes(extension) || mimeType?.startsWith("text/")) return "text";
	return "unknown";
}

function sha256(data: string | Buffer): string {
	return createHash("sha256").update(data).digest("hex");
}

function inspectAsset(input: { name: string; path?: string; mimeType?: string; content?: string }): SecurityInputAsset {
	if (input.path && !existsSync(input.path)) throw new Error(`Input asset does not exist: ${input.path}`);
	const content = input.content ?? (input.path ? readFileSync(input.path) : undefined);
	const size = input.path
		? statSync(input.path).size
		: typeof content === "string"
			? Buffer.byteLength(content)
			: content?.byteLength;
	let kind = classifyAsset(input.name, input.mimeType);
	if (
		(kind === "json" || kind === "yaml") &&
		typeof content === "string" &&
		/(?:"|\b)(?:openapi|swagger)(?:"|\b)\s*[:=]/i.test(content)
	)
		kind = "openapi";
	if (kind === "json" && typeof content === "string") {
		try {
			JSON.parse(content);
		} catch {
			throw new Error(`Invalid JSON input: ${input.name}`);
		}
	}
	if (
		kind === "openapi" &&
		typeof content === "string" &&
		!/(?:openapi\s*:\s*3\.|swagger\s*:\s*2\.|"openapi"\s*:\s*"3\.|"swagger"\s*:\s*"2\.)/i.test(content)
	)
		throw new Error(`Invalid OpenAPI/Swagger input: ${input.name}`);
	return {
		id: randomUUID(),
		name: input.name,
		kind,
		path: input.path,
		mimeType: input.mimeType,
		sha256: content === undefined ? undefined : sha256(content),
		size,
	};
}

export function createSecurityTaskSpec(input: SecurityIntakeInput): SecurityTaskSpec {
	const goal = input.goal.trim();
	if (!goal) throw new Error("Security task goal is required");
	const assets = (input.assets ?? []).map(inspectAsset);
	return {
		id: randomUUID(),
		goal,
		scenario: input.scenario ?? "penetration-test",
		assets,
		constraints: (input.constraints ?? []).map((item) => item.trim()).filter(Boolean),
		successCriteria: (input.successCriteria ?? []).map((item) => item.trim()).filter(Boolean),
		declaredAuthorization: (input.declaredAuthorization ?? []).map((item) => item.trim()).filter(Boolean),
		pendingConfirmations: [
			"Confirm explicit target scope before network actions",
			...(input.declaredAuthorization?.length ? [] : ["Confirm task authorization source"]),
		],
		createdAt: new Date().toISOString(),
	};
}
