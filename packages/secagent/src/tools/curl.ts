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

const CURL_IGNORED_FLAGS = new Set([
	"-s",
	"--silent",
	"-S",
	"--show-error",
	"-k",
	"--insecure",
	"-i",
	"--include",
	"-v",
	"--verbose",
	"-#",
	"--progress-bar",
	"--compressed",
	"-N",
	"--no-buffer",
	"-4",
	"--ipv4",
	"-6",
	"--ipv6",
	"--http1.0",
	"--http1.1",
	"--http2",
	"--http2-prior-knowledge",
]);

const CURL_IGNORED_VALUE_FLAGS = new Set([
	"-m",
	"--max-time",
	"--connect-timeout",
	"--retry",
	"--keepalive-time",
	"--speed-time",
	"--speed-limit",
]);

const CURL_REJECTED_FLAGS = new Map([
	["-b", "use --header 'Cookie: ...' instead"],
	["--cookie", "use --header 'Cookie: ...' instead"],
	["-x", "proxies are not allowed through the audited curl adapter"],
	["--proxy", "proxies are not allowed through the audited curl adapter"],
	["-o", "writing the response body to a file is not supported"],
	["--output", "writing the response body to a file is not supported"],
	["-T", "uploading files is not supported"],
	["--upload-file", "uploading files is not supported"],
	["-F", "multipart forms are not supported; send a request body with --data"],
	["--form", "multipart forms are not supported; send a request body with --data"],
	["-G", "converting --data to a query string is not supported"],
	["--get", "converting --data to a query string is not supported"],
]);

function tokenizeCommandLine(command: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let quote: '"' | "'" | undefined;
	let hasToken = false;
	for (const char of command) {
		if (quote) {
			if (char === quote) quote = undefined;
			else current += char;
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			hasToken = true;
			continue;
		}
		if (/\s/.test(char)) {
			if (hasToken) tokens.push(current);
			current = "";
			hasToken = false;
			continue;
		}
		current += char;
		hasToken = true;
	}
	if (quote) throw new Error("curl command has an unterminated quote");
	if (hasToken) tokens.push(current);
	return tokens;
}

