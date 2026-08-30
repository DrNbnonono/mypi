import { createSecAgentProfile } from "@earendil-works/pi-secagent";
import type { InlineExtension } from "./extensions/types.ts";
import type { SessionManager } from "./session-manager.ts";

export type AgentMode = "coding" | "sec";

export interface AgentProfileContext {
	cwd: string;
	sessionManager: SessionManager;
}

export interface ProfileResourcePaths {
	extensionPaths?: string[];
	skillPaths?: string[];
	promptTemplatePaths?: string[];
}

export interface AgentProfileRuntime {
	snapshot(): unknown;
	command(command: unknown): unknown | Promise<unknown>;
	subscribe(listener: (snapshot: unknown) => void): () => void;
}

export interface AgentProfileDefinition {
	mode: AgentMode;
	displayName: string;
	createExtensions(): InlineExtension[];
	createRuntime?(context: AgentProfileContext): AgentProfileRuntime;
	resourcePaths?: ProfileResourcePaths;
}

export interface AgentProfileInstance {
	definition: AgentProfileDefinition;
	runtime?: AgentProfileRuntime;
}

function createModeCommandExtension(): InlineExtension {
	return {
		name: "agent-profile",
		hidden: true,
		factory: (pi) => {
			pi.registerCommand("agent-mode", {
				description: "Create a new session in coding or sec mode",
				handler: async (args, ctx) => {
					const mode = args.trim();
					if (mode !== "coding" && mode !== "sec") {
						ctx.ui.notify("Usage: /agent-mode coding|sec", "error");
						return;
					}
					const result = await ctx.newSession({ agentMode: mode });
					if (!result.cancelled) ctx.ui.notify(`Created ${mode} session`, "info");
				},
			});
		},
	};
}

const CODING_PROFILE: AgentProfileDefinition = {
	mode: "coding",
	displayName: "Coding",
	createExtensions: () => [createModeCommandExtension()],
};

export function getStoredAgentMode(sessionManager: SessionManager): AgentMode {
	return sessionManager.getAgentMode();
}

export function assertAgentModeCompatible(sessionManager: SessionManager, requestedMode?: AgentMode): AgentMode {
	const storedMode = getStoredAgentMode(sessionManager);
	if (requestedMode && requestedMode !== storedMode) {
		throw new Error(
			`Session mode is ${storedMode}, but ${requestedMode} was requested. Create a new ${requestedMode} session instead.`,
		);
	}
	return storedMode;
}

export function createAgentProfile(mode: AgentMode, context: AgentProfileContext): AgentProfileInstance {
	const definition = mode === "sec" ? createSecAgentProfile() : CODING_PROFILE;
	const runtime = definition.createRuntime?.(context);
	return {
		definition: {
			...definition,
			createExtensions: () => [createModeCommandExtension(), ...definition.createExtensions()],
		},
		runtime,
	};
}
