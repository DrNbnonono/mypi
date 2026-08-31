import type { Static, TSchema } from "typebox";

export interface SecAgentTextContent {
	type: "text";
	text: string;
}

export interface SecAgentToolResult<TDetails> {
	content: SecAgentTextContent[];
	details: TDetails;
	isError?: boolean;
}

export interface SecAgentExtensionUI {
	confirm(title: string, message: string): Promise<boolean>;
	notify(message: string, type?: "info" | "warning" | "error"): void;
	setStatus(key: string, text: string | undefined): void;
	editor(title: string, prefill?: string): Promise<string | undefined>;
}

export interface SecAgentExtensionContext {
	readonly cwd: string;
	readonly hasUI: boolean;
	readonly ui: SecAgentExtensionUI;
}

export interface SecAgentBeforeStartEvent {
	systemPrompt: string;
}

export interface SecAgentToolCallEvent {
	toolCallId: string;
	toolName: string;
	input: unknown;
}

export interface SecAgentToolResultEvent {
	toolCallId: string;
	isError: boolean;
	content: unknown;
}

export interface SecAgentToolDefinition<TParams extends TSchema = TSchema, TDetails = unknown> {
	name: string;
	label: string;
	description: string;
	promptSnippet?: string;
	parameters: TParams;
	execute(
		toolCallId: string,
		params: Static<TParams>,
		signal: AbortSignal | undefined,
		onUpdate: ((result: SecAgentToolResult<TDetails>) => void) | undefined,
		ctx: SecAgentExtensionContext,
	): Promise<SecAgentToolResult<TDetails>>;
}

export interface SecAgentEventBus {
	on(event: string, listener: (payload: unknown) => void): () => void;
	emit(event: string, payload: unknown): void;
}

type MaybePromise<T> = T | Promise<T>;

export interface SecAgentExtensionAPI {
	on(
		event: "before_agent_start",
		handler: (
			event: SecAgentBeforeStartEvent,
			ctx: SecAgentExtensionContext,
		) => MaybePromise<{ systemPrompt: string } | undefined>,
	): void;
	on(
		event: "tool_call",
		handler: (
			event: SecAgentToolCallEvent,
			ctx: SecAgentExtensionContext,
		) => MaybePromise<{ block: true; reason: string } | undefined>,
	): void;
	on(
		event: "tool_result",
		handler: (event: SecAgentToolResultEvent, ctx: SecAgentExtensionContext) => MaybePromise<void>,
	): void;
	on(
		event: "session_start" | "session_shutdown" | "session_tree",
		handler: (event: unknown, ctx: SecAgentExtensionContext) => MaybePromise<void>,
	): void;
	registerTool<TParams extends TSchema = TSchema, TDetails = unknown>(
		tool: SecAgentToolDefinition<TParams, TDetails>,
	): void;
	registerCommand(
		name: string,
		options: {
			description?: string;
			handler: (args: string, ctx: SecAgentExtensionContext) => Promise<void>;
		},
	): void;
	readonly events: SecAgentEventBus;
}

export interface SecAgentInlineExtension {
	name: string;
	hidden?: boolean;
	factory(host: unknown): void | Promise<void>;
}

export function defineSecAgentExtension(
	name: string,
	factory: (pi: SecAgentExtensionAPI) => void | Promise<void>,
	options?: { hidden?: boolean },
): SecAgentInlineExtension {
	return {
		name,
		factory: (host) => factory(host as SecAgentExtensionAPI),
		...(options?.hidden === undefined ? {} : { hidden: options.hidden }),
	};
}
