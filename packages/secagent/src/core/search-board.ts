import { createHash, randomUUID } from "node:crypto";
import { buildDefaultActionInput } from "./action-input.ts";
import { redactSecurityValue } from "./audit.ts";
import type {
	CandidateActionInput,
	SearchFact,
	SearchFactKind,
	SearchHint,
	SearchIntent,
	SearchPathRecord,
	SearchPathStatus,
	SecurityEvent,
	SecuritySearchBoard,
	SecurityState,
} from "./types.ts";

export const MAX_SEARCH_BRANCHES = 2;

interface IntentDerivation {
	tool: string;
	capability: string;
	statement: string;
	requiresWordlist?: boolean;
	requiresHttp?: boolean;
	requiresArtifact?: boolean;
}

const DERIVATIONS: Readonly<Record<SearchFactKind, readonly IntentDerivation[]>> = {
	"service-observed": [
		{
			tool: "httpx",
			capability: "web-enumeration",
			statement: "Fingerprint HTTP services on the observed network surface",
			requiresHttp: true,
		},
		{
			tool: "curl",
			capability: "web-request-analysis",
			statement: "Inspect HTTP behavior of the observed service",
			requiresHttp: true,
		},
	],
	"http-surface": [
		{
			tool: "curl",
			capability: "web-request-analysis",
			statement: "Compare bounded HTTP request variants on the observed surface",
			requiresHttp: true,
		},
		{
			tool: "nuclei",
			capability: "vulnerability-verification",
			statement: "Collect candidate vulnerability signals from signed templates",
			requiresHttp: true,
		},
		{
			tool: "ffuf",
			capability: "web-enumeration",
			statement: "Rate-bounded content discovery using an in-workspace wordlist",
			requiresHttp: true,
			requiresWordlist: true,
		},
	],
	"artifact-property": [
		{
			tool: "strings",
			capability: "artifact-triage",
			statement: "Extract printable strings from the supplied artifact",
			requiresArtifact: true,
		},
		{
			tool: "readelf",
			capability: "binary-triage",
			statement: "Inspect ELF structure and exploit mitigations without execution",
			requiresArtifact: true,
		},
		{
			tool: "objdump",
			capability: "reverse-analysis",
			statement: "Inspect disassembly without executing the artifact",
			requiresArtifact: true,
		},
		{
			tool: "binwalk",
			capability: "forensics-triage",
			statement: "Scan embedded artifact signatures without extraction",
			requiresArtifact: true,
		},
		{
			tool: "exiftool",
			capability: "forensics-triage",
			statement: "Inspect structured artifact metadata",
			requiresArtifact: true,
		},
	],
	"dead-end": [],
};

function nowIso(createdAt?: string): string {
	return createdAt ?? new Date().toISOString();
}

function hasWordlist(state: SecurityState): boolean {
	return Boolean(
		state.task?.assets.some(
			(asset) => Boolean(asset.path) && /(?:wordlist|paths?|dirs?|content|fuzz)/i.test(asset.name),
		),
	);
}

function hasArtifact(state: SecurityState): boolean {
	return Boolean(state.task?.assets.some((asset) => asset.path));
}

