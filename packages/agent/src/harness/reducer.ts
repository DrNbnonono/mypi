import type { AssistantMessage, DeferredHandle, StopReason } from "@earendil-works/pi-ai";
import { Guard } from "typebox/guard";
import type { AgentMessage, AgentToolCall, ThinkingLevel } from "../types.ts";
import type {
	Entry,
	LaneRecord,
	OperationStartedRecord,
	ProvisionedEntry,
	QueueEnqueuedRecord,
	StepAttemptRecord,
	ToolStartedRecord,
	WriteDeferredRecord,
} from "./session/types.ts";

// 事件流折叠器
//
// 本文件实现 AgentHarness 中 lane 状态机的"纯投影"步骤：
//   - validateRecordLog :  校验一段有限的 lane 日志切片，发现协议层面不可能产生的状态立刻抛错
//   - reduceLaneState   :  把 entries + records 折叠成当前 lane 的运行快照
//   - derive*           :  各种纯派生函数（配置、工具批、最新条目等）
//
// 设计约束：纯函数，不读写 storage，不修改输入；同一输入永远得到同一输出。
// 真正的写入和恢复由 AgentHarness 的 operation 负责，本文件只是"读出来怎么解释"。

/**
 * Machine-readable category for a contradiction in a lane's durable recovery
 * slice. These indicate states the single-writer record protocol cannot
 * produce, not ordinary operation failures or incomplete-but-recoverable
 * intent/result prefixes. Restore must reject such states rather than repair or
 * continue it; the accompanying error message supplies human-readable detail.
 */
// 损坏分类标签：每一种都对应一种"单写者协议不可能产生"的状态，
// 恢复流程遇到时必须拒绝继续，而不是尝试修补。

export type RecordLogCorruptionReason =
	| "multiple_open_operations"
	| "unknown_operation"
	| "record_after_finish"
	| "non_consecutive_attempt"
	| "invalid_compaction_reason"
	| "queue_after_abort"
	| "invalid_queue_cancellation"
	| "inconsistent_step"
	| "tool_call_mismatch"
	| "duplicate_tool_invocation"
	| "provisioned_entry_mismatch"
	| "invalid_deferred_handle";

export class RecordLogCorruption extends Error {
	readonly reason: RecordLogCorruptionReason;

	constructor(reason: RecordLogCorruptionReason, message: string) {
		super(message);
		this.name = "RecordLogCorruption";
		this.reason = reason;
	}
}
// 当 storage 里读出来的日志切片出现协议不可能产生的状态时抛出此错误；
// reason 是机器可读分类，message 给人类读，恢复流程必须按 reason 拒绝继续。

// validateRecordLog 的输入：从 storage 取回的"一个 lane 在某个时刻的有界切片"。
// records 按 seq 升序，包含所有 operation_started / step_attempt / tool_started / queue_* 等日志条目；
// entries 是被这些 record 引用到的 message / compaction / branch_summary 等条目。
export interface RecordLogSlice {
	lane: string;
	openOperations: readonly OperationStartedRecord[];
	records: readonly LaneRecord[];
	/** Operation-owned entries plus entries fetched directly by provisioned or referenced ids. */
	entries: readonly Entry[];
}

// 通过按 seq 回放 model_change / thinking_level_change / active_tools_change / assistant message
// 这几类 entry 得到的"当前 lane 生效配置"。
export interface EffectiveLaneConfiguration {
	model: { provider: string; modelId: string };
	thinkingLevel: ThinkingLevel;
	activeToolNames: string[];
}

// 终态失败：当 lane 在恢复时发现最新的 assistant 条目 stopReason === "error"，
// 且该 error 是由某次 step_attempt 或 deferred_fetch 产生时记录在此。
// source 区分是"本轮 step 失败"还是"补取 deferred 结果时失败"。
export interface TerminalFailureState {
	entryId: string;
	source: "step" | "deferred_fetch";
	message: AssistantMessage;
}

// 工具调用批：来自某条 assistant 消息里所有的 toolCall 节点，
// 与 tool_started 日志和后续 toolResult 条目一一对应。
// truncated=true 表示 stopReason==="length"（输出被截断）；
// unresolved=true 表示至少有一个 toolCall 还没拿到 result。
export interface ToolBatchState {
	assistantEntryId: string;
	calls: {
		toolIndex: number;
		toolCall: AgentToolCall;
		started?: ToolStartedRecord;
		resultExists: boolean;
		terminate?: boolean;
	}[];
	truncated: boolean;
	unresolved: boolean;
}

