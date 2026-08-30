import { describe, expect, it } from "vitest";
import { scoreCandidate } from "../src/core/planner.ts";
import { assessToolRisk } from "../src/core/policy.ts";
import { extractMcpNetworkTargets, resolveMcpProxyCall } from "../src/integrations/mcp-policy.ts";
import { extractShellExecutables, getSecurityToolMetadata, resolveToolCall } from "../src/tools/registry.ts";

describe("registry and MCP", () => {
	it("resolves aliases, wrappers, pipelines, and conservative unknown tools", () => {
		expect(getSecurityToolMetadata("netcat")?.name).toBe("nc");
		expect(extractShellExecutables("sudo timeout 10 nmap 10.0.0.1 | curl https://example.com")).toEqual([
			"nmap",
			"curl",
		]);
		expect(
			resolveToolCall("bash", { command: "curl https://example.com | sqlmap -u https://example.com" }).baseRisk,
		).toBe("P3");
		expect(resolveToolCall("unregistered", {}).baseRisk).toBe("P2");
	});

	it("does not allow model risk hints below registry risk", () => {
		expect(
			scoreCandidate({
				id: "a",
				tool: "sqlmap",
				description: "verify",
				goalRelevance: 1,
				informationGain: 1,
				confidence: 1,
				riskHint: 0,
				cost: 0,
				preconditions: [],
			}).risk,
		).toBe(1);
		expect(assessToolRisk("bash", { command: "rm -rf /tmp/example" }).level).toBe("P3");
	});

	it("classifies MCP operations and nested targets", () => {
		expect(resolveMcpProxyCall({ search: "browser" }).baseRisk).toBe("P0");
		expect(resolveMcpProxyCall({ tool: "docs_update_page", args: { id: "1" } }).baseRisk).toBe("P2");
		expect(resolveMcpProxyCall({ tool: "github_delete_repository", args: {} }).baseRisk).toBe("P3");
		expect(extractMcpNetworkTargets({ tool: "navigate", args: JSON.stringify({ target: "10.20.30.17" }) })).toEqual([
			"10.20.30.17",
		]);
	});
});
