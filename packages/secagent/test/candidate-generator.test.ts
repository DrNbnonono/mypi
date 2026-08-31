import { describe, expect, it } from "vitest";
import { generateCandidateActions } from "../src/core/candidate-generator.ts";
import { createInitialSecurityState } from "../src/core/state.ts";

describe("state-aware candidate generation", () => {
	it("withholds network execution strategies until scope is explicit", () => {
		const state = createInitialSecurityState();
		state.task = {
			id: "task",
			goal: "map a lab host",
			scenario: "penetration-test",
			assets: [],
			constraints: [],
			successCriteria: [],
			declaredAuthorization: [],
			pendingConfirmations: [],
			createdAt: "2026-08-30T00:00:00Z",
		};
		state.stage = "recon";
		const withoutScope = generateCandidateActions(state);
		expect(withoutScope.candidates.some((candidate) => candidate.tool === "nmap")).toBe(false);
		expect(withoutScope.gaps.some((gap) => /scope/i.test(gap))).toBe(true);
		state.scope.targets = [{ id: "scope-1", kind: "ipv4", value: "10.0.0.5" }];
		const withScope = generateCandidateActions(state);
		expect(withScope.candidates.some((candidate) => candidate.tool === "nmap")).toBe(true);
		expect(
			withScope.candidates.every(
				(candidate) => candidate.tool !== "nmap" || candidate.targets?.includes("10.0.0.5"),
			),
		).toBe(true);
	});

	it("generates binary strategies for a reverse CTF without creating a CTF agent", () => {
		const state = createInitialSecurityState();
		state.task = {
			id: "task",
			goal: "reverse the challenge",
			scenario: "ctf",
			assets: [{ id: "a1", name: "sample", kind: "unknown", path: "/workspace/sample" }],
			constraints: [],
			successCriteria: [],
			declaredAuthorization: [],
			pendingConfirmations: [],
			createdAt: "2026-08-30T00:00:00Z",
		};
		state.ctfProfile = {
			kind: "reverse",
			objective: state.task.goal,
			recommendedCapabilities: ["binary-triage", "reverse-analysis"],
			flagPatterns: [],
			expectedEvidence: [],
			createdAt: "2026-08-30T00:00:00Z",
		};
		state.stage = "analysis";
		const generated = generateCandidateActions(state);
		expect(generated.candidates.some((candidate) => candidate.tool === "readelf")).toBe(true);
		expect(generated.candidates.some((candidate) => candidate.tool === "objdump")).toBe(true);
		expect(generated.candidates.some((candidate) => candidate.id.includes("ctf-specialist"))).toBe(false);
	});

	it("only exposes FFUF when a deterministic in-workspace wordlist is available", () => {
		const state = createInitialSecurityState();
		state.task = {
			id: "web",
			goal: "discover paths",
			scenario: "web-security",
			assets: [],
			constraints: [],
			successCriteria: [],
			declaredAuthorization: [],
			pendingConfirmations: [],
			createdAt: "2026-08-30T00:00:00Z",
		};
		state.stage = "recon";
		state.scope.targets = [{ id: "scope", kind: "url", value: "http://127.0.0.1/" }];
		const withoutWordlist = generateCandidateActions(state);
		expect(withoutWordlist.candidates.some((candidate) => candidate.tool === "ffuf")).toBe(false);
		expect(withoutWordlist.gaps.some((gap) => /ffuf.*wordlist/i.test(gap))).toBe(true);
		state.task.assets.push({ id: "wordlist", name: "paths-wordlist.txt", kind: "text", path: "paths-wordlist.txt" });
		expect(generateCandidateActions(state).candidates.some((candidate) => candidate.tool === "ffuf")).toBe(true);
	});

	it("does not repeat an already successful deterministic candidate", () => {
		const state = createInitialSecurityState();
		state.task = {
			id: "web",
			goal: "fingerprint service",
			scenario: "web-security",
			assets: [],
			constraints: [],
			successCriteria: [],
			declaredAuthorization: [],
			pendingConfirmations: [],
			createdAt: "2026-08-30T00:00:00Z",
		};
		state.stage = "recon";
		state.scope.targets = [{ id: "scope", kind: "url", value: "http://127.0.0.1/" }];
		const first = generateCandidateActions(state).candidates.find((candidate) => candidate.tool === "httpx");
		expect(first).toBeDefined();
		if (!first) return;
		state.decisions.push({
			id: "d1",
			createdAt: "2026-08-30T00:00:01Z",
			goal: state.task.goal,
			stage: "recon",
			evidenceIds: [],
			candidates: [{ ...first, risk: 0.3, score: 0.8 }],
			selectedActionId: first.id,
			resultStatus: "succeeded",
		});
		expect(generateCandidateActions(state).candidates.some((candidate) => candidate.id === first.id)).toBe(false);
	});
});