// reducer 的核心输出：单个 lane 在某一时刻的完整运行状态。
// operation === null 表示该 lane 空闲；非空时描述当前 open operation 的所有派生字段：
//   - step             ：最近一次还没出结果的 step_attempt（assistant / compaction / branch_summary）
//   - toolBatch        ：本次 assistant 调用产生的、未完成的工具批
//   - pendingSteer     ：steer 队列里等待注入到当前 operation 的项
//   - pendingFollowUp  ：followUp 队列里等待在 operation 结束后插入下一轮的项
//   - pendingWrites    ：write_deferred 但目标 entry 还没真正落地
//   - pendingNextRun   ：nextRun 队列里等当前 lane 空闲后跑的项
//   - deferred         ：最近一次 assistant 留下但尚未 fetch 的 deferred 句柄
//   - overflowRecoveryUsed：本次 operation 是否用过 overflow compaction
//   - targets          ：operation 的预期结果条目（compaction.result / navigation.summary）是否已经落地
export interface LaneState {
	lane: string;
	leafId: string | null;
	operation: null | {
		id: string;
		kind: "run" | "compaction" | "navigation";
		intent: OperationStartedRecord["intent"];
		aborting: boolean;
		step: null | {
			kind: "assistant" | "compaction" | "branch_summary";
			attempts: number;
			resultEntryId: string;
			compactionReason?: "manual" | "threshold" | "overflow";
		};
		toolBatch: ToolBatchState | null;
		missingInitialMessages: ProvisionedEntry[];
		pendingSteer: ProvisionedEntry[];
		pendingFollowUp: ProvisionedEntry[];
		pendingWrites: ProvisionedEntry[];
		deferred: DeferredHandle | null;
		overflowRecoveryUsed: boolean;
		newestOwn: null | {
			entryId: string;
			type: Entry["type"];
			role?: AgentMessage["role"];
			stopReason?: StopReason;
		};
		targets: { result?: boolean; summary?: boolean };
	};
	pendingNextRun: ProvisionedEntry[];
}

// reduceLaneState 的输入：除了 RecordLogSlice 外，还需要：
//   - leafId              ：当前 lane 的 leaf entry id（可能是 null）
//   - ownEntries          ：open operation 自己产生的新条目（按 seq 升序），lane 空闲时为空
//   - configurationEntries：用于派生有效配置的"配置类条目"
//   - defaults            ：没有持久化配置时使用的 harness 默认值
export interface LaneReductionInput extends RecordLogSlice {
	leafId: string | null;
	/** Entries appended by the open operation, oldest first. Empty when idle. */
	ownEntries: readonly Entry[];
	/** Bounded effective-state lookups at the operation anchor or idle leaf, oldest first. */
	configurationEntries: readonly Entry[];
	/** Harness option fallbacks used when no persisted value exists. */
	defaults: EffectiveLaneConfiguration;
}

// reduceLaneState 的输出：折叠后的 lane 状态 + 派生出的有效配置 + 终态失败（若有）。
export interface LaneReductionResult {
	laneState: LaneState;
	effectiveConfiguration: EffectiveLaneConfiguration;
	terminalFailure: TerminalFailureState | null;
}

interface AttemptSeries {
	record: StepAttemptRecord;
}

// 小工具：构造一个 RecordLogCorruption 并立刻抛。type 标注为 `never` 让 TS 在分支里强制收口。
function corrupt(reason: RecordLogCorruptionReason, message: string): never {
	throw new RecordLogCorruption(reason, message);
}

function hasRunId(record: LaneRecord): record is Exclude<LaneRecord, OperationStartedRecord> & { runId: string } {
	return "runId" in record && typeof record.runId === "string";
}

function matchesProvisionedEntry(entry: Entry, target: ProvisionedEntry): boolean {
	const { parentId: _parentId, seq: _seq, timestamp: _timestamp, ...payload } = entry;
	return Guard.IsDeepEqual(payload, target);
}

