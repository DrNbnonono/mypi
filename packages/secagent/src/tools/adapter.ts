import type { SecurityToolMetadata } from "../core/types.ts";
import { getSecurityToolMetadata } from "./registry.ts";

export interface SecurityToolExecutionContext {
	cwd: string;
	signal?: AbortSignal;
	executor?: SecurityToolExecutor;
}

export interface SecurityToolCommandResult {
	stdout: string;
	stderr: string;
	exitCode: number | null;
	signal?: string;
	timedOut: boolean;
	durationMs: number;
}

export interface SecurityToolExecutor {
	run(
		command: string,
		args: readonly string[],
		options: { cwd: string; signal?: AbortSignal; timeoutMs: number },
	): Promise<SecurityToolCommandResult>;
}

export type SecurityToolDiagnosticCode = "missing" | "incompatible" | "precondition" | "execution" | "timeout";

export interface SecurityToolAvailability {
	available: boolean;
	version?: string;
	diagnostic?: { code: SecurityToolDiagnosticCode; message: string; command?: string; exitCode?: number | null };
}

export interface SecurityToolExecutionResult {
	ok: boolean;
	output?: unknown;
	diagnostic?: { code: SecurityToolDiagnosticCode; message: string; command?: string; exitCode?: number | null };
	evidence: Array<{ summary: string; source?: string; confidence: number }>;
}

export interface SecurityToolAdapter {
	metadata: SecurityToolMetadata;
	extractTargets(input: Record<string, unknown>): string[];
	checkAvailability(context: SecurityToolExecutionContext): Promise<SecurityToolAvailability>;
	checkPreconditions(input: Record<string, unknown>, context: SecurityToolExecutionContext): Promise<string[]>;
	execute(input: Record<string, unknown>, context: SecurityToolExecutionContext): Promise<SecurityToolExecutionResult>;
}

export function requireRegisteredTool(name: string): SecurityToolMetadata {
	const metadata = getSecurityToolMetadata(name);
	if (!metadata) throw new Error(`Security tool is not registered: ${name}`);
	return metadata;
}

export function missingToolResult(name: string): SecurityToolExecutionResult {
	return {
		ok: false,
		diagnostic: { code: "missing", message: `Required external tool is unavailable: ${name}` },
		evidence: [],
	};
}
