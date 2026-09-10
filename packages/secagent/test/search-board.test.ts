import { describe, expect, it } from "vitest";
import {
	blockedPathKeys,
	createActionPathKey,
	createEmptySearchBoard,
	createSearchFact,
	createSearchHint,
	createSearchPath,
	deriveIntentsFromFact,
	markIntentStatus,
	upsertSearchFact,
	upsertSearchIntent,
} from "../src/core/search-board.ts";
import { applySecurityEvent, createInitialSecurityState } from "../src/core/state.ts";

describe("search board", () => {
	it("deduplicates facts by key and keeps the stronger confidence", () => {
		const board = createEmptySearchBoard();
		const first = createSearchFact({
			kind: "http-surface",
			statement: "HTTP 200 on loopback",
			targetRefs: ["http://127.0.0.1/"],
			sourceCapability: "web-enumeration",
			confidence: 0.7,
		});
		upsertSearchFact(board, first);
		const second = {
			...first,
			id: "other",
			statement: "HTTP 200 confirmed",
			confidence: 0.91,
			origin: "session" as const,
		};
		const merged = upsertSearchFact(board, second);
		expect(board.facts).toHaveLength(1);
		expect(merged.confidence).toBe(0.91);
		expect(merged.statement).toBe("HTTP 200 confirmed");
		expect(merged.id).toBe(first.id);
	});

	it("derives sibling intents from a fact without closing other branches", () => {
		const state = createInitialSecurityState();
		state.scope.targets = [{ id: "s", kind: "url", value: "http://127.0.0.1/" }];
		const fact = createSearchFact({
			kind: "service-observed",
			statement: "80/tcp open http",
			targetRefs: ["http://127.0.0.1/"],
			sourceTool: "nmap",
			sourceCapability: "network-enumeration",
		});
		const intents = deriveIntentsFromFact(state, fact);
		expect(intents.some((intent) => intent.tool === "nmap")).toBe(false);
		expect(intents.some((intent) => intent.tool === "httpx")).toBe(true);
		expect(intents.some((intent) => intent.tool === "curl")).toBe(true);
		const board = createEmptySearchBoard();
		for (const intent of intents) upsertSearchIntent(board, intent);
		const httpx = board.intents.find((intent) => intent.tool === "httpx");
		expect(httpx).toBeDefined();
		markIntentStatus(board, httpx?.id, "dead-end");
		expect(board.intents.find((intent) => intent.tool === "curl")?.status).toBe("open");
		expect(board.intents.find((intent) => intent.tool === "httpx")?.status).toBe("dead-end");
	});

	it("does not reopen a dead-end intent on merge", () => {
		const board = createEmptySearchBoard();
		const intent = {
			id: "intent:a:curl:web-request-analysis",
			statement: "Inspect HTTP",
			status: "dead-end" as const,
			parentFactKeys: ["http-surface:web-enumeration:http://127.0.0.1/"],
			tool: "curl",
			capability: "web-request-analysis",
			createdAt: "2026-09-05T00:00:00Z",
			updatedAt: "2026-09-05T00:00:00Z",
		};
		upsertSearchIntent(board, intent);
		const merged = upsertSearchIntent(board, { ...intent, status: "open" });
		expect(merged.status).toBe("dead-end");
	});

	it("treats explored and dead-end paths as blocked", () => {
		const board = createEmptySearchBoard();
		const explored = createActionPathKey({ tool: "nmap", capability: "network-enumeration", targets: ["10.0.0.5"] });
		upsertSearchFact(
			board,
			createSearchFact({
				kind: "service-observed",
				statement: "scanned",
				targetRefs: ["10.0.0.5"],
				sourceCapability: "network-enumeration",
			}),
		);
		board.paths.push(
			createSearchPath({
				pathKey: explored,
				tool: "nmap",
				capability: "network-enumeration",
				status: "explored",
				summary: "bounded nmap already executed",
			}),
		);
		board.hints.push(createSearchHint({ reason: "nmap failed", pathKey: "dead" }));
		board.paths.push(
			createSearchPath({
				pathKey: "dead",
				tool: "httpx",
				status: "dead-end",
				summary: "fingerprint failed",
			}),
		);
		expect(blockedPathKeys(board).has(explored)).toBe(true);
		expect(blockedPathKeys(board).has("dead")).toBe(true);
	});

	it("replays search board events through the reducer", () => {
		let state = createInitialSecurityState();
		const fact = createSearchFact({
			kind: "http-surface",
			statement: "imported surface",
			targetRefs: ["http://127.0.0.1/"],
			origin: "knowledge",
			sourceCapability: "web-enumeration",
		});
		state = applySecurityEvent(state, { type: "search_fact_recorded", fact, createdAt: fact.createdAt });
		expect(state.searchBoard.facts).toHaveLength(1);
		expect(state.version).toBe(7);
		state = applySecurityEvent(state, {
			type: "task_started",
			task: {
				id: "t",
				goal: "reset",
				scenario: "web-security",
				assets: [],
				constraints: [],
				successCriteria: [],
				declaredAuthorization: [],
				pendingConfirmations: [],
				createdAt: fact.createdAt,
			},
			createdAt: fact.createdAt,
		});
		expect(state.searchBoard.facts).toHaveLength(0);
	});
});