export function parseCurlCommand(command: string): Record<string, unknown> {
	const tokens = tokenizeCommandLine(command).slice(1); // drop argv[0] (curl)
	const parsed: {
		target?: string;
		method?: string;
		headers?: Record<string, string>;
		data?: string;
		followRedirects?: boolean;
	} = {};
	const setHeader = (value: string) => {
		const separator = value.indexOf(":");
		if (separator <= 0) throw new Error(`curl header must look like 'Name: value', got: ${value}`);
		parsed.headers ??= {};
		parsed.headers[value.slice(0, separator).trim()] = value.slice(separator + 1).trim();
	};
	const setData = (value: string, json = false) => {
		if (value.startsWith("@")) throw new Error("reading curl request data from a file is not supported");
		parsed.data = value;
		parsed.method ??= "POST";
		if (json) {
			parsed.headers ??= {};
			parsed.headers["Content-Type"] ??= "application/json";
		}
	};
	const setMethod = (value: string) => {
		parsed.method = value.toUpperCase();
	};
	let expectsValue: ((value: string) => void) | undefined;
	const consume = (token: string) => {
		if (CURL_IGNORED_FLAGS.has(token)) return;
		const rejected = CURL_REJECTED_FLAGS.get(token);
		if (rejected) throw new Error(`unsupported curl flag '${token}': ${rejected}`);
		if (token === "-X" || token === "--request") {
			expectsValue = setMethod;
			return;
		}
		if (token === "-H" || token === "--header") {
			expectsValue = setHeader;
			return;
		}
		if (token === "-d" || token === "--data" || token === "--data-raw" || token === "--data-ascii") {
			expectsValue = (value) => setData(value);
			return;
		}
		if (token === "--json") {
			expectsValue = (value) => setData(value, true);
			return;
		}
		if (token === "--url") {
			expectsValue = (value) => {
				parsed.target = value;
			};
			return;
		}
		if (token === "-L" || token === "--location") {
			parsed.followRedirects = true;
			return;
		}
		if (token === "-I" || token === "--head") {
			parsed.method = "HEAD";
			return;
		}
		if (token === "-A" || token === "--user-agent") {
			expectsValue = (value) => setHeader(`User-Agent: ${value}`);
			return;
		}
		if (token === "-e" || token === "--referer") {
			expectsValue = (value) => setHeader(`Referer: ${value}`);
			return;
		}
		if (CURL_IGNORED_VALUE_FLAGS.has(token)) {
			expectsValue = () => {};
			return;
		}
		if (token.startsWith("http://") || token.startsWith("https://")) {
			parsed.target = token;
			return;
		}
		if (token.startsWith("--")) {
			throw new Error(
				`unsupported curl flag '${token}'; pass structured fields (target/method/headers/data) instead`,
			);
		}
		if (!token.startsWith("-")) {
			throw new Error(`unexpected curl argument '${token}'; pass the request URL as target`);
		}
		// Short-flag cluster (e.g. -sS, -sSkL, -dX?): expand character by
		// character. A value-taking flag consumes the cluster remainder when
		// attached (-d{"a":1}) and otherwise the next token (-d '{"a":1}').
		const chars = token.slice(1);
		for (let index = 0; index < chars.length; index++) {
			const flag = `-${chars[index]}`;
			const rest = chars.slice(index + 1);
			const takeValue = (): string => {
				if (rest) return rest;
				const next = tokens.shift();
				if (next === undefined) throw new Error(`curl flag '${flag}' is missing its value`);
				return next;
			};
			if (CURL_IGNORED_FLAGS.has(flag)) continue;
			if (flag === "-L") {
				parsed.followRedirects = true;
				continue;
			}
			if (flag === "-I") {
				parsed.method = "HEAD";
				continue;
			}
			const rejected = CURL_REJECTED_FLAGS.get(flag);
			if (rejected) throw new Error(`unsupported curl flag '${flag}': ${rejected}`);
			if (flag === "-X") {
				setMethod(takeValue());
				break;
			}
			if (flag === "-H") {
				setHeader(takeValue());
				break;
			}
			if (flag === "-d") {
				setData(takeValue());
				break;
			}
			if (CURL_IGNORED_VALUE_FLAGS.has(flag)) {
				if (!rest) {
					const next = tokens.shift();
					if (next === undefined) throw new Error(`curl flag '${flag}' is missing its value`);
				}
				break;
			}
			throw new Error(
				`unsupported curl flag '${flag}'; pass structured fields (target/method/headers/data) instead`,
			);
		}
	};
	const queue = tokens.slice();
	for (let token = queue.shift(); token !== undefined; token = queue.shift()) {
		if (expectsValue) {
			const handler = expectsValue;
			expectsValue = undefined;
			handler(token);
			continue;
		}
		consume(token);
	}
	return parsed;
}

function normalizeCurlInput(input: Record<string, unknown>): Record<string, unknown> {
	const command = input.command;
	if (typeof command !== "string" || !command.trim()) return input;
	try {
		const parsed = parseCurlCommand(command);
		return { ...parsed, ...input, command: undefined };
	} catch (error) {
		return { ...input, curlCommandError: error instanceof Error ? error.message : String(error) };
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
			const target = curlTarget(normalizeCurlInput(input));
			return target ? [target] : [];
		},
		checkAvailability: (context) => checkCommandAvailability("curl", context),
		async checkPreconditions(
			rawInput: Record<string, unknown>,
			_context: SecurityToolExecutionContext,
		): Promise<string[]> {
			const input = normalizeCurlInput(rawInput);
			if (typeof input.curlCommandError === "string") return [input.curlCommandError];
			if (!curlTarget(input)) return ["target must be an HTTP(S) URL"];
			try {
				curlArgs(input, curlTarget(input) as string);
			} catch (error) {
				return [error instanceof Error ? error.message : String(error)];
			}
			return adapterPreconditions(metadata, input);
		},
		async execute(
			rawInput: Record<string, unknown>,
			context: SecurityToolExecutionContext,
		): Promise<SecurityToolExecutionResult> {
			const input = normalizeCurlInput(rawInput);
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
