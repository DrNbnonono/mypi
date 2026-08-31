import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, parse } from "node:path";
import type { SecuritySessionStore } from "./core/state.ts";
import { createSecAgentExtension } from "./extension.ts";
import { createSecAgentAutonomousExtension } from "./extension-autonomous.ts";
import { createSecAgentBenchmarkExtension } from "./extension-benchmark.ts";
import { createSecAgentCandidateExtension } from "./extension-candidates.ts";
import { createSecAgentCompetitionExtension } from "./extension-competition.ts";
import { createSecAgentDelegationExtension } from "./extension-delegation.ts";
import { createSecAgentScopeGuardExtension } from "./extension-scope-guard.ts";
import { createSecAgentStaticAnalysisExtension } from "./extension-static-analysis.ts";
import { createSecAgentWebAnalysisExtension } from "./extension-web-analysis.ts";
import type { SecAgentInlineExtension } from "./host-contract.ts";
import { SecAgentRuntime, type SecAgentRuntimeCommand } from "./runtime.ts";
import { SECAGENT_RUNTIME_PACKAGE_SOURCES } from "./runtime-packages.ts";

export interface CreateSecAgentProfileOptions {
	runtimePackageSources?: readonly string[];
}
export interface SecAgentProfileRuntime {
	snapshot(): unknown;
	command(command: unknown): unknown | Promise<unknown>;
	subscribe(listener: (snapshot: unknown) => void): () => void;
}
export interface SecAgentProfileDefinition {
	mode: "sec";
	displayName: string;
	resourcePaths: { extensionPaths: string[] };
	createRuntime(context: { cwd: string; sessionManager: SecuritySessionStore }): SecAgentProfileRuntime;
	createExtensions(): SecAgentInlineExtension[];
}

const require = createRequire(import.meta.url);

function runtimePackageName(source: string): string | undefined {
	if (!source.startsWith("npm:")) return undefined;
	const spec = source.slice(4);
	const separator = spec.lastIndexOf("@");
	return separator > 0 ? spec.slice(0, separator) : spec;
}

function findPackageRoot(entryPath: string, packageName: string): string | undefined {
	let current = dirname(entryPath);
	const root = parse(current).root;
	while (current !== root) {
		const manifestPath = `${current}/package.json`;
		if (existsSync(manifestPath)) {
			try {
				const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { name?: unknown };
				if (manifest.name === packageName) return current;
			} catch {
				// Continue toward the filesystem root when a parent manifest is malformed.
			}
		}
		current = dirname(current);
	}
	return undefined;
}

export function resolveSecAgentRuntimePackagePaths(sources: readonly string[]): string[] {
	return sources.flatMap((source) => {
		const packageName = runtimePackageName(source);
		if (!packageName) return [source];
		try {
			const packageRoot = findPackageRoot(require.resolve(packageName), packageName);
			return packageRoot ? [packageRoot] : [];
		} catch {
			return [];
		}
	});
}

export function createSecAgentProfile(options: CreateSecAgentProfileOptions = {}): SecAgentProfileDefinition {
	let runtime: SecAgentRuntime | undefined;
	const runtimePackageSources = options.runtimePackageSources ?? SECAGENT_RUNTIME_PACKAGE_SOURCES;
	return {
		mode: "sec",
		displayName: "Security",
		resourcePaths: { extensionPaths: resolveSecAgentRuntimePackagePaths(runtimePackageSources) },
		createRuntime: (context) => {
			runtime = new SecAgentRuntime(context.sessionManager, { cwd: context.cwd });
			return {
				snapshot: () => runtime?.snapshot(),
				command: (command) => runtime?.command(command as SecAgentRuntimeCommand),
				subscribe: (listener) => runtime?.subscribe(listener) ?? (() => undefined),
			};
		},
		createExtensions: () => {
			if (!runtime) throw new Error("SecAgent profile runtime must be created before extensions");
			return [
				createSecAgentScopeGuardExtension(runtime),
				createSecAgentExtension(runtime),
				createSecAgentCandidateExtension(runtime),
				createSecAgentCompetitionExtension(runtime),
				createSecAgentAutonomousExtension(runtime),
				createSecAgentStaticAnalysisExtension(runtime),
				createSecAgentWebAnalysisExtension(runtime),
				createSecAgentDelegationExtension(runtime),
				createSecAgentBenchmarkExtension(runtime),
			];
		},
	};
}
