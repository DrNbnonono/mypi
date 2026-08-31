import { describe, expect, it } from "vitest";
import { recommendAgentDispatch } from "../src/agents/control-plane.ts";
import { applySecurityEvent, createInitialSecurityState } from "../src/core/state.ts";
import type { SecurityDelegationRecord } from "../src/core/types.ts";
import {
	buildSubagentDelegationRequest,
	parseDelegatedAgentResult,
	runSubagentDelegation,
	SUBAGENT_DELEGATION_REQUEST_EVENT,
	SUBAGENT_DELEGATION_RESPONSE_EVENT,
	type SubagentEventBus,
} from "../src/integrations/subagent-delegation.ts";

class FakeBus implements SubagentEventBus {
	private readonly listeners = new Map<string, Set<(payload: unknown) => void>>();
	on(event: string, listener: (payload: unknown) => void): () => void {
		const set = this.listeners.get(event) ?? new Set();
		set.add(listener);
		this.listeners.set(event, set);
		return () => set.delete(listener);
	}
	emit(event: string, payload: unknown): void {
		if (event === SUBAGENT_DELEGATION_REQUEST_EVENT) {
			const request = payload as { requestId: string; ownerRunId: string; nodeId: string };
			queueMicrotask(() =>
				this.emit(SUBAGENT_DELEGATION_RESPONSE_EVENT, {
					requestId: request.requestId,
					ownerRunId: request.ownerRunId,
					nodeId: request.nodeId,
					status: "completed",
					result: {
						kind: "structured",
						value: {
							status: "completed",
							summary: "reviewed",
							observations: ["fact"],
							evidence: [{ summary: "evidence", confidence: 0.9 }],
							gaps: [],
							proposedActions: ["next"],
						},
					},
					usage: {
						input: 1,
						output: 1,
						cacheRead: 0,
						cacheWrite: 0,
						cost: 0,
						turns: 1,
						toolCalls: 1,
						durationMs: 2,
					},
				}),
			);
		}
		for (const listener of this.listeners.get(event) ?? []) listener(payload);
	}
}

describe("pi-subagents structured delegation bridge", () => {
	it("keeps child execution bounded and returns structured evidence proposals", async () => {
		const state = createInitialSecurityState();
		state.goal = "Analyze a reversing challenge";
		state.ctfProfile = {
			kind: "reverse",
			objective: state.goal,
			recommendedCapabilities: ["binary-triage", "reverse-analysis"],
			flagPatterns: [],
			expectedEvidence: ["control-flow clue"],
			createdAt: "2026-08-30T00:00:00Z",
		};
		const recommendation = recommendAgentDispatch(state);
		const request = buildSubagentDelegationRequest(recommendation, "/tmp", "owner-1");
		expect(request.agent).toBe("sec-reverse");
		expect(request.toolBudget?.block).toContain("bash");
		expect(request.toolBudget?.block).toContain("security_scope");
		const response = await runSubagentDelegation(new FakeBus(), request);
		const result = parseDelegatedAgentResult(response);
		expect(response.status).toBe("completed");
		expect(result?.evidence[0]).toMatchObject({ summary: "evidence", confidence: 0.9 });
	});

	it("upserts delegation lifecycle records instead of duplicating them", () => {
		let state = createInitialSecurityState();
		const planned: SecurityDelegationRecord = {
			id: "delegation-1",
			role: "sec-analysis",
			objective: "fixture",
			status: "planned",
			evidenceIds: [],
			createdAt: "2026-08-30T00:00:00Z",
		};
		state = applySecurityEvent(state, {
			type: "delegation_recorded",
			delegation: planned,
			createdAt: planned.createdAt,
		});
		state = applySecurityEvent(state, {
			type: "delegation_recorded",
			delegation: { ...planned, status: "completed", completedAt: "2026-08-30T00:01:00Z" },
			createdAt: "2026-08-30T00:01:00Z",
		});
		expect(state.delegations).toHaveLength(1);
		expect(state.delegations[0]?.status).toBe("completed");
	});
});