function validateExactProvisionedEntry(entriesById: ReadonlyMap<string, Entry>, target: ProvisionedEntry): void {
	const entry = entriesById.get(target.id);
	if (entry && !matchesProvisionedEntry(entry, target)) {
		corrupt(
			"provisioned_entry_mismatch",
			`Provisioned entry ${target.id} exists with content different from its intent`,
		);
	}
}

function validateResultEntry(
	entriesById: ReadonlyMap<string, Entry>,
	resultEntryId: string,
	matches: (entry: Entry) => boolean,
	description: string,
): void {
	const entry = entriesById.get(resultEntryId);
	if (entry && !matches(entry)) {
		corrupt(
			"provisioned_entry_mismatch",
			`Provisioned ${description} entry ${resultEntryId} exists with different content`,
		);
	}
}

function validateAttemptReason(record: StepAttemptRecord): void {
	const reason = (record as { compactionReason?: unknown }).compactionReason;
	if (record.step === "compaction") {
		if (reason !== "manual" && reason !== "threshold" && reason !== "overflow") {
			corrupt("invalid_compaction_reason", `Compaction attempt ${record.id} has no valid compaction reason`);
		}
	} else if (reason !== undefined) {
		corrupt("invalid_compaction_reason", `${record.step} attempt ${record.id} has a compaction reason`);
	}
}

function validateAttemptSequence(
	record: StepAttemptRecord,
	previous: AttemptSeries | undefined,
	entriesById: ReadonlyMap<string, Entry>,
): void {
	const previousRecord = previous?.record;
	const previousResult = previousRecord ? entriesById.get(previousRecord.resultEntryId) : undefined;
	const continuesSeries =
		previousRecord !== undefined &&
		previousRecord.step === record.step &&
		(previousResult === undefined || previousResult.seq >= record.seq);
	const expectedAttempt = continuesSeries ? previousRecord.attempt + 1 : 1;
	if (record.attempt !== expectedAttempt) {
		corrupt(
			"non_consecutive_attempt",
			`${record.step} attempt ${record.id} is ${record.attempt}; expected ${expectedAttempt}`,
		);
	}
	if (!continuesSeries || record.step === "assistant" || previousRecord === undefined) return;
	if (record.resultEntryId !== previousRecord.resultEntryId) {
		corrupt("inconsistent_step", `${record.step} attempts disagree on their result entry id`);
	}
	if (record.compactionReason !== previousRecord.compactionReason) {
		corrupt("inconsistent_step", `${record.step} attempts disagree on their compaction reason`);
	}
}

function validateAttemptResult(entriesById: ReadonlyMap<string, Entry>, record: StepAttemptRecord): void {
	switch (record.step) {
		case "assistant":
			validateResultEntry(
				entriesById,
				record.resultEntryId,
				(entry) => entry.type === "message" && entry.message.role === "assistant",
				"assistant result",
			);
			break;
		case "compaction":
			validateResultEntry(
				entriesById,
				record.resultEntryId,
				(entry) => entry.type === "compaction",
				"compaction result",
			);
			break;
		case "branch_summary":
			validateResultEntry(
				entriesById,
				record.resultEntryId,
				(entry) => entry.type === "branch_summary",
				"branch-summary result",
			);
			break;
	}
}

function validateToolStart(
	record: Extract<LaneRecord, { type: "tool_started" }>,
	entriesById: ReadonlyMap<string, Entry>,
	invocations: Set<string>,
): void {
	const invocation = `${record.assistantEntryId}\u0000${record.toolIndex}`;
	if (invocations.has(invocation)) {
		corrupt(
			"duplicate_tool_invocation",
			`Tool invocation ${record.assistantEntryId}:${record.toolIndex} is duplicated`,
		);
	}
	invocations.add(invocation);

	const assistantEntry = entriesById.get(record.assistantEntryId);
	if (!assistantEntry || assistantEntry.type !== "message" || assistantEntry.message.role !== "assistant") {
		corrupt("tool_call_mismatch", `Tool start ${record.id} does not reference an assistant entry`);
	}
	const toolCalls = assistantEntry.message.content.filter((content) => content.type === "toolCall");
	const toolCall = toolCalls[record.toolIndex];
	if (!toolCall || toolCall.id !== record.toolCallId || toolCall.name !== record.toolName) {
		corrupt("tool_call_mismatch", `Tool start ${record.id} does not match its assistant tool-call ordinal`);
	}

	validateResultEntry(
		entriesById,
		record.resultEntryId,
		(entry) =>
			entry.type === "message" &&
			entry.message.role === "toolResult" &&
			entry.message.toolCallId === record.toolCallId &&
			entry.message.toolName === record.toolName,
		"tool result",
	);
}

