import { spawn } from "node:child_process";
import type { SecurityToolCommandResult, SecurityToolExecutor } from "./adapter.ts";

const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;

interface BoundedOutput {
	chunks: Buffer[];
	bytes: number;
	truncated: boolean;
}

function appendOutput(output: BoundedOutput, chunk: Buffer, maxOutputBytes: number): void {
	const remaining = maxOutputBytes - output.bytes;
	if (remaining <= 0) {
		output.truncated = true;
		return;
	}
	const selected = chunk.subarray(0, remaining);
	output.chunks.push(selected);
	output.bytes += selected.byteLength;
	if (selected.byteLength < chunk.byteLength) output.truncated = true;
}

function decodeOutput(output: BoundedOutput): string {
	return Buffer.concat(output.chunks, output.bytes).toString("utf8");
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
			let forceKill: NodeJS.Timeout | undefined;
			const stdout: BoundedOutput = { chunks: [], bytes: 0, truncated: false };
			const stderr: BoundedOutput = { chunks: [], bytes: 0, truncated: false };
			const child = spawn(command, [...args], {
				cwd: options.cwd,
				shell: false,
				detached: process.platform !== "win32",
				stdio: ["ignore", "pipe", "pipe"],
			});
			const terminate = (): void => {
				if (process.platform !== "win32" && child.pid !== undefined) {
					try {
						process.kill(-child.pid, "SIGTERM");
					} catch {
						child.kill("SIGTERM");
					}
				} else {
					child.kill("SIGTERM");
				}
				forceKill = setTimeout(() => {
					if (settled) return;
					if (process.platform !== "win32" && child.pid !== undefined) {
						try {
							process.kill(-child.pid, "SIGKILL");
						} catch {
							child.kill("SIGKILL");
						}
					} else child.kill("SIGKILL");
				}, 1_000);
			};
			const timeout = setTimeout(() => {
				timedOut = true;
				terminate();
			}, options.timeoutMs);
			const abort = (): void => {
				terminate();
			};
			if (options.signal?.aborted) abort();
			else options.signal?.addEventListener("abort", abort, { once: true });
			child.stdout.on("data", (chunk: Buffer) => appendOutput(stdout, chunk, this.maxOutputBytes));
			child.stderr.on("data", (chunk: Buffer) => appendOutput(stderr, chunk, this.maxOutputBytes));
			child.once("error", (error: NodeJS.ErrnoException) => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				if (forceKill) clearTimeout(forceKill);
				options.signal?.removeEventListener("abort", abort);
				reject(error);
			});
			child.once("close", (exitCode, signal) => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				if (forceKill) clearTimeout(forceKill);
				options.signal?.removeEventListener("abort", abort);
				resolve({
					stdout: decodeOutput(stdout),
					stderr: decodeOutput(stderr),
					exitCode,
					signal: signal ?? undefined,
					timedOut,
					durationMs: Date.now() - startedAt,
					stdoutTruncated: stdout.truncated,
					stderrTruncated: stderr.truncated,
				});
			});
		});
	}
}

export const defaultSecurityToolExecutor: SecurityToolExecutor = new NodeSecurityToolExecutor();
