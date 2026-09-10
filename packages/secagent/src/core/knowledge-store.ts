import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { redactSecurityText, redactSecurityValue } from "./audit.ts";
import { normalizeScopeValue } from "./scope.ts";
import type {
	SearchFact,
	SearchFactKind,
	SearchHint,
	SearchPathRecord,
	SearchPathStatus,
	SecurityScope,
	SecurityState,
} from "./types.ts";

export type KnowledgeSpaceKind = "challenge" | "scope";

export interface KnowledgeSpaceRef {
	kind: KnowledgeSpaceKind;
	id: string;
	keyHash: string;
	keyJson: string;
}

export interface KnowledgeSnapshot {
	space: KnowledgeSpaceRef;
	facts: SearchFact[];
	paths: SearchPathRecord[];
	hints: SearchHint[];
}

interface FactRow {
	fact_key: string;
	kind: string;
	statement: string;
	target_refs_json: string;
	evidence_sha256: string | null;
	confidence: number;
	source_session_id: string | null;
	source_tool: string | null;
	source_capability: string | null;
	updated_at: string;
}

interface PathRow {
	path_key: string;
	status: string;
	tool: string;
	capability: string | null;
	summary: string;
	updated_at: string;
}

const FLAG_PATTERN = /flag\{[^}]+\}/gi;

function sanitizeText(value: string): string {
	return redactSecurityText(value).replace(FLAG_PATTERN, "flag{[REDACTED]}");
}

