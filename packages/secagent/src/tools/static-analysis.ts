import type { SecurityToolMetadata } from "../core/types.ts";
import type { SecurityToolAdapter, SecurityToolExecutionContext, SecurityToolExecutionResult } from "./adapter.ts";
import { checkCommandAvailability, checkLocalInput, preconditionResult, runStandardTool, stringInput } from "./standard.ts";

type StaticToolName = "readelf" | "objdump";

type StaticAction = "headers" | "sections" | "symbols" | "dynamic" | "notes" | "relocations" | "disassemble";

const READELF_ARGS: Readonly<Partial<Record<StaticAction, readonly string[]>>> = {
	headers: ["-h"],
	sections: ["-S"],
	symbols: ["-Ws"],
	dynamic: ["-d"],
	notes: ["-n"],
	relocations: ["-r"],
};

const OBJDUMP_ARGS: Readonly<Partial<Record<StaticAction, readonly string[]>>> = {
	headers: ["-f"],
	sections: ["-h"],
	symbols: ["-t"],
	disassemble: ["-d"],
};

function localPath(input: Record<string, unknown>): string | undefined {
	return stringInput(input, "path") ?? stringInput(input, "file");
}

function staticAction(input: Record<string, unknown>): StaticAction {
	const value = stringInput(input, "action") ?? "headers";
	if (["headers", "sections", "symbols", "dynamic", "notes", "relocations", "disassemble"].includes(value))
		return value as StaticAction;
	throw new Error(`unsupported static-analysis action: ${value}`);
}

function argsFor(command: StaticToolName, action: StaticAction, path: string): string[] {
	const prefix = command === "readelf" ? READELF_ARGS[action] : OBJDUMP_ARGS[action];
	if (!prefix) throw new Error(`${command} does not support action ${action}`);
	return [...prefix, path];
}

function valueAfterPrefix(lines: readonly string[], prefix: string): string | undefined {
	const line = lines.find((candidate) => candidate.trimStart().startsWith(prefix));
	return line?.slice(line.indexOf(prefix) + prefix.length).trim();
}

function normalizeStatic(command: StaticToolName, action: StaticAction, output: Record<string, unknown>): Record<string, unknown> {
	const lines = Array.isArray(output.stdoutLines)
		? output.stdoutLines.filter((line): line is string => typeof line === "string")
		: [];
	return {
		...output,
		action,
		facts:
			command === "readelf"
				? {
					architecture: valueAfterPrefix(lines, "Machine:"),
					type: valueAfterPrefix(lines, "Type:"),
					entryPoint: valueAfterPrefix(lines, "Entry point address:"),
				}
				: {
					format: lines.find((line) => /file format/i.test(line))?.trim(),
				},
	};
}

async function preconditions(
	command: StaticToolName,
	input: Record<string, unknown>,
	context: SecurityToolExecutionContext,
): Promise<string[]> {
	const checked = await checkLocalInput(localPath(input), context);
	if (checked.diagnostic || !checked.path) return [checked.diagnostic?.message ?? "a local path is required"];
	try {
		argsFor(command, staticAction(input), checked.path);
		return [];
	} catch (error) {
		return [error instanceof Error ? error.message : String(error)];
	}
}

async function executeStatic(
	metadata: SecurityToolMetadata,
	command: StaticToolName,
	input: Record<string, unknown>,
	context: SecurityToolExecutionContext,
): Promise<SecurityToolExecutionResult> {
	const checked = await checkLocalInput(localPath(input), context);
	if (checked.diagnostic || !checked.path)
		return preconditionResult(checked.diagnostic?.message ?? "a local path is required");
	let action: StaticAction;
	let args: string[];
	try {
		action = staticAction(input);
		args = argsFor(command, action, checked.path);
	} catch (error) {
		return preconditionResult(error instanceof Error ? error.message : String(error));
	}
	return runStandardTool({
		metadata,
		command,
		args,
		targets: [checked.path],
		input,
		context,
		normalize: (output) => normalizeStatic(command, action, output),
	});
}

export function createStaticAnalysisAdapter(metadata: SecurityToolMetadata, command: StaticToolName): SecurityToolAdapter {
	return {
		metadata,
		extractTargets: (input) => {
			const path = localPath(input);
			return path ? [path] : [];
		},
		checkAvailability: (context) => checkCommandAvailability(command, context),
		checkPreconditions: (input, context) => preconditions(command, input, context),
		execute: (input, context) => executeStatic(metadata, command, input, context),
	};
}
