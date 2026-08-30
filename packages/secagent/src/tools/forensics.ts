import type { SecurityToolMetadata } from "../core/types.ts";
import type { SecurityToolAdapter, SecurityToolExecutionContext, SecurityToolExecutionResult } from "./adapter.ts";
import { checkCommandAvailability, checkLocalInput, preconditionResult, runStandardTool, sha256File, stringInput } from "./standard.ts";

type ForensicsToolName = "binwalk" | "exiftool";
function localPath(input: Record<string, unknown>): string | undefined {
	return stringInput(input, "path") ?? stringInput(input, "file");
}
function normalizeBinwalk(output: Record<string, unknown>): Record<string, unknown> {
	const lines = Array.isArray(output.stdoutLines) ? output.stdoutLines.filter((line): line is string => typeof line === "string") : [];
	return { ...output, scanOnly: true, hits: lines.filter((line) => /^\s*\d+\s+0x[0-9a-f]+\s+/i.test(line)).slice(0, 256) };
}
function normalizeExiftool(output: Record<string, unknown>): Record<string, unknown> {
	const stdout = typeof output.stdout === "string" ? output.stdout : "";
	try {
		const parsed = JSON.parse(stdout) as unknown;
		return { ...output, metadata: parsed };
	} catch {
		return { ...output, metadata: undefined, parseDiagnostic: "exiftool JSON output could not be parsed" };
	}
}
async function executeForensics(metadata: SecurityToolMetadata, command: ForensicsToolName, input: Record<string, unknown>, context: SecurityToolExecutionContext): Promise<SecurityToolExecutionResult> {
	const checked = await checkLocalInput(localPath(input), context);
	if (checked.diagnostic || !checked.path) return preconditionResult(checked.diagnostic?.message ?? "a local path is required");
	let artifactSha256: string;
	try {
		artifactSha256 = await sha256File(checked.path);
	} catch (error) {
		return preconditionResult(`unable to hash local artifact: ${error instanceof Error ? error.message : String(error)}`);
	}
	return runStandardTool({
		metadata,
		command,
		args: command === "binwalk" ? [checked.path] : ["-j", checked.path],
		targets: [checked.path],
		input,
		context,
		versionArgs: command === "exiftool" ? ["-ver"] : undefined,
		evidence: { sha256: artifactSha256 },
		normalize: command === "binwalk" ? normalizeBinwalk : normalizeExiftool,
	});
}
export function createForensicsAdapter(metadata: SecurityToolMetadata, command: ForensicsToolName): SecurityToolAdapter {
	return {
		metadata,
		extractTargets: (input) => { const path = localPath(input); return path ? [path] : []; },
		checkAvailability: (context) => checkCommandAvailability(command, context, command === "exiftool" ? ["-ver"] : undefined),
		async checkPreconditions(input, context) {
			const checked = await checkLocalInput(localPath(input), context);
			return checked.diagnostic ? [checked.diagnostic.message] : [];
		},
		execute: (input, context) => executeForensics(metadata, command, input, context),
	};
}
