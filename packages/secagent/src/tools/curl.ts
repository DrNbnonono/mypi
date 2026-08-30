import type { SecurityToolMetadata } from "../core/types.ts";
import type { SecurityToolAdapter, SecurityToolExecutionContext, SecurityToolExecutionResult } from "./adapter.ts";
import {
	adapterPreconditions,
	checkCommandAvailability,
	preconditionResult,
	runStandardTool,
	stringInput,
} from "./standard.ts";

function curlTarget(input: Record<string, unknown>): string | undefined {
	const raw = stringInput(input, "target") ?? stringInput(input, "url");
	if (!raw) return undefined;
	try {
		const url = new URL(raw);
		return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
	} catch {
		return undefined;
	}
}

function curlArgs(input: Record<string, unknown>, target: string): string[] {
	const args = ["--silent", "--show-error"];
	if (input.followRedirects === true) args.push("--location");
	const method = stringInput(input, "method") ?? "GET";
	if (!/^[A-Za-z]+$/.test(method) || method.length > 16) throw new Error("method must be a short HTTP method name");
	if (method.toUpperCase() !== "GET") args.push("--request", method.toUpperCase());
	const headers = input.headers;
	if (headers !== undefined) {
		if (typeof headers !== "object" || headers === null || Array.isArray(headers))
			throw new Error("headers must be an object");
		for (const [name, value] of Object.entries(headers)) {
			if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || typeof value !== "string" || /[\r\n]/.test(value))
				throw new Error("headers contain an invalid name or value");
			args.push("--header", `${name}: ${value}`);
		}
	}
	const data = input.data;
	if (data !== undefined) {
		if (typeof data !== "string") throw new Error("data must be a string");
		args.push("--data", data);
	}
	return [...args, "--write-out", "\n__PI_CURL_STATUS__:%{http_code}", target];
}

function normalizeCurl(output: Record<string, unknown>): Record<string, unknown> {
	const stdout = typeof output.stdout === "string" ? output.stdout : "";
	const marker = stdout.lastIndexOf("\n__PI_CURL_STATUS__:");
	const statusText = marker >= 0 ? stdout.slice(marker + "\n__PI_CURL_STATUS__:".length).trim() : undefined;
	return {
		...output,
		body: marker >= 0 ? stdout.slice(0, marker) : stdout,
		statusCode: statusText && /^\d{3}$/.test(statusText) ? Number(statusText) : undefined,
	};
}

export function createCurlAdapter(metadata: SecurityToolMetadata): SecurityToolAdapter {
	return {
		metadata,
		extractTargets: (input) => {
			const target = curlTarget(input);
			return target ? [target] : [];
		},
		checkAvailability: (context) => checkCommandAvailability("curl", context),
		async checkPreconditions(
			input: Record<string, unknown>,
			_context: SecurityToolExecutionContext,
		): Promise<string[]> {
			if (!curlTarget(input)) return ["target must be an HTTP(S) URL"];
			try {
				curlArgs(input, curlTarget(input) as string);
			} catch (error) {
				return [error instanceof Error ? error.message : String(error)];
			}
			return adapterPreconditions(metadata, input);
		},
		async execute(
			input: Record<string, unknown>,
			context: SecurityToolExecutionContext,
		): Promise<SecurityToolExecutionResult> {
			const target = curlTarget(input);
			const checks = await this.checkPreconditions(input, context);
			if (!target || checks.length > 0)
				return preconditionResult(checks.join("; ") || "target must be an HTTP(S) URL");
			let args: string[];
			try {
				args = curlArgs(input, target);
			} catch (error) {
				return preconditionResult(error instanceof Error ? error.message : String(error));
			}
			return runStandardTool({
				metadata,
				command: "curl",
				args,
				targets: [target],
				input,
				context,
				normalize: normalizeCurl,
			});
		},
	};
}
