import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateCandidateActions } from "../src/core/candidate-generator.ts";
import { challengeKnowledgeSpace, SecurityKnowledgeStore, scopeKnowledgeSpace } from "../src/core/knowledge-store.ts";
import { createActionPathKey, createSearchFact, createSearchPath } from "../src/core/search-board.ts";
import type { SecuritySessionStore } from "../src/index.ts";
import { SecAgentRuntime } from "../src/runtime.ts";

class MemoryStore implements SecuritySessionStore {
	readonly entries: Array<{ type: string; customType?: string; data?: unknown }> = [];
	getBranch() {
		return [...this.entries];
	}
	appendCustomEntry(customType: string, data?: unknown): string {
		this.entries.push({ type: "custom", customType, data });
		return String(this.entries.length);
	}
}

const temporary: string[] = [];
afterEach(async () => {
	for (const directory of temporary.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe("knowledge store isolation", () => {
	it("hydrates explored paths into a new session and skips that candidate", async () => {
		const directory = await mkdtemp(join(tmpdir(), "pi-secagent-knowledge-"));
		temporary.push(directory);
		const dbPath = join(directory, "knowledge.sqlite");
		const store = new SecurityKnowledgeStore(dbPath);
		const space = challengeKnowledgeSpace("faux", "web-1");
		const pathKey = createActionPathKey({
			tool: "httpx",
			capability: "web-enumeration",
			targets: ["http://127.0.0.1/"],
			normalizedInput: { target: "http://127.0.0.1/", followRedirects: true },
		});
		store.upsertFact(
			space,
			createSearchFact({
				kind: "http-surface",
				statement: "HTTP surface already mapped",
				targetRefs: ["http://127.0.0.1/"],
				sourceTool: "httpx",
				sourceCapability: "web-enumeration",
				origin: "session",
			}),
			"session-a",
		);
		store.upsertPath(
			space,
			createSearchPath({
				pathKey,
				tool: "httpx",
				capability: "web-enumeration",
				status: "explored",
				summary: "httpx already ran",
			}),
		);
		store.close();

		const runtime = new SecAgentRuntime(new MemoryStore(), { knowledgeDbPath: dbPath });
		try {
			runtime.append({
				type: "task_started",
				createdAt: "2026-09-05T00:00:00Z",
				task: {
					id: "task",
					goal: "resume web",
					scenario: "web-security",
					assets: [],
					constraints: [],
					successCriteria: [],
					declaredAuthorization: [],
					pendingConfirmations: [],
					createdAt: "2026-09-05T00:00:00Z",
				},
			});
			runtime.append({
				type: "competition_state_changed",
				createdAt: "2026-09-05T00:00:01Z",
				competition: {
					providerId: "faux",
					challenges: [{ code: "web-1", title: "web", status: "running", flagCount: 1, flagsCaptured: 0 }],
					attempts: [
						{
							id: "a1",
							challengeCode: "web-1",
							status: "running",
							entrypoints: ["http://127.0.0.1/"],
							workspaceRef: "/workspace/web-1/a1",
							startedAt: "2026-09-05T00:00:01Z",
							updatedAt: "2026-09-05T00:00:01Z",
						},
					],
					submissions: [],
					maxConcurrent: 3,
					hintsAllowed: false,
					updatedAt: "2026-09-05T00:00:01Z",
				},
			});
			runtime.append({
				type: "scope_set",
				createdAt: "2026-09-05T00:00:02Z",
				scope: { targets: [{ id: "s", kind: "url", value: "http://127.0.0.1/" }] },
			});
			const generated = generateCandidateActions(runtime.snapshot().state);
			expect(
				generated.candidates.some((candidate) => candidate.tool === "httpx" && candidate.pathKey === pathKey),
			).toBe(false);
			expect(runtime.snapshot().state.searchBoard.facts.some((fact) => fact.origin === "knowledge")).toBe(true);
		} finally {
			runtime.dispose();
		}
	});

	it("does not leak facts across challenges or scopes", async () => {
		const directory = await mkdtemp(join(tmpdir(), "pi-secagent-knowledge-iso-"));
		temporary.push(directory);
		const dbPath = join(directory, "knowledge.sqlite");
		const store = new SecurityKnowledgeStore(dbPath);
		store.upsertFact(
			challengeKnowledgeSpace("faux", "web-1"),
			createSearchFact({
				kind: "http-surface",
				statement: "challenge one only",
				targetRefs: ["http://127.0.0.1/"],
				sourceCapability: "web-enumeration",
				origin: "session",
			}),
		);
		const pentestSpace = scopeKnowledgeSpace({
			targets: [{ id: "s", kind: "ipv4", value: "10.0.0.5" }],
		});
		expect(pentestSpace).toBeDefined();
		if (!pentestSpace) return;
		store.upsertFact(
			pentestSpace,
			createSearchFact({
				kind: "service-observed",
				statement: "pentest host only",
				targetRefs: ["10.0.0.5"],
				sourceCapability: "network-enumeration",
				origin: "session",
			}),
		);
		expect(store.load(challengeKnowledgeSpace("faux", "web-2")).facts).toHaveLength(0);
		expect(store.load(challengeKnowledgeSpace("faux", "web-1")).facts[0]?.statement).toContain("challenge one");
		expect(store.load(pentestSpace).facts[0]?.statement).toContain("pentest host");
		store.close();
	});

	it("redacts secrets and flags before persistence", async () => {
		const directory = await mkdtemp(join(tmpdir(), "pi-secagent-knowledge-redact-"));
		temporary.push(directory);
		const dbPath = join(directory, "knowledge.sqlite");
		const store = new SecurityKnowledgeStore(dbPath);
		const space = challengeKnowledgeSpace("faux", "web-1");
		store.upsertFact(
			space,
			createSearchFact({
				kind: "http-surface",
				statement: "token=secret-value flag{should-not-persist} Authorization: Bearer abc.def.ghi",
				targetRefs: ["http://127.0.0.1/"],
				sourceCapability: "web-enumeration",
				origin: "session",
			}),
		);
		store.upsertFact(
			space,
			createSearchFact({
				kind: "http-surface",
				statement: "credential secret://do-not-store",
				targetRefs: ["http://127.0.0.1/"],
				sourceCapability: "web-enumeration",
				origin: "session",
			}),
		);
		const loaded = store.load(space);
		expect(JSON.stringify(loaded)).not.toContain("should-not-persist");
		expect(JSON.stringify(loaded)).not.toContain("secret://do-not-store");
		expect(JSON.stringify(loaded)).not.toMatch(/Bearer\s+[A-Za-z0-9._~+/=-]+/);
		store.close();
	});
});