function hashKey(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

export function challengeKnowledgeSpace(providerId: string, challengeCode: string): KnowledgeSpaceRef {
	const keyJson = JSON.stringify({ kind: "challenge", providerId, challengeCode });
	const keyHash = hashKey(`challenge:${providerId}:${challengeCode}`);
	return { kind: "challenge", id: keyHash, keyHash, keyJson };
}

export function scopeKnowledgeSpace(scope: SecurityScope): KnowledgeSpaceRef | undefined {
	const targets = scope.targets
		.map((target) => `${target.kind}:${normalizeScopeValue(target.value, target.kind)}`)
		.filter((value) => value.length > 0)
		.sort();
	if (targets.length === 0) return undefined;
	const keyJson = JSON.stringify({ kind: "scope", targets });
	const keyHash = hashKey(`scope:${targets.join("|")}`);
	return { kind: "scope", id: keyHash, keyHash, keyJson };
}

export function resolveKnowledgeSpace(state: SecurityState): KnowledgeSpaceRef | undefined {
	const activeAttempt = state.competition?.attempts.find(
		(attempt) => attempt.status === "running" || attempt.status === "starting" || attempt.status === "paused",
	);
	if (state.competition && activeAttempt)
		return challengeKnowledgeSpace(state.competition.providerId, activeAttempt.challengeCode);
	return scopeKnowledgeSpace(state.scope);
}

export function defaultKnowledgeDbPath(): string {
	const root = process.env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent");
	return join(root, "secagent", "knowledge.sqlite");
}

export class SecurityKnowledgeStore {
	private readonly db: DatabaseSync;

	constructor(dbPath: string) {
		if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
		this.db = new DatabaseSync(dbPath);
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS spaces (
				id TEXT PRIMARY KEY,
				kind TEXT NOT NULL,
				key_hash TEXT NOT NULL UNIQUE,
				key_json TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);
			CREATE TABLE IF NOT EXISTS facts (
				space_id TEXT NOT NULL,
				fact_key TEXT NOT NULL,
				kind TEXT NOT NULL,
				statement TEXT NOT NULL,
				target_refs_json TEXT NOT NULL,
				evidence_sha256 TEXT,
				confidence REAL NOT NULL,
				source_session_id TEXT,
				source_tool TEXT,
				source_capability TEXT,
				updated_at TEXT NOT NULL,
				PRIMARY KEY (space_id, fact_key)
			);
			CREATE TABLE IF NOT EXISTS paths (
				space_id TEXT NOT NULL,
				path_key TEXT NOT NULL,
				status TEXT NOT NULL,
				tool TEXT NOT NULL,
				capability TEXT,
				summary TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				PRIMARY KEY (space_id, path_key)
			);
		`);
	}

	close(): void {
		this.db.close();
	}

	ensureSpace(space: KnowledgeSpaceRef, updatedAt: string): void {
		this.db
			.prepare(
				`INSERT INTO spaces(id, kind, key_hash, key_json, updated_at)
				 VALUES (?, ?, ?, ?, ?)
				 ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, key_json = excluded.key_json`,
			)
			.run(space.id, space.kind, space.keyHash, space.keyJson, updatedAt);
	}

	upsertFact(space: KnowledgeSpaceRef, fact: SearchFact, sourceSessionId?: string): void {
		if (fact.statement.includes("secret://") || fact.sourceTool?.includes("secret://")) return;
		const updatedAt = fact.updatedAt;
		this.ensureSpace(space, updatedAt);
		this.db
			.prepare(
				`INSERT INTO facts(
					space_id, fact_key, kind, statement, target_refs_json, evidence_sha256,
					confidence, source_session_id, source_tool, source_capability, updated_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				 ON CONFLICT(space_id, fact_key) DO UPDATE SET
					kind = excluded.kind,
					statement = excluded.statement,
					target_refs_json = excluded.target_refs_json,
					evidence_sha256 = COALESCE(excluded.evidence_sha256, facts.evidence_sha256),
					confidence = MAX(facts.confidence, excluded.confidence),
					source_tool = COALESCE(excluded.source_tool, facts.source_tool),
					source_capability = COALESCE(excluded.source_capability, facts.source_capability),
					updated_at = excluded.updated_at`,
			)
			.run(
				space.id,
				fact.key,
				fact.kind,
				sanitizeText(fact.statement),
				JSON.stringify(redactSecurityValue(fact.targetRefs)),
				null,
				fact.confidence,
				sourceSessionId ?? null,
				fact.sourceTool ?? null,
				fact.sourceCapability ?? null,
				updatedAt,
			);
	}

	upsertPath(space: KnowledgeSpaceRef, path: SearchPathRecord): void {
		this.ensureSpace(space, path.updatedAt);
		this.db
			.prepare(
				`INSERT INTO paths(space_id, path_key, status, tool, capability, summary, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?)
				 ON CONFLICT(space_id, path_key) DO UPDATE SET
					status = excluded.status,
					tool = excluded.tool,
					capability = excluded.capability,
					summary = excluded.summary,
					updated_at = excluded.updated_at`,
			)
			.run(
				space.id,
				path.pathKey,
				path.status,
				path.tool,
				path.capability ?? null,
				sanitizeText(path.summary),
				path.updatedAt,
			);
	}

	load(space: KnowledgeSpaceRef): KnowledgeSnapshot {
		const factRows = this.db
			.prepare(
				`SELECT fact_key, kind, statement, target_refs_json, evidence_sha256, confidence,
				        source_session_id, source_tool, source_capability, updated_at
				 FROM facts WHERE space_id = ?`,
			)
			.all(space.id) as unknown as FactRow[];
		const pathRows = this.db
			.prepare(`SELECT path_key, status, tool, capability, summary, updated_at FROM paths WHERE space_id = ?`)
			.all(space.id) as unknown as PathRow[];
		const facts: SearchFact[] = factRows.map((row) => ({
			id: `knowledge:${space.id}:${row.fact_key}`,
			key: row.fact_key,
			kind: row.kind as SearchFactKind,
			statement: row.statement,
			targetRefs: JSON.parse(row.target_refs_json) as string[],
			evidenceIds: row.evidence_sha256 ? [row.evidence_sha256] : [],
			confidence: row.confidence,
			origin: "knowledge",
			sourceTool: row.source_tool ?? undefined,
			sourceCapability: row.source_capability ?? undefined,
			createdAt: row.updated_at,
			updatedAt: row.updated_at,
		}));
		const paths: SearchPathRecord[] = pathRows.map((row) => ({
			pathKey: row.path_key,
			tool: row.tool,
			capability: row.capability ?? undefined,
			status: row.status as SearchPathStatus,
			summary: row.summary,
			updatedAt: row.updated_at,
		}));
		const hints: SearchHint[] = paths
			.filter((path) => path.status === "dead-end")
			.map((path) => ({
				id: `knowledge-hint:${space.id}:${path.pathKey}`,
				reason: path.summary,
				pathKey: path.pathKey,
				createdAt: path.updatedAt,
			}));
		return { space, facts, paths, hints };
	}
}
