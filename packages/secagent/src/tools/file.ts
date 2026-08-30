import type { SecurityToolMetadata } from "../core/types.ts";
import type { SecurityToolAdapter, SecurityToolExecutionContext, SecurityToolExecutionResult } from "./adapter.ts";
import {
	checkCommandAvailability,
	checkLocalInput,
	preconditionResult,
	runStandardTool,
	sha256File,
	stringInput,
} from "./standard.ts";

function localPath(input: Record<string, unknown>): string | undefined {
	return stringInput(input, "path") ?? stringInput(input, "file");
}

function stringsArgs(input: Record<string, unknown>, path: string): string[] {
	const args = ["-a"];
	const minLength = input.minLength;
	if (minLength !== undefined) {
		if (typeof minLength !== "number" || !Number.isInteger(minLength) || minLength < 1 || minLength > 1024)
			throw new Error("minLength must be an integer between 1 and 1024");
		args.push("-n", String(minLength));
	}
	return [...args, "--", path];
}

function normalizeFile(output: Record<string, unknown>): Record<string, unknown> {
	const stdout = typeof output.stdout === "string" ? output.stdout : "";
	return { ...output, identification: stdout.split(/\r?\n/).find(Boolean) ?? "unknown" };
}

function normalizeStrings(output: Record<string, unknown>): Record<string, unknown> {
	const stdout = typeof output.stdout === "string" ? output.stdout : "";
	return { ...output, strings: stdout.split(/\r?\n/).filter(Boolean) };
}

async function executeLocal(
	metadata: SecurityToolMetadata,
	command: "file" | "strings",
	input: Record<string, unknown>,
	context: SecurityToolExecutionContext,
): Promise<SecurityToolExecutionResult> {
	const checked = await checkLocalInput(localPath(input), context);
	if (checked.diagnostic || !checked.path)
		return preconditionResult(checked.diagnostic?.message ?? "a local path is required");
	let args: string[];
	try {
		args = command === "strings" ? stringsArgs(input, checked.path) : ["--", checked.path];
	} catch (error) {
		return preconditionResult(error instanceof Error ? error.message : String(error));
	}
	let artifactSha256: string;
	try {
		artifactSha256 = await sha256File(checked.path);
	} catch (error) {
		return preconditionResult(`unable to hash local artifact: ${error instanceof Error ? error.message : String(error)}`);
	}
	return runStandardTool({
		metadata,
		command,
		args,
		targets: [checked.path],
		input,
		context,
		evidence: { sha256: artifactSha256 },
		normalize: command === "strings" ? normalizeStrings : normalizeFile,
	});
}

export function createFileAdapter(metadata: SecurityToolMetadata): SecurityToolAdapter {
	return {
		metadata,
		extractTargets: (input) => {
			const path = localPath(input);
			return path ? [path] : [];
		},
		checkAvailability: (context) => checkCommandAvailability("file", context),
		async checkPreconditions(input, context): Promise<string[]> {
			const checked = await checkLocalInput(localPath(input), context);
			return checked.diagnostic ? [checked.diagnostic.message] : [];
		},
		execute: (input, context) => executeLocal(metadata, "file", input, context),
	};
}

export function createStringsAdapter(metadata: SecurityToolMetadata): SecurityToolAdapter {
	return {
		metadata,
		extractTargets: (input) => {
			const path = localPath(input);
			return path ? [path] : [];
		},
		checkAvailability: (context) => checkCommandAvailability("strings", context),
		async checkPreconditions(input, context): Promise<string[]> {
			const checked = await checkLocalInput(localPath(input), context);
			if (checked.diagnostic) return [checked.diagnostic.message];
			try {
				stringsArgs(input, checked.path as string);
			} catch (error) {
				return [error instanceof Error ? error.message : String(error)];
			}
			return [];
		},
		execute: (input, context) => executeLocal(metadata, "strings", input, context),
	};
}
