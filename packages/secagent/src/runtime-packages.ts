import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, parse } from "node:path";

export const SECAGENT_RUNTIME_PACKAGE_SOURCES = [
	"npm:pi-sandbox@0.6.3",
	"npm:pi-mcp-adapter@2.23.0",
	"npm:pi-subagents@0.50.0",
	"npm:pi-trace-extension@0.1.14",
] as const;

export type SecAgentRuntimePackageSource = (typeof SECAGENT_RUNTIME_PACKAGE_SOURCES)[number];

export interface ResolvedSecAgentRuntimePackage {
	entryPath: string;
	manifestPath: string;
	rootPath: string;
	version?: string;
}

const require = createRequire(import.meta.url);

export function resolveSecAgentRuntimePackage(
	packageName: string,
	resolver: (specifier: string) => string = require.resolve,
): ResolvedSecAgentRuntimePackage | undefined {
	let entryPath: string;
	try {
		entryPath = resolver(packageName);
	} catch {
		try {
			entryPath = resolver(`${packageName}/package.json`);
		} catch {
			return undefined;
		}
	}

	let current = dirname(entryPath);
	const filesystemRoot = parse(current).root;
	while (current !== filesystemRoot) {
		const manifestPath = join(current, "package.json");
		if (existsSync(manifestPath)) {
			try {
				const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { name?: unknown; version?: unknown };
				if (manifest.name === packageName) {
					return {
						entryPath,
						manifestPath,
						rootPath: current,
						version: typeof manifest.version === "string" ? manifest.version : undefined,
					};
				}
			} catch {
				// Continue toward the filesystem root when a parent manifest is malformed.
			}
		}
		current = dirname(current);
	}
	return undefined;
}