function validateDeferredHandles(entries: Iterable<Entry>): void {
	for (const entry of entries) {
		if (
			entry.type === "message" &&
			entry.message.role === "assistant" &&
			entry.message.stopReason === "deferred" &&
			!entry.message.deferred
		) {
			corrupt("invalid_deferred_handle", `Deferred assistant entry ${entry.id} does not carry a handle`);
		}
	}
}

function validateOperationResult(entriesById: ReadonlyMap<string, Entry>, record: OperationStartedRecord): void {
	switch (record.intent.kind) {
		case "run":
			for (const target of record.intent.initialMessages) validateExactProvisionedEntry(entriesById, target);
			break;
		case "compaction":
			validateResultEntry(
				entriesById,
				record.intent.resultEntryId,
				(entry) => entry.type === "compaction",
				"manual compaction",
			);
			break;
		case "navigation":
			if (record.intent.summaryEntryId) {
				validateResultEntry(
					entriesById,
					record.intent.summaryEntryId,
					(entry) => entry.type === "branch_summary",
					"navigation summary",
				);
			}
			break;
	}
}

/** Validates a bounded lane recovery slice without reading or mutating session state. */
export function validateRecordLog(input: RecordLogSlice): void {
	// 恢复前先验证一个有限的 lane 日志切片：所有 record 的引用、序号、工具调用和
	// operation 生命周期都必须自洽；该函数只读输入，不尝试修复损坏日志。
	if (input.openOperations.length > 1) {
		corrupt("multiple_open_operations", `Lane ${input.lane} has at least two open operations`);
	}

	const entriesById = new Map(input.entries.map((entry) => [entry.id, entry]));
	validateDeferredHandles(entriesById.values());
	const starts = new Map<string, OperationStartedRecord>();
	const finishedAt = new Map<string, number>();
	const abortedAt = new Map<string, number>();
	const queueEnqueues = new Map<string, Extract<LaneRecord, { type: "queue_enqueued" }>>();
	const latestAttempt = new Map<string, AttemptSeries>();
	const toolInvocations = new Set<string>();
	const records = [...input.records].sort((left, right) => left.seq - right.seq);

	for (const record of records) {
		if (record.type === "operation_started") {
			starts.set(record.id, record);
			validateOperationResult(entriesById, record);
			continue;
		}

		if (hasRunId(record)) {
			if (!starts.has(record.runId)) {
				corrupt("unknown_operation", `Record ${record.id} references unknown operation ${record.runId}`);
			}
			const finishSeq = finishedAt.get(record.runId);
			if (finishSeq !== undefined && record.seq > finishSeq) {
				corrupt("record_after_finish", `Record ${record.id} follows the finish of operation ${record.runId}`);
			}
		}

		switch (record.type) {
			case "operation_finished":
				finishedAt.set(record.runId, record.seq);
				break;
			case "abort_requested":
				abortedAt.set(record.runId, record.seq);
				break;
			case "step_attempt":
				validateAttemptReason(record);
				validateAttemptSequence(record, latestAttempt.get(record.runId), entriesById);
				validateAttemptResult(entriesById, record);
				latestAttempt.set(record.runId, { record });
				break;
			case "tool_started":
				validateToolStart(record, entriesById, toolInvocations);
				break;
			case "queue_enqueued":
				if (
					record.queue !== "nextRun" &&
					abortedAt.get(record.runId) !== undefined &&
					record.seq > abortedAt.get(record.runId)!
				) {
					corrupt("queue_after_abort", `${record.queue} item ${record.target.id} was enqueued after abort`);
				}
				queueEnqueues.set(record.target.id, record);
				validateExactProvisionedEntry(entriesById, record.target);
				break;
			case "queue_cancelled": {
				const enqueue = queueEnqueues.get(record.entryId);
				if (
					!enqueue ||
					enqueue.seq >= record.seq ||
					enqueue.runId !== record.runId ||
					entriesById.has(record.entryId)
				) {
					corrupt("invalid_queue_cancellation", `Queue cancellation ${record.id} has no pending matching enqueue`);
				}
				break;
			}
			case "write_deferred":
				validateExactProvisionedEntry(entriesById, record.target);
				break;
			case "usage":
				break;
		}
	}
}

