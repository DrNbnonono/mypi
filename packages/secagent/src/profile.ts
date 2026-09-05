import type { SecurityBrowserService } from "./browser/service.ts";
import type { CompetitionProvider } from "./competition/provider.ts";
import type { CompetitionAttemptWorkspace } from "./competition/scheduler.ts";
import type { SecuritySessionStore } from "./core/state.ts";
import type { CompetitionChallenge } from "./core/types.ts";
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
import { resolveSecAgentRuntimePackage, SECAGENT_RUNTIME_PACKAGE_SOURCES } from "./runtime-packages.ts";

export interface CreateSecAgentProfileOptions {
	runtimePackageSources?: readonly string[];
	competitionProvider?: CompetitionProvider;
	competitionMaxConcurrent?: number;
	competitionCallsPerSecond?: number;
	competitionHintsAllowed?: boolean;
	createCompetitionAttemptWorkspace?: (
		challenge: CompetitionChallenge,
		attemptId: string,
	) => Promise<CompetitionAttemptWorkspace>;
	browserService?: SecurityBrowserService;
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

function runtimePackageName(source: string): string | undefined {
	if (!source.startsWith("npm:")) return undefined;
	const spec = source.slice(4);
	const separator = spec.lastIndexOf("@");
	return separator > 0 ? spec.slice(0, separator) : spec;
}

function runtimePackageMatches(source: string): boolean {
	const packageName = runtimePackageName(source);
	if (!packageName) return true;
	const spec = source.slice(source.lastIndexOf("npm:") + 4);
	const expectedVersion = spec.slice(spec.lastIndexOf("@") + 1);
	const resolved = resolveSecAgentRuntimePackage(packageName);
	return resolved?.version === expectedVersion;
}

export function resolveSecAgentRuntimePackagePaths(sources: readonly string[]): string[] {
	return sources.flatMap((source) => {
		const packageName = runtimePackageName(source);
		if (!packageName) return [source];
		const resolvedPackage = resolveSecAgentRuntimePackage(packageName);
		return resolvedPackage ? [resolvedPackage.rootPath] : [];
	});
}

export function createSecAgentProfile(options: CreateSecAgentProfileOptions = {}): SecAgentProfileDefinition {
	let runtime: SecAgentRuntime | undefined;
	const runtimePackageSources = options.runtimePackageSources ?? SECAGENT_RUNTIME_PACKAGE_SOURCES;
	const runtimePackagesReady = runtimePackageSources.every(runtimePackageMatches);
	return {
		mode: "sec",
		displayName: "Security",
		resourcePaths: { extensionPaths: resolveSecAgentRuntimePackagePaths(runtimePackageSources) },
		createRuntime: (context) => {
			runtime = new SecAgentRuntime(context.sessionManager, {
				cwd: context.cwd,
				runtimePackagesReady,
				competitionProvider: options.competitionProvider,
				competitionMaxConcurrent: options.competitionMaxConcurrent,
				competitionCallsPerSecond: options.competitionCallsPerSecond,
				competitionHintsAllowed: options.competitionHintsAllowed,
				createCompetitionAttemptWorkspace: options.createCompetitionAttemptWorkspace,
				browserService: options.browserService,
			});
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
