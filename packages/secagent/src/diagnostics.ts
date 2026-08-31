import { access, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, parse } from "node:path";
import { fileURLToPath } from "node:url";
import type { IsolationState } from "./core/types.ts";
import { SECAGENT_RUNTIME_PACKAGE_SOURCES } from "./runtime-packages.ts";
import type { SecurityToolExecutionContext } from "./tools/adapter.ts";
import { defaultSecurityToolExecutor } from "./tools/executor.ts";
import { listSecurityToolAdapters } from "./tools/registry.ts";

export type SecAgentDiagnosticStatus = "pass" | "warn" | "fail";

export interface SecAgentDiagnosticCheck {
	id: string;
	label: string;
	status: SecAgentDiagnosticStatus;
	message: string;
	details?: Record<string, unknown>;
}

export interface SecAgentDiagnostics {
	createdAt: string;
	cwd: string;
	tempDir: string;
	ready: boolean;
	runtimeReady: boolean;
	autonomousReady: boolean;
	demoReady: boolean;
	checks: SecAgentDiagnosticCheck[];
}

export interface RunSecAgentDiagnosticsOptions {
	cwd: string;
	isolation: IsolationState;
	reportDir?: string;
	executionContext?: Omit<SecurityToolExecutionContext, "cwd">;
}

const require = createRequire(import.meta.url);

function runtimePackageName(source: string): string {
	const withoutPrefix = source.startsWith("npm:") ? source.slice(4) : source;
	const versionSeparator = withoutPrefix.lastIndexOf("@");
	return versionSeparator > 0 ? withoutPrefix.slice(0, versionSeparator) : withoutPrefix;
}

function runtimePackageVersion(source: string): string | undefined {
	const withoutPrefix = source.startsWith("npm:") ? source.slice(4) : source;
	const versionSeparator = withoutPrefix.lastIndexOf("@");
	return versionSeparator > 0 ? withoutPrefix.slice(versionSeparator + 1) : undefined;
}

async function resolvedPackageVersion(entryPath: string): Promise<string | undefined> {
	let current = dirname(entryPath);
	const root = parse(current).root;
	while (current !== root) {
		try {
			const parsed = JSON.parse(await readFile(join(current, "package.json"), "utf8")) as { version?: unknown };
			return typeof parsed.version === "string" ? parsed.version : undefined;
		} catch {
			current = dirname(current);
		}
	}
	return undefined;
}

async function runtimePackageCheck(source: string): Promise<SecAgentDiagnosticCheck> {
	const packageName = runtimePackageName(source);
	const expectedVersion = runtimePackageVersion(source);
	try {
		const entryPath = require.resolve(packageName);
		const actualVersion = await resolvedPackageVersion(entryPath);
		const versionMatches = expectedVersion === undefined || actualVersion === expectedVersion;
		return {
			id: `runtime-package:${packageName}`,
			label: packageName,
			status: versionMatches ? "pass" : "warn",
			message: versionMatches
				? `available${actualVersion ? ` at ${actualVersion}` : ""}`
				: `expected ${expectedVersion}, resolved ${actualVersion ?? "unknown"}`,
			details: { source, entryPath, expectedVersion, actualVersion },
		};
	} catch (error) {
		return {
			id: `runtime-package:${packageName}`,
			label: packageName,
			status: "warn",
			message:
				"not available in the current Node resolution scope; install the pinned package in the controlled deployment before starting the Sec profile",
			details: { source, error: error instanceof Error ? error.message : String(error) },
		};
	}
}

async function writableDirectoryCheck(id: string, label: string, path: string): Promise<SecAgentDiagnosticCheck> {
	try {
		await access(path, 2);
		return { id, label, status: "pass", message: `writable: ${path}`, details: { path } };
	} catch (error) {
		return {
			id,
			label,
			status: "fail",
			message: `not writable: ${path}`,
			details: { path, error: error instanceof Error ? error.message : String(error) },
		};
	}
}

