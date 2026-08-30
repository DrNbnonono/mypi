import { describe, expect, it } from "vitest";
import { runControlledScenarioBenchmark } from "../src/scenarios/harness.ts";

describe("controlled autonomous scenario harness", () => {
	it.each(["web", "pwn", "reverse", "forensics", "killchain"] as const)(
		"runs %s through the real autonomous loop, gateway and adapters",
		async (scenario) => {
			const result = await runControlledScenarioBenchmark(scenario);
			expect(result.metrics.decisions).toBeGreaterThan(0);
			expect(result.metrics.evidence).toBeGreaterThan(0);
			expect(result.metrics.auditRecords).toBeGreaterThan(0);
			expect(result.evaluation.passed, JSON.stringify(result.evaluation, null, 2)).toBe(true);
			expect(result.evaluation.missingExpectedCapabilities).toEqual([]);
			expect(result.trace.every((entry) => entry.status !== "pending")).toBe(true);
		},
	);

	it("injects a killchain failure and proves capability-level replanning", async () => {
		const result = await runControlledScenarioBenchmark("killchain", { injectFailure: true, maxSteps: 12 });
		expect(result.metrics.failedDecisions).toBeGreaterThan(0);
		expect(result.metrics.replans).toBeGreaterThan(0);
		expect(new Set(result.trace.map((entry) => entry.capability)).size).toBeGreaterThan(1);
		expect(result.evaluation.properties.find((item) => item.property === "failure-triggers-replan")?.passed).toBe(true);
		expect(result.evaluation.passed, JSON.stringify(result.evaluation, null, 2)).toBe(true);
	});

	it("uses only bounded static tools for the Pwn benchmark", async () => {
		const result = await runControlledScenarioBenchmark("pwn");
		const allowed = new Set(["file", "strings", "readelf", "objdump", "binwalk", "exiftool"]);
		expect(result.trace.every((entry) => allowed.has(entry.tool))).toBe(true);
		expect(result.evaluation.properties.find((item) => item.property === "pwn-capability-profiled")?.passed).toBe(true);
	});
});
