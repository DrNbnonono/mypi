export type SecurityBrowserAction =
	| "navigate"
	| "inspect_dom"
	| "click"
	| "fill"
	| "submit"
	| "storage"
	| "network_log"
	| "console_log"
	| "websocket_log"
	| "screenshot";

export interface SecurityBrowserRequest {
	action: SecurityBrowserAction;
	target: string;
	selector?: string;
	value?: string;
	limit?: number;
}

export interface SecurityBrowserArtifact {
	kind: "screenshot" | "har" | "download" | "dom";
	path: string;
	sha256: string;
	mimeType?: string;
}

export interface SecurityBrowserResult {
	ok: boolean;
	url: string;
	summary: string;
	statusCode?: number;
	data?: unknown;
	artifacts?: SecurityBrowserArtifact[];
	diagnostic?: string;
}

export interface SecurityBrowserService {
	readonly id: string;
	checkAvailability(signal?: AbortSignal): Promise<{ available: boolean; version?: string; diagnostic?: string }>;
	execute(
		request: SecurityBrowserRequest,
		options: { workspaceId: string; signal?: AbortSignal },
	): Promise<SecurityBrowserResult>;
}

export interface HttpPlaywrightBrowserServiceOptions {
	endpoint: string;
	authorization?: string;
	fetch?: typeof fetch;
}

function loopbackEndpoint(endpoint: string): URL {
	const parsed = new URL(endpoint);
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
		throw new Error("Playwright service endpoint must use HTTP or HTTPS");
	if (!["127.0.0.1", "::1", "localhost"].includes(parsed.hostname))
		throw new Error("Playwright service endpoint must be bound to loopback");
	return parsed;
}

export class HttpPlaywrightBrowserService implements SecurityBrowserService {
	readonly id = "playwright-http";
	private readonly endpoint: URL;
	private readonly authorization: string | undefined;
	private readonly fetchImplementation: typeof fetch;

	constructor(options: HttpPlaywrightBrowserServiceOptions) {
		this.endpoint = loopbackEndpoint(options.endpoint);
		this.authorization = options.authorization;
		this.fetchImplementation = options.fetch ?? fetch;
	}

	async checkAvailability(
		signal?: AbortSignal,
	): Promise<{ available: boolean; version?: string; diagnostic?: string }> {
		try {
			const response = await this.fetchImplementation(new URL("/health", this.endpoint), {
				headers: this.headers(),
				signal,
			});
			if (!response.ok)
				return { available: false, diagnostic: `Playwright service health returned HTTP ${response.status}` };
			const body = (await response.json()) as unknown;
			const version =
				body && typeof body === "object" && typeof (body as Record<string, unknown>).version === "string"
					? ((body as Record<string, unknown>).version as string)
					: undefined;
			return { available: true, version };
		} catch (error) {
			return { available: false, diagnostic: error instanceof Error ? error.message : String(error) };
		}
	}

	async execute(
		request: SecurityBrowserRequest,
		options: { workspaceId: string; signal?: AbortSignal },
	): Promise<SecurityBrowserResult> {
		const response = await this.fetchImplementation(new URL("/v1/execute", this.endpoint), {
			method: "POST",
			headers: { ...this.headers(), "Content-Type": "application/json" },
			body: JSON.stringify({ workspaceId: options.workspaceId, request }),
			signal: options.signal,
		});
		const body = (await response.json()) as unknown;
		if (!body || typeof body !== "object" || Array.isArray(body))
			throw new Error("Playwright service returned an invalid response");
		if (!response.ok) {
			const message = (body as Record<string, unknown>).error;
			throw new Error(typeof message === "string" ? message : `Playwright service returned HTTP ${response.status}`);
		}
		return body as SecurityBrowserResult;
	}

	private headers(): Record<string, string> {
		return this.authorization ? { Authorization: this.authorization } : {};
	}
}
