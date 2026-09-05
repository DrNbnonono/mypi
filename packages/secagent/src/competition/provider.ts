import type { ChallengeHint, ChallengeInstance, CompetitionChallenge, FlagSubmissionResult } from "../core/types.ts";

export interface CompetitionProvider {
	readonly id: string;
	listChallenges(): Promise<CompetitionChallenge[]>;
	startChallenge(code: string): Promise<ChallengeInstance>;
	stopChallenge(code: string): Promise<void>;
	submitFlag(code: string, flag: string): Promise<FlagSubmissionResult>;
	viewHint(code: string): Promise<ChallengeHint>;
}

export interface McpCompetitionToolClient {
	callTool(name: string, arguments_: Record<string, unknown>): Promise<unknown>;
}

function objectValue(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Competition provider returned an object");
	return value as Record<string, unknown>;
}

function parseTextContent(value: Record<string, unknown>): unknown {
	if (!Array.isArray(value.content)) return value;
	const text = value.content
		.flatMap((item) => {
			if (!item || typeof item !== "object") return [];
			const record = item as Record<string, unknown>;
			return record.type === "text" && typeof record.text === "string" ? [record.text] : [];
		})
		.join("\n")
		.trim();
	if (!text) return value;
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return { content: text };
	}
}

function unwrap(value: unknown): unknown {
	let current = parseTextContent(objectValue(value));
	if (!current || typeof current !== "object" || Array.isArray(current)) return current;
	const record = current as Record<string, unknown>;
	if (typeof record.code === "number" && record.code !== 0)
		throw new Error(
			typeof record.message === "string" ? record.message : `Competition provider error ${record.code}`,
		);
	if ("data" in record && record.data !== null) current = record.data;
	return current;
}

function stringValue(record: Record<string, unknown>, ...keys: string[]): string | undefined {
	for (const key of keys) if (typeof record[key] === "string" && record[key]) return record[key] as string;
	return undefined;
}

function numberValue(record: Record<string, unknown>, ...keys: string[]): number | undefined {
	for (const key of keys)
		if (typeof record[key] === "number" && Number.isFinite(record[key])) return record[key] as number;
	return undefined;
}

function challengeStatus(
	record: Record<string, unknown>,
	captured: number,
	count: number,
): CompetitionChallenge["status"] {
	if (count > 0 && captured >= count) return "completed";
	const status = stringValue(record, "status")?.toLowerCase();
	if (status === "locked") return "locked";
	if (status === "running" || record.running === true) return "running";
	return "available";
}

function challengeFromUnknown(value: unknown): CompetitionChallenge {
	const record = objectValue(value);
	const code = stringValue(record, "code", "challenge_code", "id");
	if (!code) throw new Error("Competition challenge is missing code");
	const flagCount = numberValue(record, "flag_count", "flagCount") ?? 1;
	const flagsCaptured = numberValue(record, "flag_got_count", "flagsCaptured", "solved_count") ?? 0;
	return {
		code,
		title: stringValue(record, "title", "name") ?? code,
		status: challengeStatus(record, flagsCaptured, flagCount),
		level: numberValue(record, "level"),
		score: numberValue(record, "score", "points"),
		flagCount,
		flagsCaptured,
		metadata: structuredClone(record),
	};
}

function arrayFromPayload(payload: unknown): unknown[] {
	if (Array.isArray(payload)) return payload;
	const record = objectValue(payload);
	for (const key of ["challenges", "items", "list"]) if (Array.isArray(record[key])) return record[key] as unknown[];
	throw new Error("Competition provider did not return a challenge list");
}

export class TencentMcpCompetitionProvider implements CompetitionProvider {
	readonly id = "tencent-mcp";
	private readonly client: McpCompetitionToolClient;

	constructor(client: McpCompetitionToolClient) {
		this.client = client;
	}

	async listChallenges(): Promise<CompetitionChallenge[]> {
		return arrayFromPayload(unwrap(await this.client.callTool("list_challenges", {}))).map(challengeFromUnknown);
	}

	async startChallenge(code: string): Promise<ChallengeInstance> {
		const payload = unwrap(await this.client.callTool("start_challenge", { code }));
		const record = Array.isArray(payload) ? { entrypoints: payload } : objectValue(payload);
		const rawEntrypoints = Array.isArray(record.entrypoints)
			? record.entrypoints
			: Array.isArray(record.entrypoint)
				? record.entrypoint
				: [record.entrypoint ?? record.address ?? record.url];
		const entrypoints = rawEntrypoints.filter((item): item is string => typeof item === "string" && item.length > 0);
		if (entrypoints.length === 0) throw new Error(`Challenge ${code} did not return an entrypoint`);
		return {
			code,
			entrypoints,
			providerInstanceId: stringValue(record, "instance_id", "instanceId"),
			startedAt: new Date().toISOString(),
		};
	}

	async stopChallenge(code: string): Promise<void> {
		unwrap(await this.client.callTool("stop_challenge", { code }));
	}

	async submitFlag(code: string, flag: string): Promise<FlagSubmissionResult> {
		const record = objectValue(unwrap(await this.client.callTool("submit_flag", { code, flag })));
		return {
			correct: record.correct === true,
			message: stringValue(record, "message") ?? (record.correct === true ? "correct" : "incorrect"),
			flagCount: numberValue(record, "flag_count", "flagCount"),
			flagsCaptured: numberValue(record, "flag_got_count", "flagsCaptured"),
		};
	}

	async viewHint(code: string): Promise<ChallengeHint> {
		const payload = unwrap(await this.client.callTool("view_hint", { code }));
		const record = typeof payload === "string" ? { content: payload } : objectValue(payload);
		return {
			code,
			content: stringValue(record, "hint_content", "content", "hint") ?? "",
			penaltyPercent: numberValue(record, "penalty_percent", "penaltyPercent") ?? 10,
		};
	}
}
