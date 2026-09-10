import { describe, expect, it } from "vitest";
import {
	projectSearchBoard,
	SEARCH_BOARD_PROJECTION_LIMIT,
	summarizeSearchBoard,
} from "../src/core/context-projection.ts";
import {
	applyHydratedBoard,
	createEmptySearchBoard,
	createSearchFact,
	createSearchPath,
} from "../src/core/search-board.ts";
import { createInitialSecurityState } from "../src/core/state.ts";

describe("search board context projection", () => {
	it("includes imported facts and stays within the size limit", () => {
		const state = createInitialSecurityState();
		state.scope.targets = [{ id: "s", kind: "url", value: "http://127.0.0.1/" }];
		const board = createEmptySearchBoard();
		applyHydratedBoard(board, {
			facts: [
				createSearchFact({
					kind: "http-surface",
					statement: "imported HTTP surface",
					targetRefs: ["http://127.0.0.1/"],
					origin: "knowledge",
					sourceCapability: "web-enumeration",
				}),
			],
			paths: [
				createSearchPath({
					pathKey: "abc123deadend",
					tool: "httpx",
					status: "dead-end",
					summary: "fingerprint failed",
				}),
			],
		});
		state.searchBoard = board;
		const projection = projectSearchBoard(state);
		expect(projection.text).toContain("imported HTTP surface");
		expect(projection.text).toContain("search board");
		expect(projection.text).not.toContain("Nmap scan report\n80/tcp open http");
		expect(projection.text.length).toBeLessThanOrEqual(SEARCH_BOARD_PROJECTION_LIMIT);
		expect(summarizeSearchBoard(board)).not.toMatch(/stdout|__PI_CURL_STATUS__/);
	});
});
