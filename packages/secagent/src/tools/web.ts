import type { SecurityToolMetadata } from "../core/types.ts";
import type { SecurityToolAdapter, SecurityToolExecutionContext, SecurityToolExecutionResult } from "./adapter.ts";
import {
	checkCommandAvailability,
	checkLocalInput,
	preconditionResult,
	runStandardTool,
	stringInput,
} from "./standard.ts";

type WebToolName = "httpx" | "ffuf" | "nuclei";

const NUCLEI_SEVERITIES = new Set(["info", "low", "medium", "high", "critical", "unknown"]);

function webTarget(input: Record<string, unknown>): string | undefined {
	return stringInput(input, "target") ?? stringInput(input, "url");
}

function validateHttpTarget(target: string | undefined, requireFuzz = false): string {
	if (!target) throw new Error("an HTTP target is required");
	let parsed: URL;
	try {
		parsed = new URL(target);
	} catch {
		throw new Error("target must be an absolute HTTP or HTTPS URL");
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
		throw new Error("target must use http or https");
	if (requireFuzz && !target.includes("FUZZ")) throw new Error("ffuf target must contain the FUZZ marker");
	return target;
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number, name: string): number {
	if (value === undefined) return fallback;
	if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum)
		throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
	return value;
}

function jsonLines(output: Record<string, unknown>): unknown[] {
	const stdout = typeof output.stdout === "string" ? output.stdout : "";
	return stdout
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.flatMap((line) => {
			try {
				return [JSON.parse(line) as unknown];
			} catch {
				return [];
			}
		});
}

function httpxArgs(input: Record<string, unknown>, target: string): string[] {
	const args = ["-u", target, "-silent", "-json", "-status-code", "-title", "-tech-detect", "-server"];
	if (input.followRedirects === true) args.push("-follow-redirects");
	return args;
}

async function ffufArgs(input: Record<string, unknown>, context: SecurityToolExecutionContext, target: string): Promise<string[]> {
	const wordlist = stringInput(input, "wordlist");
	const checked = await checkLocalInput(wordlist, context);
	if (checked.diagnostic || !checked.path) throw new Error(checked.diagnostic?.message ?? "ffuf requires a wordlist inside the session cwd");
	const threads = boundedInteger(input.threads, 20, 1, 50, "threads");
	const rate = boundedInteger(input.rate, 50, 1, 200, "rate");
	return ["-u", target, "-w", checked.path, "-json", "-noninteractive", "-t", String(threads), "-rate", String(rate)];
}

function nucleiArgs(input: Record<string, unknown>, target: string): string[] {
	const rate = boundedInteger(input.rate, 25, 1, 100, "rate");
	const severities = Array.isArray(input.severities)
		? input.severities.filter((item): item is string => typeof item === "string")
		: [];
	if (severities.some((severity) => !NUCLEI_SEVERITIES.has(severity))) throw new Error("unsupported nuclei severity");
	const tags = Array.isArray(input.tags) ? input.tags.filter((item): item is string => typeof item === "string") : [];
	if (tags.length > 16 || tags.some((tag) => !/^[A-Za-z0-9_-]{1,64}$/.test(tag))) throw new Error("nuclei tags must be simple names and are limited to 16 entries");
	const args = [
		"-u", target,
		"-silent",
		"-jsonl",
		"-rate-limit", String(rate),
		"-bulk-size", "10",
		"-concurrency", "10",
		"-no-interactsh",
		"-disable-unsigned-templates",
	];
	if (severities.length) args.push("-severity", severities.join(","));
	if (tags.length) args.push("-tags", tags.join(","));
	return args;
}

function versionArgs(command: WebToolName): readonly string[] {
	return command === "ffuf" ? ["-V"] : ["-version"];
}

function normalizeWeb(command: WebToolName, output: Record<string, unknown>): Record<string, unknown> {
	const parsed = jsonLines(output);
	return {
		...output,
		results: parsed,
		resultCount: parsed.length,
		mode: command === "nuclei" ? "signed-builtin-templates" : command === "ffuf" ? "bounded-content-discovery" : "http-fingerprint",
	};
}

async function validateInput(command: WebToolName, input: Record<string, unknown>, context: SecurityToolExecutionContext): Promise<string[]> {
	try {
		const target = validateHttpTarget(webTarget(input), command === "ffuf");
		if (command === "ffuf") await ffufArgs(input, context, target);
		else if (command === "nuclei") nucleiArgs(input, target);
		else httpxArgs(input, target);
		return [];
	} catch (error) {
		return [error instanceof Error ? error.message : String(error)];
	}
}

async function executeWeb(
	metadata: SecurityToolMetadata,
	command: WebToolName,
	input: Record<string, unknown>,
	context: SecurityToolExecutionContext,
): Promise<SecurityToolExecutionResult> {
	let target: string;
	let args: string[];
	try {
		target = validateHttpTarget(webTarget(input), command === "ffuf");
		args = command === "ffuf"
			? await ffufArgs(input, context, target)
			: command === "nuclei"
				? nucleiArgs(input, target)
				: httpxArgs(input, target);
	} catch (error) {
		return preconditionResult(error instanceof Error ? error.message : String(error));
	}
	return runStandardTool({
		metadata,
		command,
		args,
		targets: [target],
		input,
		context,
		versionArgs: versionArgs(command),
		normalize: (output) => normalizeWeb(command, output),
	});
}

export function createWebAdapter(metadata: SecurityToolMetadata, command: WebToolName): SecurityToolAdapter {
	return {
		metadata,
		extractTargets: (input) => {
			const target = webTarget(input);
			return target ? [target] : [];
		},
		checkAvailability: (context) => checkCommandAvailability(command, context, versionArgs(command)),
		checkPreconditions: (input, context) => validateInput(command, input, context),
		execute: (input, context) => executeWeb(metadata, command, input, context),
	};
}
