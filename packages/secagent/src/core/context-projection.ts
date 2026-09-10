import { createEmptySearchBoard, openSearchIntents } from "./search-board.ts";
import type { SecuritySearchBoard, SecurityState } from "./types.ts";

export const SEARCH_BOARD_PROJECTION_LIMIT = 4096;

export interface SearchBoardProjection {
	text: string;
	factCount: number;
	openIntentCount: number;
	deadEndCount: number;
}

function line(prefix: string, value: string, limit = 180): string {
	const compact = value.replace(/\s+/g, " ").trim();
	const body = compact.length <= limit ? compact : `${compact.slice(0, limit - 1)}…`;
	return `${prefix}${body}`;
}

export function summarizeSearchBoard(board: SecuritySearchBoard): SearchBoardProjection["text"] {
	const facts = board.facts.slice(-12).map((fact) => line(`- [${fact.origin}/${fact.kind}] `, fact.statement));
	const intents = openSearchIntents(board)
		.slice(0, 8)
		.map((intent) => line(`- [${intent.tool}/${intent.capability}] `, intent.statement));
	const deadEnds = board.paths
		.filter((path) => path.status === "dead-end")
		.slice(-8)
		.map((path) => line(`- [${path.tool}] `, `${path.pathKey.slice(0, 12)} ${path.summary}`));
	const explored = board.paths
		.filter((path) => path.status === "explored" || path.status === "verified")
		.slice(-8)
		.map((path) => line(`- [${path.tool}] `, path.pathKey.slice(0, 12)));
	const sections = [
		facts.length ? `Facts:\n${facts.join("\n")}` : undefined,
		intents.length ? `Open intents:\n${intents.join("\n")}` : undefined,
		explored.length ? `Explored paths:\n${explored.join("\n")}` : undefined,
		deadEnds.length ? `Dead ends:\n${deadEnds.join("\n")}` : undefined,
	].filter((section): section is string => Boolean(section));
	return sections.join("\n");
}

export function projectSearchBoard(state: SecurityState, limit = SEARCH_BOARD_PROJECTION_LIMIT): SearchBoardProjection {
	const board = state.searchBoard ?? createEmptySearchBoard();
	const scope = state.scope.targets.map((target) => `${target.kind}:${target.value}`).join(", ") || "(none)";
	const challenge = state.competition?.attempts.find(
		(attempt) => attempt.status === "running" || attempt.status === "starting" || attempt.status === "paused",
	);
	const header = [
		"SecAgent search board (structured memory, not transcript):",
		`scope: ${scope}`,
		challenge ? `challenge: ${challenge.challengeCode}` : undefined,
	]
		.filter((item): item is string => Boolean(item))
		.join("\n");
	let text = `${header}\n${summarizeSearchBoard(board)}`.trim();
	if (text.length > limit) text = `${text.slice(0, limit - 1)}…`;
	return {
		text,
		factCount: board.facts.length,
		openIntentCount: openSearchIntents(board).length,
		deadEndCount: board.paths.filter((path) => path.status === "dead-end").length,
	};
}
