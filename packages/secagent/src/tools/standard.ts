import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { SecurityToolMetadata } from "../core/types.ts";
import type {
	SecurityToolAdapter,
	SecurityToolAvailability,
	SecurityToolCommandResult,
	SecurityToolExecutionContext,
	SecurityToolExecutionResult,
	SecurityToolExecutor,
} from "./adapter.ts";
import { defaultSecurityToolExecutor } from "./executor.ts";

export const DEFAULT_TOOL_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_NORMALIZED_OUTPUT = 256 * 1024;

export function commandExecutor(context: SecurityToolExecutionContext): SecurityToolExecutor {
	return context.executor ?? defaultSecurityToolExecutor;
}

export function timeoutFromInput(input: Record<string, unknown>): number {
	const value = input.timeoutMs;
	if (value === undefined) return DEFAULT_TOOL_TIMEOUT_MS;
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 300_000)
		throw new Error("timeoutMs must be an integer between 1 and 300000");
	return value;
}

export function stringInput(input: Record<string, unknown>, key: string): string | undefined {
	const value = input[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function targetValues(input: Record<string, unknown>, keys: readonly string[]): string[] {
	const values: string[] = [];
	for (const key of keys) {
		const value = input[key];
		for (const item of Array.isArray(value) ? value : [value]) {
			if (typeof item === "string" && item.trim()) values.push(item.trim());
		}
	}
	return [...new Set(values)];
}

export function commandResultOutput(
	tool: string,
	args: readonly string[],
	targets: readonly string[],
	result: SecurityToolCommandResult,
	version?: string,
): Record<string, unknown> {
	const stdout = result.stdout.slice(0, DEFAULT_MAX_NORMALIZED_OUTPUT);
	const stderr = result.stderr.slice(0, DEFAULT_MAX_NORMALIZED_OUTPUT);
	return {
		tool,
		args: [...args],
		targets: [...targets],
		version,
		exitCode: result.exitCode,
		signal: result.signal,
		timedOut: result.timedOut,
		durationMs: result.durationMs,
		stdout,
		stderr,
		stdoutLines: stdout.split(/\r?\n/).filter(Boolean),
		stderrLines: stderr.split(/\r?\n/).filter(Boolean),
		truncated: result.stdout.length > stdout.length || result.stderr.length > stderr.length,
	};
}

export async function checkCommandVersion(
	command: string,
	context: SecurityToolExecutionContext,
	timeoutMs: number,
): Promise<{ version?: string; diagnostic?: SecurityToolExecutionResult["diagnostic"] }> {
	try {
		const result = await commandExecutor(context).run(command, ["--version"], {
			cwd: context.cwd,
			signal: context.signal,
			timeoutMs,
		});
		if (result.timedOut)
			return { diagnostic: { code: "timeout", message: `${command} version check timed out`, command } };
		if (result.exitCode !== 0)
			return {
				diagnostic: {
					code: "incompatible",
					message: `${command} is present but --version failed`,
					command,
					exitCode: result.exitCode,
				},
			};
		const version = `${result.stdout}\n${result.stderr}`
			.split(/\r?\n/)
			.map((line) => line.trim())
			.find(Boolean);
		return { version };
	} catch (error) {
		const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
		if (code === "ENOENT")
			return {
				diagnostic: { code: "missing", message: `Required external tool is unavailable: ${command}`, command },
			};
		return {
			diagnostic: {
				code: "execution",
				message: `${command} version check failed: ${error instanceof Error ? error.message : String(error)}`,
				command,
			},
		};
	}
}

export async function checkCommandAvailability(
	command: string,
	context: SecurityToolExecutionContext,
): Promise<SecurityToolAvailability> {
	const result = await checkCommandVersion(command, context, 5_000);
	return result.diagnostic
		? { available: false, diagnostic: result.diagnostic }
		: { available: true, version: result.version };
}

export function preconditionResult(message: string): SecurityToolExecutionResult {
	return { ok: false, diagnostic: { code: "precondition", message }, evidence: [] };
}

export function diagnosticResult(
	diagnostic: NonNullable<SecurityToolExecutionResult["diagnostic"]>,
): SecurityToolExecutionResult {
	return { ok: false, diagnostic, evidence: [] };
}

export async function runStandardTool(options: {
	metadata: SecurityToolMetadata;
	command: string;
	args: readonly string[];
	targets: readonly string[];
	input: Record<string, unknown>;
	context: SecurityToolExecutionContext;
	normalize?: (output: Record<string, unknown>) => unknown;
}): Promise<SecurityToolExecutionResult> {
	let timeoutMs: number;
	try {
		timeoutMs = timeoutFromInput(options.input);
	} catch (error) {
		return preconditionResult(error instanceof Error ? error.message : String(error));
	}
	const availability = await checkCommandVersion(options.command, options.context, Math.min(timeoutMs, 5_000));
	if (availability.diagnostic) return diagnosticResult(availability.diagnostic);
	try {
		const result = await commandExecutor(options.context).run(options.command, options.args, {
			cwd: options.context.cwd,
			signal: options.context.signal,
			timeoutMs,
		});
		const output = commandResultOutput(options.command, options.args, options.targets, result, availability.version);
		if (result.timedOut)
			return {
				ok: false,
				output,
				diagnostic: {
					code: "timeout",
					message: `${options.command} timed out after ${timeoutMs}ms`,
					command: options.command,
				},
				evidence: [],
			};
		const normalized = options.normalize ? options.normalize(output) : output;
		const summary = `${options.command} completed with exit code ${String(result.exitCode)}${result.stderr.trim() ? `: ${result.stderr.trim().slice(0, 240)}` : ""}`;
		return {
			ok: result.exitCode === 0,
			output: normalized,
			diagnostic:
				result.exitCode === 0
					? undefined
					: { code: "execution", message: summary, command: options.command, exitCode: result.exitCode },
			evidence: [{ summary, source: options.command, confidence: result.exitCode === 0 ? 0.9 : 0.4 }],
		};
	} catch (error) {
		return diagnosticResult({
			code: "execution",
			message: `${options.command} execution failed: ${error instanceof Error ? error.message : String(error)}`,
			command: options.command,
		});
	}
}

export async function checkLocalInput(
	rawPath: string | undefined,
	context: SecurityToolExecutionContext,
): Promise<{ path?: string; diagnostic?: SecurityToolExecutionResult["diagnostic"] }> {
	if (!rawPath) return { diagnostic: { code: "precondition", message: "a local path is required" } };
	if (rawPath.startsWith("-"))
		return { diagnostic: { code: "precondition", message: "local paths may not begin with '-'" } };
	const root = resolve(context.cwd);
	const candidate = resolve(root, rawPath);
	const rel = relative(root, candidate);
	if (isAbsolute(rel) || rel === ".." || rel.startsWith("../"))
		return { diagnostic: { code: "precondition", message: "local path must remain inside the session cwd" } };
	try {
		const [rootReal, candidateReal] = await Promise.all([realpath(root), realpath(candidate)]);
		const realRel = relative(rootReal, candidateReal);
		if (isAbsolute(realRel) || realRel === ".." || realRel.startsWith("../"))
			return {
				diagnostic: { code: "precondition", message: "symlink-resolved path must remain inside the session cwd" },
			};
		const info = await stat(candidateReal);
		if (!info.isFile())
			return { diagnostic: { code: "precondition", message: "local tool input must be a regular file" } };
		return { path: candidateReal };
	} catch (error) {
		return {
			diagnostic: {
				code: "precondition",
				message: `local input is unavailable: ${error instanceof Error ? error.message : String(error)}`,
			},
		};
	}
}

export function adapterPreconditions(metadata: SecurityToolMetadata, input: Record<string, unknown>): string[] {
	const requiresTarget = metadata.preconditions.includes("target is within authorized scope");
	return requiresTarget && targetValues(input, ["target", "targets", "url", "urls"]).length === 0
		? ["a target is required before scope assessment"]
		: [];
}

export type StandardAdapterFactory = (metadata: SecurityToolMetadata) => SecurityToolAdapter;
