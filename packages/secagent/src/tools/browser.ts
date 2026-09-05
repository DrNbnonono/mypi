import { createHash } from "node:crypto";
import type { SecurityBrowserAction, SecurityBrowserRequest } from "../browser/service.ts";
import { redactSecurityValue } from "../core/audit.ts";
import type { SecurityToolMetadata } from "../core/types.ts";
import type { SecurityToolAdapter, SecurityToolExecutionResult } from "./adapter.ts";
import { hashSecurityValue, preconditionResult, stringInput } from "./standard.ts";

const ACTIONS = new Set<SecurityBrowserAction>([
	"navigate",
	"inspect_dom",
	"click",
	"fill",
	"submit",
	"storage",
	"network_log",
	"console_log",
	"websocket_log",
	"screenshot",
]);

function browserRequest(input: Record<string, unknown>): SecurityBrowserRequest {
	const action = stringInput(input, "action") as SecurityBrowserAction | undefined;
	const target = stringInput(input, "target") ?? stringInput(input, "url");
	if (!action || !ACTIONS.has(action)) throw new Error("unsupported browser action");
	if (!target) throw new Error("browser target is required");
	const parsed = new URL(target);
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
		throw new Error("browser target must use HTTP or HTTPS");
	const selector = stringInput(input, "selector");
	if (["click", "fill", "submit"].includes(action) && !selector) throw new Error(`${action} requires a selector`);
	const value = typeof input.value === "string" ? input.value : undefined;
	if (action === "fill" && value === undefined) throw new Error("fill requires a value");
	const limit = input.limit;
	if (limit !== undefined && (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 1_000))
		throw new Error("browser limit must be an integer between 1 and 1000");
	return { action, target: parsed.toString(), selector, value, limit };
}

export function createBrowserAdapter(metadata: SecurityToolMetadata): SecurityToolAdapter {
	return {
		metadata,
		extractTargets: (input) => {
			try {
				return [browserRequest(input).target];
			} catch {
				return [];
			}
		},
		async checkAvailability(context) {
			if (!context.browser)
				return {
					available: false,
					diagnostic: { code: "missing", message: "Isolated Playwright service is not configured" },
				};
			const result = await context.browser.checkAvailability(context.signal);
			return result.available
				? { available: true, version: result.version }
				: {
						available: false,
						diagnostic: { code: "missing", message: result.diagnostic ?? "Playwright service is unavailable" },
					};
		},
		async checkPreconditions(input, context) {
			if (!context.browser) return ["Isolated Playwright service is not configured"];
			try {
				browserRequest(input);
				return [];
			} catch (error) {
				return [error instanceof Error ? error.message : String(error)];
			}
		},
		async execute(input, context): Promise<SecurityToolExecutionResult> {
			if (!context.browser) return preconditionResult("Isolated Playwright service is not configured");
			let request: SecurityBrowserRequest;
			try {
				request = browserRequest(input);
			} catch (error) {
				return preconditionResult(error instanceof Error ? error.message : String(error));
			}
			try {
				const result = await context.browser.execute(request, {
					workspaceId: createHash("sha256").update(context.cwd).digest("hex").slice(0, 24),
					signal: context.signal,
				});
				const args = redactSecurityValue([request.action, request.target, request.selector ?? ""]);
				return {
					ok: result.ok,
					output: result,
					diagnostic: result.ok ? undefined : { code: "execution", message: result.diagnostic ?? result.summary },
					evidence: [
						{
							kind: result.artifacts?.length ? "artifact" : "observation",
							summary: result.summary,
							source: `browser:${request.action}`,
							confidence: result.ok ? 0.9 : 0.4,
							targetRefs: [result.url],
						},
					],
					execution: {
						command: "playwright-service",
						args,
						normalizedInputHash: hashSecurityValue(request),
						argvHash: hashSecurityValue(["playwright-service", ...args]),
						cwd: context.cwd,
						version: (await context.browser.checkAvailability(context.signal)).version,
						resultSource: "remote-target",
					},
				};
			} catch (error) {
				return {
					ok: false,
					diagnostic: { code: "execution", message: error instanceof Error ? error.message : String(error) },
					evidence: [],
				};
			}
		},
	};
}
