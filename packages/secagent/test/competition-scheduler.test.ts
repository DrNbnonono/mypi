import { describe, expect, it } from "vitest";
import { FauxCompetitionProvider } from "../src/competition/faux-provider.ts";
import { type McpCompetitionToolClient, TencentMcpCompetitionProvider } from "../src/competition/provider.ts";
import { CompetitionScheduler, rankCompetitionChallenges } from "../src/competition/scheduler.ts";
import type { SecuritySessionStore } from "../src/core/state.ts";
import type { CompetitionChallenge } from "../src/core/types.ts";
import { SecAgentRuntime } from "../src/runtime.ts";

function fauxChallenges() {
	return [
		{
			code: "web-low",
			title: "Web low",
			status: "available" as const,
			score: 50,
			flagCount: 1,
			flagsCaptured: 0,
			acceptedFlag: "flag{web-low}",
			entrypoints: ["http://127.0.0.1:18080"],
			hint: "inspect HTTP",
		},
		{
			code: "pwn-high",
			title: "Pwn high",
			status: "available" as const,
			score: 100,
			flagCount: 1,
			flagsCaptured: 0,
			acceptedFlag: "flag{pwn-high}",
			entrypoints: ["tcp://127.0.0.1:19001"],
		},
		{
			code: "locked",
			title: "Locked",
			status: "locked" as const,
			score: 500,
			flagCount: 1,
			flagsCaptured: 0,
			acceptedFlag: "flag{locked}",
			entrypoints: ["http://127.0.0.1:18082"],
		},
	];
}

describe("competition scheduler", () => {
	it("ranks available unsolved challenges by expected score value", () => {
		const ranked = rankCompetitionChallenges(fauxChallenges());
		expect(ranked.map((item) => item.code)).toEqual(["pwn-high", "web-low"]);
	});

	it("creates isolated attempts and enforces the concurrent instance limit", async () => {
		const provider = new FauxCompetitionProvider(fauxChallenges());
		const scheduler = new CompetitionScheduler(provider, {
			maxConcurrent: 1,
			callsPerSecond: 100,
			createAttemptWorkspace: async (challenge, attemptId) => ({
				workspaceRef: `/workspace/${challenge.code}/${attemptId}`,
				sessionId: `session-${attemptId}`,
			}),
		});
		await scheduler.syncChallenges();
		const attempt = await scheduler.startNext();
		expect(attempt).toMatchObject({ challengeCode: "pwn-high", status: "running" });
		expect(attempt?.workspaceRef).toContain("/workspace/pwn-high/");
		await expect(scheduler.startChallenge("web-low")).rejects.toThrow(/concurrency limit/);
	});

	it("hashes and deduplicates flags without persisting plaintext", async () => {
		const provider = new FauxCompetitionProvider(fauxChallenges());
		const scheduler = new CompetitionScheduler(provider, { callsPerSecond: 100 });
		await scheduler.syncChallenges();
		await scheduler.startChallenge("web-low");
		const result = await scheduler.submitFlag("web-low", "flag{web-low}", ["evidence-1"]);
		expect(result.correct).toBe(true);
		const serialized = JSON.stringify(scheduler.snapshot());
		expect(serialized).not.toContain("flag{web-low}");
		expect(scheduler.snapshot().submissions[0]).toMatchObject({ correct: true, evidenceIds: ["evidence-1"] });
		await expect(scheduler.submitFlag("web-low", "flag{web-low}")).rejects.toThrow(/running attempt|already/);
	});

	it("keeps hints disabled by default and resumes a paused attempt", async () => {
		const provider = new FauxCompetitionProvider(fauxChallenges());
		const scheduler = new CompetitionScheduler(provider, { callsPerSecond: 100 });
		await scheduler.syncChallenges();
		const attempt = await scheduler.startChallenge("web-low");
		await expect(scheduler.viewHint("web-low")).rejects.toThrow(/disabled/);
		await scheduler.pauseChallenge("web-low");
		expect(scheduler.snapshot().attempts[0]?.status).toBe("paused");
		const resumed = await scheduler.resumeChallenge("web-low");
		expect(resumed.id).toBe(attempt.id);
		expect(resumed.status).toBe("running");
		const restarted = await scheduler.restartChallenge("web-low");
		expect(restarted.id).not.toBe(attempt.id);
	});
});

