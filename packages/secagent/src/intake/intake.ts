import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { parseDocument } from "yaml";
import { assessProtectedPaths } from "../core/protected-paths.ts";
import type { SecurityInputAsset, SecurityScenario, SecurityTaskSpec } from "../core/types.ts";

const MAX_ASSET_BYTES = 64 * 1024 * 1024;
const MAX_INSPECTED_TEXT_BYTES = 4 * 1024 * 1024;
const TARGET_PATTERN =
	/https?:\/\/[^\s"'`<>]+|\b(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?\b|\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}\b/gi;

export interface SecurityIntakeInput {
	goal: string;
	scenario?: SecurityScenario;
	assets?: Array<{ name: string; path?: string; mimeType?: string; content?: string; contentBase64?: string }>;
	constraints?: string[];
	successCriteria?: string[];
	declaredAuthorization?: string[];
}

export interface SecurityTaskSpecOptions {
	cwd?: string;
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

function safeAssetPath(rawPath: string, cwd: string): string {
	if (rawPath.startsWith("-")) throw new Error("Input asset paths may not begin with '-'");
	const protectedPath = assessProtectedPaths({ path: rawPath }, cwd);
	if (protectedPath.blocked) throw new Error(protectedPath.reasons.join("; "));
	const root = realpathSync(resolve(cwd));
	const candidate = resolve(root, rawPath);
	if (!existsSync(candidate)) throw new Error(`Input asset does not exist: ${rawPath}`);
	const resolved = realpathSync(candidate);
	const resolvedRelative = relative(root, resolved);
	if (isAbsolute(resolvedRelative) || resolvedRelative === ".." || resolvedRelative.startsWith("../"))
		throw new Error(`Input asset must remain inside the Session working directory: ${rawPath}`);
	if (!statSync(resolved).isFile()) throw new Error(`Input asset must be a regular file: ${rawPath}`);
	return resolved;
}

function decodeBase64(value: string, name: string): Buffer {
	if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0)
		throw new Error(`Invalid base64 input: ${name}`);
	return Buffer.from(value, "base64");
}

function assetBytes(
	input: { name: string; path?: string; content?: string; contentBase64?: string },
	cwd: string,
): Buffer | undefined {
	if (input.content !== undefined && input.contentBase64 !== undefined)
		throw new Error(`Input asset ${input.name} cannot provide both content and contentBase64`);
	if (input.contentBase64 !== undefined) return decodeBase64(input.contentBase64, input.name);
	if (input.content !== undefined) return Buffer.from(input.content, "utf8");
	return input.path ? readFileSync(safeAssetPath(input.path, cwd)) : undefined;
}

function parseYaml(value: string, name: string): unknown {
	const document = parseDocument(value, { prettyErrors: true, strict: true });
	if (document.errors.length > 0)
		throw new Error(`Invalid YAML input ${name}: ${document.errors[0]?.message ?? "parse error"}`);
	try {
		return document.toJS({ maxAliasCount: 0 }) as unknown;
	} catch (error) {
		throw new Error(`Invalid YAML input ${name}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function validateCsv(value: string, name: string): void {
	let quoted = false;
	for (let index = 0; index < value.length; index += 1) {
		const character = value[index];
		if (character !== '"') continue;
		if (quoted && value[index + 1] === '"') {
			index += 1;
			continue;
		}
		quoted = !quoted;
	}
	if (quoted) throw new Error(`Invalid CSV input ${name}: unterminated quoted field`);
}

function isOpenApiDocument(value: unknown): boolean {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	return (typeof record.openapi === "string" && /^3\./.test(record.openapi)) || record.swagger === "2.0";
}

function looksLikeOpenApi(input: { name: string; mimeType?: string }, value: string): boolean {
	return (
		/openapi|swagger/i.test(input.name) ||
		input.mimeType === "application/vnd.oai.openapi" ||
		/\b(?:openapi|swagger)\b\s*:/i.test(value) ||
		/"(?:openapi|swagger)"\s*:/i.test(value)
	);
}

function isPdf(bytes: Buffer): boolean {
	return bytes.subarray(0, 5).toString("ascii") === "%PDF-";
}

function isImage(bytes: Buffer): boolean {
	return (
		(bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
		(bytes.length >= 3 && bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) ||
		bytes.subarray(0, 4).toString("ascii") === "GIF8" ||
		(bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP")
	);
}

function detectedTargets(text: string | undefined): string[] | undefined {
	if (!text) return undefined;
	const targets = [
		...new Set([...text.slice(0, MAX_INSPECTED_TEXT_BYTES).matchAll(TARGET_PATTERN)].map((match) => match[0])),
	];
	return targets.length > 0 ? targets : undefined;
}

function inspectAsset(
	input: { name: string; path?: string; mimeType?: string; content?: string; contentBase64?: string },
	options: SecurityTaskSpecOptions,
): SecurityInputAsset {
	const bytes = assetBytes(input, options.cwd ?? process.cwd());
	if (bytes && bytes.byteLength > MAX_ASSET_BYTES)
		throw new Error(`Input asset exceeds ${MAX_ASSET_BYTES} byte limit: ${input.name}`);
	const text = bytes?.toString("utf8");
	let kind = classifyAsset(input.name, input.mimeType);
	let formatValid: boolean | undefined;
	const validationMessages: string[] = [];
	let parsed: unknown;
	if ((kind === "json" || kind === "yaml") && text !== undefined) {
		if (kind === "json") {
			try {
				parsed = JSON.parse(text) as unknown;
			} catch {
				throw new Error(`Invalid JSON input: ${input.name}`);
			}
		} else parsed = parseYaml(text, input.name);
		formatValid = true;
		if (looksLikeOpenApi(input, text)) {
			if (!isOpenApiDocument(parsed)) throw new Error(`Invalid OpenAPI/Swagger input: ${input.name}`);
			kind = "openapi";
		}
	}
	if (kind === "csv" && text !== undefined) {
		validateCsv(text, input.name);
		formatValid = true;
	}
	if (kind === "pdf" && bytes) {
		if (!isPdf(bytes)) throw new Error(`Invalid PDF input: ${input.name}`);
		formatValid = true;
	}
	if (kind === "image" && bytes) {
		if (!isImage(bytes)) throw new Error(`Unsupported or invalid image input: ${input.name}`);
		formatValid = true;
	}
	if ((kind === "text" || kind === "unknown") && bytes) formatValid = true;
	if (kind === "pdf" && text) validationMessages.push("PDF accepted; extracted text remains untrusted task input");
	if (kind === "image" && text)
		validationMessages.push("Image signature validated; OCR is not performed by the core intake");
	return {
		id: randomUUID(),
		name: input.name,
		kind,
		path: input.path,
		mimeType: input.mimeType,
		sha256: bytes === undefined ? undefined : sha256(bytes),
		size: bytes?.byteLength,
		formatValid,
		validationMessages: validationMessages.length > 0 ? validationMessages : undefined,
		detectedTargets: detectedTargets(text),
	};
}

export function createSecurityTaskSpec(
	input: SecurityIntakeInput,
	options: SecurityTaskSpecOptions = {},
): SecurityTaskSpec {
	const goal = input.goal.trim();
	if (!goal) throw new Error("Security task goal is required");
	const assets = (input.assets ?? []).map((asset) => inspectAsset(asset, options));
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
