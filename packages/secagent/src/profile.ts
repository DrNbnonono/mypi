import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import type { SecuritySessionStore } from "./core/state.ts";
import { createSecAgentExtension } from "./extension.ts";
import { createSecAgentCompetitionExtension } from "./extension-competition.ts";
import { SecAgentRuntime, type SecAgentRuntimeCommand } from "./runtime.ts";
import { SECAGENT_RUNTIME_PACKAGE_SOURCES } from "./runtime-packages.ts";

export interface CreateSecAgentProfileOptions {
	runtimePackageSources?: readonly string[];
}

interface SecAgentProfileRuntime {
	snapshot(): unknown;
	command(command: unknown): unknown;
	subscribe(listener: (snapshot: unknown) => void): () => void;
}

interface SecAgentProfileDefinition {
	mode: "sec";
	displayName: string;
	resourcePaths: { extensionPaths: string[] };
	createRuntime(context: { sessionManager: SecuritySessionStore }): SecAgentProfileRuntime;
	createExtensions(): InlineExtension[];
}

export function createSecAgentProfile(options: CreateSecAgentProfileOptions = {}): SecAgentProfileDefinition {
	let runtime: SecAgentRuntime | undefined;
	const runtimePackageSources = options.runtimePackageSources ?? SECAGENT_RUNTIME_PACKAGE_SOURCES;
	return {
		mode: "sec",
		displayName: "Security",
		resourcePaths: { extensionPaths: [...runtimePackageSources] },
		createRuntime: (context) => {
			runtime = new SecAgentRuntime(context.sessionManager);
			const profileRuntime: SecAgentProfileRuntime = {
				snapshot: () => runtime?.snapshot(),
				command: (command) => runtime?.command(command as SecAgentRuntimeCommand),
				subscribe: (listener) => runtime?.subscribe(listener) ?? (() => undefined),
			};
			return profileRuntime;
		},
		createExtensions: () => {
			if (!runtime) throw new Error("SecAgent profile runtime must be created before extensions");
			return [createSecAgentExtension(runtime), createSecAgentCompetitionExtension(runtime)];
		},
	};
}
