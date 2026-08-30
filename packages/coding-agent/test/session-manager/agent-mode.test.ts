import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertAgentModeCompatible } from "../../src/core/agent-profile.ts";
import { SessionManager } from "../../src/core/session-manager.ts";

describe("SessionManager agent mode", () => {
	it("defaults old and new sessions to coding", () => {
		expect(SessionManager.inMemory().getAgentMode()).toBe("coding");
		const dir = mkdtempSync(join(tmpdir(), "pi-agent-mode-"));
		const path = join(dir, "old.jsonl");
		writeFileSync(
			path,
			`${JSON.stringify({ type: "session", version: 3, id: "old", timestamp: new Date().toISOString(), cwd: dir })}\n`,
		);
		expect(SessionManager.open(path, dir).getAgentMode()).toBe("coding");
	});

	it("persists sec mode in the header and branched sessions", () => {
		const session = SessionManager.inMemory(process.cwd(), { agentMode: "sec" });
		expect(session.getHeader()?.agentMode).toBe("sec");
		const entryId = session.appendMessage({
			role: "user",
			content: "authorized local fixture",
			timestamp: Date.now(),
		});
		session.createBranchedSession(entryId);
		expect(session.getAgentMode()).toBe("sec");
	});

	it("rejects an explicit mode that conflicts with persisted mode", () => {
		const session = SessionManager.inMemory(process.cwd(), { agentMode: "sec" });
		expect(() => assertAgentModeCompatible(session, "coding")).toThrow("Session mode is sec");
		expect(assertAgentModeCompatible(session, "sec")).toBe("sec");
	});
});
