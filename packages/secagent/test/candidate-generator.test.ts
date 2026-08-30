import { describe, expect, it } from "vitest";
import { generateCandidateActions } from "../src/core/candidate-generator.ts";
import { createInitialSecurityState } from "../src/core/state.ts";

describe("state-aware candidate generation", () => {
	it("withholds network execution strategies until scope is explicit", () => {
		const state = createInitialSecurityState();
		state.task = { id: "task", goal: "map a lab host", scenario: "penetration-test", assets: [], constraints: [], successCriteria: [], declaredAuthorization: [], pendingConfirmations: [], createdAt: "2026-08-30T00:00:00Z" };
		state.stage = "recon";
		const withoutScope = generateCandidateActions(state);
		expect(withoutScope.candidates.some((candidate) => candidate.tool === "nmap")).toBe(false);
		expect(withoutScope.gaps.some((gap) => /scope/i.test(gap))).toBe(true);
		state.scope.targets = [{ id: "scope-1", kind: "ipv4", value: "10.0.0.5" }];
		const withScope = generateCandidateActions(state);
		expect(withScope.candidates.some((candidate) => candidate.tool === "nmap")).toBe(true);
		expect(withScope.candidates.every((candidate) => candidate.tool !== "nmap" || candidate.targets?.includes("10.0.0.5"))).toBe(true);
	});

	it("generates binary strategies for a reverse CTF without creating a CTF agent", () => {
		const state = createInitialSecurityState();
		state.task = { id: "task", goal: "reverse the challenge", scenario: "ctf", assets: [{ id: "a1", name: "sample", kind: "unknown", path: "/workspace/sample" }], constraints: [], successCriteria: [], declaredAuthorization: [], pendingConfirmations: [], createdAt: "2026-08-30T00:00:00Z" };
		state.ctfProfile = { kind: "reverse", objective: state.task.goal, recommendedCapabilities: ["binary-triage", "reverse-analysis"], flagPatterns: [], expectedEvidence: [], createdAt: "2026-08-30T00:00:00Z" };
		state.stage = "analysis";
		const generated = generateCandidateActions(state);
		expect(generated.candidates.some((candidate) => candidate.tool === "readelf")).toBe(true);
		expect(generated.candidates.some((candidate) => candidate.tool === "objdump")).toBe(true);
		expect(generated.candidates.some((candidate) => candidate.id.includes("ctf-specialist"))).toBe(false);
	});
});