// 深层复制 helper：reducer 输出的对象不应与 storage 中的对象共享引用。
function clone<T>(value: T): T {
	return structuredClone(value);
}

// 按 seq 升序排序。storage 读出来的 record/entry 不保证有序，所有回放前必须先排。
function bySequence<T extends { seq: number }>(values: readonly T[]): T[] {
	return [...values].sort((left, right) => left.seq - right.seq);
}

// 派生有效配置：从 defaults 起步，按 seq 顺序回放 model_change / thinking_level_change /
// active_tools_change / assistant message，覆盖 model / thinkingLevel / activeToolNames。
// 注意 assistant 消息会刷新 model 字段（让它与"最后一次实际跑过的模型"对齐）。
function deriveEffectiveConfiguration(input: LaneReductionInput): EffectiveLaneConfiguration {
	let configuration = clone(input.defaults);
	const entriesById = new Map<string, Entry>();
	for (const entry of [...input.configurationEntries, ...input.ownEntries]) entriesById.set(entry.id, entry);

	for (const entry of bySequence([...entriesById.values()])) {
		switch (entry.type) {
			case "model_change":
				configuration = {
					...configuration,
					model: { provider: entry.provider, modelId: entry.modelId },
				};
				break;
			case "thinking_level_change":
				configuration = {
					...configuration,
					thinkingLevel: entry.thinkingLevel as ThinkingLevel,
				};
				break;
			case "active_tools_change":
				configuration = {
					...configuration,
					activeToolNames: [...entry.activeToolNames],
				};
				break;
			case "message":
				if (entry.message.role === "assistant") {
					configuration = {
						...configuration,
						model: {
							provider: entry.message.provider,
							modelId: entry.message.model,
						},
					};
				}
				break;
		}
	}
	return configuration;
}

// 派生 "lane 自己最近产出的一条 entry" 的摘要（entryId + type + role + stopReason）。
// 给上层用来快速判断 lane 当前停在哪一种消息上（用户 / 助手 / 工具结果 / 错误 / deferred）。
function deriveNewestOwn(
	entry: Entry | undefined,
): NonNullable<NonNullable<LaneState["operation"]>["newestOwn"]> | null {
	if (!entry) return null;
	if (entry.type !== "message") return { entryId: entry.id, type: entry.type };
	if (entry.message.role !== "assistant") {
		return { entryId: entry.id, type: entry.type, role: entry.message.role };
	}
	return {
		entryId: entry.id,
		type: entry.type,
		role: entry.message.role,
		stopReason: entry.message.stopReason,
	};
}

