import { describe, expect, it } from "vitest";
import { replaySecurityState, SECURITY_EVENT_ENTRY, type SecuritySessionStore } from "../src/core/state.ts";
import type { SecurityActionRecord } from "../src/core/types.ts";

class MemoryStore implements SecuritySessionStore {
	readonly entries: Array<{ type: string; customType?: string; data?: unknown }>;

	constructor(entries: Array<{ type: string; customType?: string; data?: unknown }>) {
		this.entries = entries;
	}
	getBranch(): Array<{ type: string; customType?: string; data?: unknown }> {
		return [...this.entries];
	}
	appendCustomEntry(): string {
		return "unused";
	}
}

describe("security action replay", () => {
	it("marks an interrupted started action unknown without re-executing it", () => {
		const action: SecurityActionRecord = {
			id: "action-1",
			idempotencyKey: "call-1",
			decisionId: "decision-1",
			toolName: "curl",
			status: "started",
			requestedInputHash: "hash",
			startedAt: "2026-09-04T00:00:00.000Z",
			createdAt: "2026-09-04T00:00:00.000Z",
		};
		const state = replaySecurityState(
			new MemoryStore([
				{
					type: "custom",
					customType: SECURITY_EVENT_ENTRY,
					data: { type: "action_recorded", action, createdAt: action.createdAt },
				},
			]),
		);
		expect(state.actions[0]).toMatchObject({
			status: "unknown",
			verificationRequired: true,
		});
	});
});
