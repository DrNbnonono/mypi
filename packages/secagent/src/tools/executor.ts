import { spawn } from "node:child_process";
import type { SecurityToolCommandResult, SecurityToolExecutor } from "./adapter.ts";

const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;

function decodeOutput(chunks: Buffer[], maxOutputBytes: number): string {
	return Buffer.concat(chunks).subarray(0, maxOutputBytes).toString("utf8");
}

export interface NodeSecurityToolExecutorOptions {
	maxOutputBytes?: number;
}

/** Executes a fixed executable plus argv with shell disabled. */
export class NodeSecurityToolExecutor implements SecurityToolExecutor {
	private readonly maxOutputBytes: number;

	constructor(options: NodeSecurityToolExecutorOptions = {}) {
		this.maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
	}

	run(
		command: string,
		args: readonly string[],
		options: { cwd: string; signal?: AbortSignal; timeoutMs: number },
	): Promise<SecurityToolCommandResult> {
		return new Promise((resolve, reject) => {
			const startedAt = Date.now();
			let timedOut = false;
			let settled = false;
			const stdout: Buffer[] = [];
			const stderr: Buffer[] = [];
			const child = spawn(command, [...args], { cwd: options.cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
			const timeout = setTimeout(() => {
				timedOut = true;
				child.kill("SIGTERM");
			}, options.timeoutMs);
			const abort = (): void => {
				child.kill("SIGTERM");
			};
			if (options.signal?.aborted) abort();
			else options.signal?.addEventListener("abort", abort, { once: true });
			child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
			child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
			child.once("error", (error: NodeJS.ErrnoException) => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				options.signal?.removeEventListener("abort", abort);
				reject(error);
			});
			child.once("close", (exitCode, signal) => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				options.signal?.removeEventListener("abort", abort);
				resolve({
					stdout: decodeOutput(stdout, this.maxOutputBytes),
					stderr: decodeOutput(stderr, this.maxOutputBytes),
					exitCode,
					signal: signal ?? undefined,
					timedOut,
					durationMs: Date.now() - startedAt,
				});
			});
		});
	}
}

export const defaultSecurityToolExecutor: SecurityToolExecutor = new NodeSecurityToolExecutor();