// 派生工具调用批：找到本次 operation 自己产生的、且带 toolCall 的最后一条 assistant entry，
// 把它的每个 toolCall 跟 tool_started 日志 + 后续 toolResult 条目对齐。
// 如果某个 toolCall 既没有 started 也没有 result，就是 unresolved；
// stopReason === "length" 时 truncated=true。
// deferredWriteIds 是被 write_deferred 但还没落地的 entry id，用于排除"假装没结果"的情况。
function deriveToolBatch(
	operationId: string,
	records: readonly LaneRecord[],
	ownEntries: readonly Entry[],
	entriesById: ReadonlyMap<string, Entry>,
	deferredWriteIds: ReadonlySet<string>,
): ToolBatchState | null {
	const assistantEntry = [...ownEntries]
		.reverse()
		.find(
			(entry) =>
				entry.type === "message" &&
				entry.message.role === "assistant" &&
				entry.message.content.some((content) => content.type === "toolCall"),
		);
	if (!assistantEntry || assistantEntry.type !== "message" || assistantEntry.message.role !== "assistant") return null;

	const toolCalls = assistantEntry.message.content.filter(
		(content): content is AgentToolCall => content.type === "toolCall",
	);
	const starts = new Map<number, ToolStartedRecord>();
	for (const record of records) {
		if (
			record.type === "tool_started" &&
			record.runId === operationId &&
			record.assistantEntryId === assistantEntry.id
		) {
			starts.set(record.toolIndex, record);
		}
	}

	const calls = toolCalls.map((toolCall, toolIndex) => {
		const started = starts.get(toolIndex);
		const startedResult = started ? entriesById.get(started.resultEntryId) : undefined;
		const blockedResult = ownEntries.find(
			(entry) =>
				entry.seq > assistantEntry.seq &&
				!deferredWriteIds.has(entry.id) &&
				entry.type === "message" &&
				entry.message.role === "toolResult" &&
				entry.message.toolCallId === toolCall.id,
		);
		const result = startedResult ?? blockedResult;
		return {
			toolIndex,
			toolCall: clone(toolCall),
			...(started ? { started: clone(started) } : {}),
			resultExists: result !== undefined,
			...(result?.type === "message" && result.terminate === true ? { terminate: true } : {}),
		};
	});

	return {
		assistantEntryId: assistantEntry.id,
		calls,
		truncated: assistantEntry.message.stopReason === "length",
		unresolved: calls.some((call) => !call.resultExists),
	};
}