async function specialistAgentCheck(): Promise<SecAgentDiagnosticCheck> {
	const agentsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "agents");
	const names = ["sec-recon", "sec-web", "sec-analysis", "sec-response", "sec-vuln", "sec-reverse"];
	const missing: string[] = [];
	for (const name of names) {
		try {
			await access(join(agentsDir, `${name}.md`));
		} catch {
			missing.push(name);
		}
	}
	return {
		id: "specialist-agents",
		label: "Specialist agents",
		status: missing.length === 0 ? "pass" : "fail",
		message: missing.length === 0 ? `${names.length} definitions available` : `missing: ${missing.join(", ")}`,
		details: { agentsDir, names, missing },
	};
}

export async function runSecAgentDiagnostics(options: RunSecAgentDiagnosticsOptions): Promise<SecAgentDiagnostics> {
	const executionContext: SecurityToolExecutionContext = {
		cwd: options.cwd,
		executor: options.executionContext?.executor ?? defaultSecurityToolExecutor,
		signal: options.executionContext?.signal,
	};
	const toolChecks = await Promise.all(
		listSecurityToolAdapters().map(async (adapter): Promise<SecAgentDiagnosticCheck> => {
			try {
				const availability = await adapter.checkAvailability(executionContext);
				return {
					id: `tool:${adapter.metadata.name}`,
					label: adapter.metadata.name,
					status: availability.available ? "pass" : "warn",
					message: availability.available
						? `available${availability.version ? `: ${availability.version}` : ""}`
						: (availability.diagnostic?.message ?? "unavailable"),
					details: { availability },
				};
			} catch (error) {
				return {
					id: `tool:${adapter.metadata.name}`,
					label: adapter.metadata.name,
					status: "warn",
					message: error instanceof Error ? error.message : String(error),
				};
			}
		}),
	);
	const reportDir = options.reportDir ?? options.cwd;
	const checks: SecAgentDiagnosticCheck[] = [
		{
			id: "model-connectivity",
			label: "Model connectivity",
			status: "warn",
			message:
				"not actively probed to avoid a billable provider request; host Session startup remains authoritative",
		},
		{
			id: "ai-gateway",
			label: "AI security gateway",
			status: process.env.PI_AI_GATEWAY_URL || process.env.AI_GATEWAY_URL ? "pass" : "warn",
			message:
				process.env.PI_AI_GATEWAY_URL || process.env.AI_GATEWAY_URL
					? "gateway endpoint configured"
					: "no generic AI gateway endpoint configured; direct provider routing may be in use",
		},
		{
			id: "isolation",
			label: "Isolation",
			status: options.isolation.status === "unverified" ? "warn" : "pass",
			message:
				options.isolation.status === "unverified"
					? "isolation is unverified; autonomous mode cannot be enabled"
					: `${options.isolation.status}: ${options.isolation.source ?? "source not recorded"}`,
			details: { isolation: options.isolation },
		},
		await specialistAgentCheck(),
		...(await Promise.all(SECAGENT_RUNTIME_PACKAGE_SOURCES.map(runtimePackageCheck))),
		await writableDirectoryCheck("working-directory", "Working directory", options.cwd),
		await writableDirectoryCheck("temporary-directory", "Temporary directory", tmpdir()),
		await writableDirectoryCheck("report-directory", "Report directory", reportDir),
		...toolChecks,
	];
	const runtimeReady = checks.every((check) => check.status !== "fail");
	const runtimePackagesReady = checks
		.filter((check) => check.id.startsWith("runtime-package:"))
		.every((check) => check.status === "pass");
	const requiredDemoTools = new Set(["nmap", "curl", "file", "strings", "readelf", "objdump", "binwalk", "exiftool"]);
	const demoToolsReady = checks
		.filter((check) => check.id.startsWith("tool:") && requiredDemoTools.has(check.id.slice("tool:".length)))
		.every((check) => check.status === "pass");
	const isolationReady = options.isolation.status !== "unverified";
	return {
		createdAt: new Date().toISOString(),
		cwd: options.cwd,
		tempDir: tmpdir(),
		ready: runtimeReady,
		runtimeReady,
		autonomousReady: runtimeReady && runtimePackagesReady && isolationReady,
		demoReady: runtimeReady && runtimePackagesReady && demoToolsReady && isolationReady,
		checks,
	};
}