class MemoryStore implements SecuritySessionStore {
	readonly entries: Array<{ type: string; customType?: string; data?: unknown }> = [];
	getBranch(): Array<{ type: string; customType?: string; data?: unknown }> {
		return [...this.entries];
	}
	appendCustomEntry(customType: string, data?: unknown): string {
		this.entries.push({ type: "custom", customType, data });
		return String(this.entries.length);
	}
}

describe("competition runtime integration", () => {
	it("persists platform state and authorizes only provider-returned entrypoints", async () => {
		const store = new MemoryStore();
		const provider = new FauxCompetitionProvider(fauxChallenges());
		const runtime = new SecAgentRuntime(store, {
			competitionProvider: provider,
			competitionCallsPerSecond: 100,
		});
		await runtime.command({ type: "competition_sync" });
		await runtime.command({ type: "competition_start", code: "web-low" });
		const snapshot = runtime.snapshot();
		expect(snapshot.state.competition?.attempts[0]).toMatchObject({ status: "running", challengeCode: "web-low" });
		expect(snapshot.state.scope).toMatchObject({ authorizationSource: "competition-provider:faux" });
		expect(snapshot.state.scope.targets.map((target) => target.value)).toEqual(["127.0.0.1"]);
		const resumed = new SecAgentRuntime(store, {
			competitionProvider: provider,
			competitionCallsPerSecond: 100,
		});
		expect(resumed.snapshot().state.competition?.attempts[0]?.status).toBe("running");
	});
});

class FakeMcpClient implements McpCompetitionToolClient {
	readonly calls: Array<{ name: string; arguments_: Record<string, unknown> }> = [];
	callTool(name: string, arguments_: Record<string, unknown>): Promise<unknown> {
		this.calls.push({ name, arguments_ });
		if (name === "list_challenges")
			return Promise.resolve({
				content: [
					{
						type: "text",
						text: JSON.stringify({
							challenges: [{ code: "web-1", title: "Web", flag_count: 2, flag_got_count: 1, score: 100 }],
						}),
					},
				],
			});
		if (name === "start_challenge") return Promise.resolve({ data: ["127.0.0.1:18080"], code: 0 });
		if (name === "submit_flag")
			return Promise.resolve({ code: 0, data: { correct: true, message: "ok", flag_count: 2, flag_got_count: 2 } });
		if (name === "view_hint") return Promise.resolve({ code: 0, data: { hint_content: "hint" } });
		return Promise.resolve({ code: 0, data: null });
	}
}

describe("Tencent MCP competition provider", () => {
	it("maps the five official tool operations into normalized types", async () => {
		const client = new FakeMcpClient();
		const provider = new TencentMcpCompetitionProvider(client);
		const challenges = await provider.listChallenges();
		expect(challenges[0]).toMatchObject<Partial<CompetitionChallenge>>({
			code: "web-1",
			flagCount: 2,
			flagsCaptured: 1,
		});
		expect((await provider.startChallenge("web-1")).entrypoints).toEqual(["127.0.0.1:18080"]);
		expect((await provider.submitFlag("web-1", "flag{x}")).correct).toBe(true);
		expect((await provider.viewHint("web-1")).penaltyPercent).toBe(10);
		await provider.stopChallenge("web-1");
		expect(client.calls.map((call) => call.name)).toEqual([
			"list_challenges",
			"start_challenge",
			"submit_flag",
			"view_hint",
			"stop_challenge",
		]);
	});
});