/** Purely reconstructs one lane's orchestration state from its bounded recovery inputs. */
// reducer 的主入口：
//   1) 先 validateRecordLog 拒绝协议不可能产生的状态（坏日志不修复，直接抛 RecordLogCorruption）
//   2) 按 seq 排序后过滤出本次 open operation 的 records，派生 effectiveConfiguration
//   3) 组装 LaneState(operation / pendingSteer / pendingFollowUp / pendingWrites / deferred /
//      overflowRecoveryUsed / newestOwn / targets / pendingNextRun)
//   4) 检查最新 assistant 条目是否 stopReason === "error"，若是则记为 terminalFailure
export function reduceLaneState(input: LaneReductionInput): LaneReductionResult {
	// reducer 是纯投影：把 storage 读出的 entries/records 转成当前 lane 的有效状态。
	// 同一份输入应得到同一结果，真正的写入和恢复动作由 Harness operation 负责。
	validateRecordLog(input);

	const records = bySequence(input.records);
	const ownEntries = bySequence(input.ownEntries);
	const entriesById = new Map<string, Entry>();
	for (const entry of [...input.entries, ...ownEntries]) entriesById.set(entry.id, entry);
	const cancelledQueueIds = new Set(
		records.filter((record) => record.type === "queue_cancelled").map((record) => record.entryId),
	);
	const pendingQueueRecords = records.filter(
		(record): record is QueueEnqueuedRecord =>
			record.type === "queue_enqueued" &&
			!entriesById.has(record.target.id) &&
			!cancelledQueueIds.has(record.target.id),
	);
	const started = input.openOperations[0];
	const capturedInitialMessageIds = new Set(
		started?.intent.kind === "run" ? started.intent.initialMessages.map((target) => target.id) : [],
	);
	const pendingNextRun = pendingQueueRecords
		.filter((record) => record.queue === "nextRun" && !capturedInitialMessageIds.has(record.target.id))
		.map((record) => clone(record.target));
	const effectiveConfiguration = deriveEffectiveConfiguration(input);

	if (!started) {
		return {
			laneState: {
				lane: input.lane,
				leafId: input.leafId,
				operation: null,
				pendingNextRun,
			},
			effectiveConfiguration,
			terminalFailure: null,
		};
	}

	const operationRecords = records.filter((record) =>
		record.type === "operation_started" ? record.id === started.id : "runId" in record && record.runId === started.id,
	);
	const aborting = operationRecords.some((record) => record.type === "abort_requested");
	const pendingSteer = aborting
		? []
		: pendingQueueRecords
				.filter((record) => record.queue === "steer" && record.runId === started.id)
				.map((record) => clone(record.target));
	const pendingFollowUp = aborting
		? []
		: pendingQueueRecords
				.filter((record) => record.queue === "followUp" && record.runId === started.id)
				.map((record) => clone(record.target));
	const pendingWrites = operationRecords
		.filter(
			(record): record is WriteDeferredRecord =>
				record.type === "write_deferred" && !entriesById.has(record.target.id),
		)
		.map((record) => clone(record.target));
	const missingInitialMessages =
		started.intent.kind === "run"
			? started.intent.initialMessages.filter((target) => !entriesById.has(target.id)).map(clone)
			: [];

	const newestAttempt = operationRecords.filter((record) => record.type === "step_attempt").at(-1);
	const step =
		newestAttempt && !entriesById.has(newestAttempt.resultEntryId)
			? {
					kind: newestAttempt.step,
					attempts: newestAttempt.attempt,
					resultEntryId: newestAttempt.resultEntryId,
					...(newestAttempt.step === "compaction" ? { compactionReason: newestAttempt.compactionReason } : {}),
				}
			: null;

	const consumedInputIds = new Set<string>();
	if (started.intent.kind === "run") {
		for (const target of started.intent.initialMessages) consumedInputIds.add(target.id);
	}
	for (const record of operationRecords) {
		if (record.type === "queue_enqueued" && record.queue !== "nextRun") consumedInputIds.add(record.target.id);
	}
	let newestConsumedInputSequence = Number.NEGATIVE_INFINITY;
	for (const id of consumedInputIds) {
		const entry = entriesById.get(id);
		if (entry?.type === "message") newestConsumedInputSequence = Math.max(newestConsumedInputSequence, entry.seq);
	}
	const overflowRecoveryUsed = operationRecords.some(
		(record) =>
			record.type === "step_attempt" &&
			record.step === "compaction" &&
			record.compactionReason === "overflow" &&
			record.seq > newestConsumedInputSequence,
	);

	const newestOwnEntry = ownEntries.at(-1);
	const newestOwn = deriveNewestOwn(newestOwnEntry);
	const deferred =
		newestOwnEntry?.type === "message" &&
		newestOwnEntry.message.role === "assistant" &&
		newestOwnEntry.message.stopReason === "deferred" &&
		newestOwnEntry.message.deferred
			? clone(newestOwnEntry.message.deferred)
			: null;
	const targets: { result?: boolean; summary?: boolean } = {};
	if (started.intent.kind === "compaction") {
		targets.result = entriesById.has(started.intent.resultEntryId);
	} else if (started.intent.kind === "navigation" && started.intent.summaryEntryId) {
		targets.summary = entriesById.has(started.intent.summaryEntryId);
	}

	const deferredWriteIds = new Set(
		operationRecords.filter((record) => record.type === "write_deferred").map((record) => record.target.id),
	);
	let terminalFailure: TerminalFailureState | null = null;
	if (
		newestOwnEntry?.type === "message" &&
		newestOwnEntry.message.role === "assistant" &&
		newestOwnEntry.message.stopReason === "error" &&
		!deferredWriteIds.has(newestOwnEntry.id)
	) {
		const producedByStep = operationRecords.some(
			(record) => record.type === "step_attempt" && record.resultEntryId === newestOwnEntry.id,
		);
		const previousOwnEntry = ownEntries.at(-2);
		const producedByDeferredFetch =
			operationRecords.some(
				(record) =>
					record.type === "usage" && record.cause === "deferred_fetch" && record.entryId === newestOwnEntry.id,
			) ||
			(previousOwnEntry?.type === "message" &&
				previousOwnEntry.message.role === "assistant" &&
				previousOwnEntry.message.stopReason === "deferred");
		if (producedByStep || producedByDeferredFetch) {
			terminalFailure = {
				entryId: newestOwnEntry.id,
				source: producedByStep ? "step" : "deferred_fetch",
				message: clone(newestOwnEntry.message),
			};
		}
	}

	return {
		laneState: {
			lane: input.lane,
			leafId: input.leafId,
			operation: {
				id: started.id,
				kind: started.intent.kind,
				intent: clone(started.intent),
				aborting,
				step,
				toolBatch: deriveToolBatch(started.id, operationRecords, ownEntries, entriesById, deferredWriteIds),
				missingInitialMessages,
				pendingSteer,
				pendingFollowUp,
				pendingWrites,
				deferred,
				overflowRecoveryUsed,
				newestOwn,
				targets,
			},
			pendingNextRun,
		},
		effectiveConfiguration,
		terminalFailure,
	};
}
