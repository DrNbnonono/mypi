import assert from "node:assert/strict";
import test from "node:test";
import { assessToolScope } from "../core/scope.ts";
import type { SecurityScope } from "../core/types.ts";
import { extractMcpNetworkTargets, resolveMcpProxyCall } from "../integrations/mcp-policy.ts";

const scope: SecurityScope = {
	targets: [
		{ id: "domain", kind: "domain", value: "example.com" },
		{ id: "cidr", kind: "cidr", value: "10.20.30.0/24" },
	],
};

test("MCP search and describe operations remain low-risk discovery", () => {
	const search = resolveMcpProxyCall({ search: "screenshot navigate" });
	assert.equal(search.baseRisk, "P0");
	assert.equal(search.requiresScope, false);

	const describe = resolveMcpProxyCall({ describe: "browser_navigate" });
	assert.equal(describe.baseRisk, "P0");
	assert.equal(describe.requiresScope, false);
});

test("MCP mutating and destructive tool names receive conservative risk floors", () => {
	assert.equal(resolveMcpProxyCall({ tool: "docs_update_page", args: { id: "1" } }).baseRisk, "P2");
	assert.equal(resolveMcpProxyCall({ tool: "github_delete_repository", args: { owner: "demo" } }).baseRisk, "P3");
	assert.equal(resolveMcpProxyCall({ tool: "docs_get_page", args: { id: "1" } }).baseRisk, "P1");
});

test("MCP target extraction handles nested objects and JSON string args", () => {
	const nested = extractMcpNetworkTargets({
		tool: "browser_navigate",
		args: { request: { target_url: "https://api.example.com/admin" } },
	});
	assert.deepEqual(nested, ["https://api.example.com/admin", "api.example.com"]);

	const encoded = extractMcpNetworkTargets({
		tool: "probe",
		args: JSON.stringify({ target: "10.20.30.17" }),
	});
	assert.deepEqual(encoded, ["10.20.30.17"]);
});

test("MCP tool calls with in-scope network targets are allowed by scope policy", () => {
	const result = assessToolScope(
		"mcp",
		{ tool: "browser_navigate", args: { url: "https://api.example.com/health" } },
		scope,
	);
	assert.equal(result.required, true);
	assert.equal(result.allowed, true);
});

test("MCP tool calls with out-of-scope targets fail closed", () => {
	const result = assessToolScope(
		"mcp",
		{ tool: "browser_navigate", args: { url: "https://example.net/health" } },
		scope,
	);
	assert.equal(result.required, true);
	assert.equal(result.allowed, false);
	assert.match(result.reasons.join(" "), /out-of-scope/);
});