function httpTargets(state: SecurityState, fact: SearchFact): string[] {
	const refs = fact.targetRefs.length > 0 ? fact.targetRefs : state.scope.targets.map((target) => target.value);
	return refs.filter((value) => {
		try {
			const parsed = new URL(/^https?:\/\//i.test(value) ? value : `http://${value}/`);
			return parsed.protocol === "http:" || parsed.protocol === "https:";
		} catch {
			return false;
		}
	});
}

export function createEmptySearchBoard(): SecuritySearchBoard {
	return { facts: [], intents: [], hints: [], paths: [] };
}

export function cloneSearchBoard(board: SecuritySearchBoard): SecuritySearchBoard {
	return {
		facts: board.facts.map((fact) => ({
			...fact,
			targetRefs: [...fact.targetRefs],
			evidenceIds: [...fact.evidenceIds],
		})),
		intents: board.intents.map((intent) => ({
			...intent,
			parentFactKeys: [...intent.parentFactKeys],
			targets: intent.targets ? [...intent.targets] : undefined,
		})),
		hints: board.hints.map((hint) => ({ ...hint })),
		paths: board.paths.map((path) => ({ ...path })),
	};
}

export function upsertSearchFact(board: SecuritySearchBoard, fact: SearchFact): SearchFact {
	const redacted: SearchFact = redactSecurityValue({
		...fact,
		statement: fact.statement.trim(),
		targetRefs: [...new Set(fact.targetRefs)],
		evidenceIds: [...new Set(fact.evidenceIds)],
	});
	const index = board.facts.findIndex((item) => item.key === redacted.key);
	if (index >= 0) {
		const previous = board.facts[index];
		if (!previous) return redacted;
		const merged: SearchFact = {
			...previous,
			...redacted,
			id: previous.id,
			createdAt: previous.createdAt,
			evidenceIds: [...new Set([...previous.evidenceIds, ...redacted.evidenceIds])],
			targetRefs: [...new Set([...previous.targetRefs, ...redacted.targetRefs])],
			confidence: Math.max(previous.confidence, redacted.confidence),
			origin: previous.origin === "knowledge" || redacted.origin === "knowledge" ? "knowledge" : "session",
		};
		board.facts[index] = merged;
		return merged;
	}
	board.facts.push(redacted);
	return redacted;
}

export function upsertSearchIntent(board: SecuritySearchBoard, intent: SearchIntent): SearchIntent {
	const index = board.intents.findIndex((item) => item.id === intent.id);
	if (index >= 0) {
		const previous = board.intents[index];
		if (!previous) return intent;
		if (previous.status === "dead-end" || previous.status === "merged") return previous;
		const merged: SearchIntent = {
			...previous,
			...intent,
			id: previous.id,
			createdAt: previous.createdAt,
			parentFactKeys: [...new Set([...previous.parentFactKeys, ...intent.parentFactKeys])],
		};
		board.intents[index] = merged;
		return merged;
	}
	const duplicate = board.intents.find(
		(item) => item.tool === intent.tool && item.capability === intent.capability && item.pathKey === intent.pathKey,
	);
	if (duplicate) {
		if (duplicate.status === "dead-end" || duplicate.status === "merged") return duplicate;
		duplicate.parentFactKeys = [...new Set([...duplicate.parentFactKeys, ...intent.parentFactKeys])];
		duplicate.updatedAt = intent.updatedAt;
		return duplicate;
	}
	board.intents.push(intent);
	return intent;
}

export function upsertSearchPath(board: SecuritySearchBoard, path: SearchPathRecord): SearchPathRecord {
	const redacted = redactSecurityValue(path);
	const index = board.paths.findIndex((item) => item.pathKey === redacted.pathKey);
	if (index >= 0) {
		board.paths[index] = { ...board.paths[index], ...redacted };
		return board.paths[index] ?? redacted;
	}
	board.paths.push(redacted);
	return redacted;
}

export function recordSearchHint(board: SecuritySearchBoard, hint: SearchHint): SearchHint {
	const redacted = redactSecurityValue(hint);
	const exists = board.hints.some(
		(item) =>
			item.reason === redacted.reason && item.pathKey === redacted.pathKey && item.intentId === redacted.intentId,
	);
	if (!exists) board.hints.push(redacted);
	return redacted;
}

export function blockedPathKeys(board: SecuritySearchBoard): Set<string> {
	return new Set(
		board.paths
			.filter((path) => path.status === "explored" || path.status === "dead-end")
			.map((path) => path.pathKey),
	);
}

export function openSearchIntents(board: SecuritySearchBoard): SearchIntent[] {
	return board.intents.filter((intent) => intent.status === "open");
}

export function createActionPathKey(input: {
	tool: string;
	capability?: string;
	targets?: readonly string[];
	normalizedInput?: Record<string, unknown>;
}): string {
	const target = [...(input.targets ?? [])]
		.map((item) => item.trim().toLowerCase())
		.sort()
		.join("|");
	const payload = JSON.stringify({
		tool: input.tool.trim().toLowerCase(),
		capability: input.capability?.trim().toLowerCase() ?? "",
		target,
		input: input.normalizedInput ?? {},
	});
	return createHash("sha256").update(payload).digest("hex");
}

export function createIntentPathKey(
	state: SecurityState,
	intent: Pick<SearchIntent, "tool" | "capability" | "targets">,
): string {
	const stub: CandidateActionInput = {
		id: `auto-${intent.tool}-${intent.capability}`,
		tool: intent.tool,
		capability: intent.capability,
		description: "",
		goalRelevance: 0,
		informationGain: 0,
		confidence: 0,
		cost: 0,
		preconditions: [],
		targets: intent.targets,
	};
	const defaultInput = buildDefaultActionInput(state, stub);
	return createActionPathKey({
		tool: intent.tool,
		capability: intent.capability,
		targets: intent.targets,
		normalizedInput: defaultInput.ok ? defaultInput.input : {},
	});
}

export function factKindForCapability(capability: string | undefined): SearchFactKind {
	if (capability === "network-enumeration") return "service-observed";
	if (
		capability === "web-enumeration" ||
		capability === "web-request-analysis" ||
		capability === "browser-state-verification"
	)
		return "http-surface";
	if (
		capability === "artifact-triage" ||
		capability === "binary-triage" ||
		capability === "reverse-analysis" ||
		capability === "forensics-triage"
	)
		return "artifact-property";
	if (capability === "vulnerability-verification") return "http-surface";
	return "service-observed";
}

export function createSearchFact(input: {
	kind: SearchFactKind;
	statement: string;
	targetRefs?: readonly string[];
	evidenceIds?: readonly string[];
	confidence?: number;
	origin?: SearchFact["origin"];
	sourceTool?: string;
	sourceCapability?: string;
	createdAt?: string;
}): SearchFact {
	const createdAt = nowIso(input.createdAt);
	const targetRefs = [...new Set((input.targetRefs ?? []).map((item) => item.trim()).filter(Boolean))];
	const key = `${input.kind}:${input.sourceCapability ?? "unknown"}:${targetRefs.sort().join("|") || "task"}`;
	return redactSecurityValue({
		id: randomUUID(),
		key,
		kind: input.kind,
		statement: input.statement.trim(),
		targetRefs,
		evidenceIds: [...new Set(input.evidenceIds ?? [])],
		confidence: Math.max(0, Math.min(1, input.confidence ?? 0.7)),
		origin: input.origin ?? "session",
		sourceTool: input.sourceTool,
		sourceCapability: input.sourceCapability,
		createdAt,
		updatedAt: createdAt,
	});
}

export function deriveIntentsFromFact(state: SecurityState, fact: SearchFact, createdAt?: string): SearchIntent[] {
	if (fact.kind === "dead-end") return [];
	const stamp = nowIso(createdAt);
	const artifactPath = state.task?.assets.find((asset) => asset.path)?.path;
	const derivations = DERIVATIONS[fact.kind] ?? [];
	const intents: SearchIntent[] = [];
	for (const derivation of derivations) {
		if (derivation.tool === fact.sourceTool) continue;
		if (derivation.requiresWordlist && !hasWordlist(state)) continue;
		if (derivation.requiresArtifact && !hasArtifact(state)) continue;
		const targets = derivation.requiresHttp
			? httpTargets(state, fact)
			: derivation.requiresArtifact && artifactPath
				? [artifactPath]
				: [...fact.targetRefs];
		if (derivation.requiresHttp && targets.length === 0) continue;
		const intent: SearchIntent = {
			id: `intent:${fact.key}:${derivation.tool}:${derivation.capability}`,
			statement: derivation.statement,
			status: "open",
			parentFactKeys: [fact.key],
			tool: derivation.tool,
			capability: derivation.capability,
			targets: targets.length > 0 ? targets : undefined,
			createdAt: stamp,
			updatedAt: stamp,
		};
		intent.pathKey = createIntentPathKey(state, intent);
		if (blockedPathKeys(state.searchBoard ?? createEmptySearchBoard()).has(intent.pathKey)) continue;
		intents.push(intent);
	}
	return intents;
}

export function markIntentStatus(
	board: SecuritySearchBoard,
	intentId: string | undefined,
	status: SearchIntent["status"],
	updates: Partial<SearchIntent> = {},
	createdAt?: string,
): SearchIntent | undefined {
	if (!intentId) return undefined;
	const intent = board.intents.find((item) => item.id === intentId);
	if (!intent) return undefined;
	if (intent.status === "dead-end" && status !== "dead-end") return intent;
	intent.status = status;
	intent.updatedAt = nowIso(createdAt);
	if (updates.claimedByDecisionId) intent.claimedByDecisionId = updates.claimedByDecisionId;
	if (updates.pathKey) intent.pathKey = updates.pathKey;
	return intent;
}

export function createSearchHint(input: {
	reason: string;
	pathKey?: string;
	intentId?: string;
	createdAt?: string;
}): SearchHint {
	return redactSecurityValue({
		id: randomUUID(),
		reason: input.reason.trim(),
		pathKey: input.pathKey,
		intentId: input.intentId,
		createdAt: nowIso(input.createdAt),
	});
}

export function createSearchPath(input: {
	pathKey: string;
	tool: string;
	capability?: string;
	status: SearchPathStatus;
	summary: string;
	updatedAt?: string;
}): SearchPathRecord {
	return redactSecurityValue({
		pathKey: input.pathKey,
		tool: input.tool,
		capability: input.capability,
		status: input.status,
		summary: input.summary.trim(),
		updatedAt: nowIso(input.updatedAt),
	});
}

export function applyHydratedBoard(
	board: SecuritySearchBoard,
	payload: {
		facts?: readonly SearchFact[];
		intents?: readonly SearchIntent[];
		hints?: readonly SearchHint[];
		paths?: readonly SearchPathRecord[];
	},
): void {
	for (const fact of payload.facts ?? []) upsertSearchFact(board, fact);
	for (const path of payload.paths ?? []) upsertSearchPath(board, path);
	for (const hint of payload.hints ?? []) recordSearchHint(board, hint);
	for (const intent of payload.intents ?? []) upsertSearchIntent(board, intent);
}

export function pendingDecisionsForIntent(state: SecurityState, intentId: string | undefined): number {
	return state.decisions.filter(
		(decision) =>
			decision.resultStatus === "pending" && (intentId ? decision.intentId === intentId : !decision.intentId),
	).length;
}

export function pendingBranchCount(state: SecurityState): number {
	return state.decisions.filter((decision) => decision.resultStatus === "pending").length;
}

export function branchStartBlockReason(
	state: SecurityState,
	intentId: string | undefined,
	maxBranches = MAX_SEARCH_BRANCHES,
): string | undefined {
	if (pendingDecisionsForIntent(state, intentId) > 0)
		return intentId
			? `Intent ${intentId} already has a pending decision`
			: "a bootstrap decision is already pending for this branch";
	if (pendingBranchCount(state) >= maxBranches)
		return `Pending branch limit ${maxBranches} reached; resolve a decision before starting another`;
	return undefined;
}

function selectedCandidate(state: SecurityState, decisionId: string) {
	const decision = state.decisions.find((item) => item.id === decisionId);
	if (!decision) return undefined;
	return {
		decision,
		action: decision.candidates.find((candidate) => candidate.id === decision.selectedActionId),
	};
}

export function searchEventsAfterDecision(
	state: SecurityState,
	decisionId: string,
	createdAt: string,
): SecurityEvent[] {
	const selected = selectedCandidate(state, decisionId);
	if (!selected?.action || !selected.decision.resultStatus || selected.decision.resultStatus === "pending") return [];
	const events: SecurityEvent[] = [];
	const action = selected.action;
	const pathKey =
		action.pathKey ??
		createActionPathKey({
			tool: action.tool,
			capability: action.capability,
			targets: action.targets,
		});
	const failed = selected.decision.resultStatus === "failed" || selected.decision.resultStatus === "contradicted";
	const targetLabel = (action.targets ?? []).join(", ") || "task";
	const summary = failed
		? `${action.tool} failed: ${selected.decision.actualResult?.trim() || "execution failed"}`
		: `${action.tool} observed ${factKindForCapability(action.capability)} on ${targetLabel}`;
	const path = createSearchPath({
		pathKey,
		tool: action.tool,
		capability: action.capability,
		status: failed ? "dead-end" : "explored",
		summary,
		updatedAt: createdAt,
	});
	events.push({ type: "search_path_recorded", path, createdAt });
	if (failed) {
		const hint = createSearchHint({
			reason: summary,
			pathKey,
			intentId: selected.decision.intentId ?? action.intentId,
			createdAt,
		});
		events.push({ type: "search_hint_recorded", hint, createdAt });
		const deadEnd = markIntentStatus(
			cloneSearchBoard(state.searchBoard),
			selected.decision.intentId ?? action.intentId,
			"dead-end",
			{ pathKey },
			createdAt,
		);
		if (deadEnd)
			events.push({ type: "search_intent_updated", intent: { ...deadEnd, status: "dead-end", pathKey }, createdAt });
		return events;
	}
	const evidence = state.evidence.filter((item) => item.decisionIds?.includes(decisionId));
	const fact = createSearchFact({
		kind: factKindForCapability(action.capability),
		statement: summary,
		targetRefs: action.targets ?? evidence.flatMap((item) => item.targetRefs ?? []),
		evidenceIds: evidence.map((item) => item.id),
		confidence: evidence[0]?.confidence ?? 0.75,
		origin: "session",
		sourceTool: action.tool,
		sourceCapability: action.capability,
		createdAt,
	});
	events.push({ type: "search_fact_recorded", fact, createdAt });
	const resolved = markIntentStatus(
		cloneSearchBoard(state.searchBoard),
		selected.decision.intentId ?? action.intentId,
		"resolved",
		{ pathKey },
		createdAt,
	);
	if (resolved)
		events.push({ type: "search_intent_updated", intent: { ...resolved, status: "resolved", pathKey }, createdAt });
	const nextState: SecurityState = {
		...state,
		searchBoard: cloneSearchBoard(state.searchBoard),
	};
	upsertSearchPath(nextState.searchBoard, path);
	upsertSearchFact(nextState.searchBoard, fact);
	for (const intent of deriveIntentsFromFact(nextState, fact, createdAt))
		events.push({ type: "search_intent_updated", intent, createdAt });
	return events;
}

export function searchHydrationEvent(
	state: SecurityState,
	snapshot: {
		facts: SearchFact[];
		paths: SearchPathRecord[];
		hints: SearchHint[];
	},
	createdAt: string,
): SecurityEvent | undefined {
	if (snapshot.facts.length === 0 && snapshot.paths.length === 0) return undefined;
	const board = cloneSearchBoard(state.searchBoard ?? createEmptySearchBoard());
	applyHydratedBoard(board, {
		facts: snapshot.facts,
		paths: snapshot.paths,
		hints: snapshot.hints,
	});
	const hydratedState: SecurityState = { ...state, searchBoard: board };
	const intents = snapshot.facts.flatMap((fact) => deriveIntentsFromFact(hydratedState, fact, createdAt));
	return {
		type: "search_board_hydrated",
		facts: snapshot.facts.map((fact) => ({ ...fact, origin: "knowledge" as const })),
		intents,
		hints: snapshot.hints,
		paths: snapshot.paths,
		createdAt,
	};
}
