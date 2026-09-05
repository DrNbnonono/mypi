import { describe, expect, it } from "vitest";
import {
	HttpPlaywrightBrowserService,
	type SecurityBrowserRequest,
	type SecurityBrowserService,
} from "../src/browser/service.ts";
import { getSecurityToolAdapter } from "../src/tools/registry.ts";

class FakeBrowserService implements SecurityBrowserService {
	readonly id = "fake-browser";
	readonly requests: SecurityBrowserRequest[] = [];
	checkAvailability(): Promise<{ available: boolean; version?: string }> {
		return Promise.resolve({ available: true, version: "fixture-1" });
	}
	execute(request: SecurityBrowserRequest): Promise<{
		ok: boolean;
		url: string;
		summary: string;
		data: { selector?: string };
	}> {
		this.requests.push(request);
		return Promise.resolve({
			ok: true,
			url: request.target,
			summary: `${request.action} completed`,
			data: { selector: request.selector },
		});
	}
}

describe("isolated browser adapter", () => {
	it("executes only bounded high-level operations and emits provenance", async () => {
		const browser = new FakeBrowserService();
		const adapter = getSecurityToolAdapter("browser");
		const result = await adapter?.execute(
			{ action: "inspect_dom", target: "http://127.0.0.1:3000/#/search", limit: 100 },
			{ cwd: "/workspace/challenge-1", browser },
		);
		expect(result?.ok).toBe(true);
		expect(browser.requests).toEqual([
			{ action: "inspect_dom", target: "http://127.0.0.1:3000/#/search", limit: 100 },
		]);
		expect(result?.execution).toMatchObject({
			command: "playwright-service",
			version: "fixture-1",
			resultSource: "remote-target",
		});
	});

	it("rejects arbitrary actions and missing selectors", async () => {
		const browser = new FakeBrowserService();
		const adapter = getSecurityToolAdapter("browser");
		expect(
			(await adapter?.execute({ action: "evaluate", target: "http://127.0.0.1" }, { cwd: "/workspace", browser }))
				?.diagnostic?.message,
		).toMatch(/unsupported browser action/);
		expect(
			(await adapter?.execute({ action: "click", target: "http://127.0.0.1" }, { cwd: "/workspace", browser }))
				?.diagnostic?.message,
		).toMatch(/requires a selector/);
	});
});

describe("Playwright HTTP service client", () => {
	it("requires a loopback service endpoint", () => {
		expect(() => new HttpPlaywrightBrowserService({ endpoint: "http://10.0.0.2:9222" })).toThrow(/loopback/);
	});

	it("checks health and sends workspace-isolated requests", async () => {
		const calls: Array<{ url: string; init?: RequestInit }> = [];
		const fetchImplementation: typeof fetch = async (input, init) => {
			calls.push({ url: String(input), init });
			if (String(input).endsWith("/health"))
				return new Response(JSON.stringify({ version: "1.55.0" }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			return new Response(JSON.stringify({ ok: true, url: "http://127.0.0.1/", summary: "done" }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		};
		const service = new HttpPlaywrightBrowserService({
			endpoint: "http://127.0.0.1:19333",
			authorization: "Bearer fixture",
			fetch: fetchImplementation,
		});
		expect(await service.checkAvailability()).toEqual({ available: true, version: "1.55.0" });
		await service.execute({ action: "navigate", target: "http://127.0.0.1/" }, { workspaceId: "attempt-1" });
		expect(calls[1]?.url).toBe("http://127.0.0.1:19333/v1/execute");
		expect(calls[1]?.init?.body).toBe(
			JSON.stringify({
				workspaceId: "attempt-1",
				request: { action: "navigate", target: "http://127.0.0.1/" },
			}),
		);
	});
});
