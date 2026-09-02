import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveSecAgentRuntimePackage } from "../src/runtime-packages.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("SecAgent runtime package resolution", () => {
	it("resolves extension packages that only expose a package manifest", async () => {
		const packageRoot = await mkdtemp(join(tmpdir(), "pi-secagent-runtime-package-"));
		temporaryDirectories.push(packageRoot);
		const manifestPath = join(packageRoot, "package.json");
		await writeFile(manifestPath, JSON.stringify({ name: "fixture-extension", version: "1.2.3" }), "utf8");

		const resolved = resolveSecAgentRuntimePackage("fixture-extension", (specifier) => {
			if (specifier === "fixture-extension") throw new Error("Package has no main export");
			if (specifier === "fixture-extension/package.json") return manifestPath;
			throw new Error(`Unexpected specifier: ${specifier}`);
		});

		expect(resolved).toMatchObject({
			entryPath: manifestPath,
			manifestPath,
			rootPath: packageRoot,
			version: "1.2.3",
		});
	});

	it("falls back to the isolated runtime directory", async () => {
		const runtimeRoot = await mkdtemp(join(tmpdir(), "pi-secagent-runtime-root-"));
		const packageRoot = join(runtimeRoot, "node_modules", "fixture-extension");
		temporaryDirectories.push(runtimeRoot);
		await mkdir(packageRoot, { recursive: true });
		await writeFile(
			join(packageRoot, "package.json"),
			JSON.stringify({ name: "fixture-extension", version: "2.0.0" }),
			"utf8",
		);
		const previousRuntimeDirectory = process.env.PI_SECAGENT_RUNTIME_DIR;
		process.env.PI_SECAGENT_RUNTIME_DIR = runtimeRoot;
		try {
			const resolved = resolveSecAgentRuntimePackage("fixture-extension", () => {
				throw new Error("not available from the workspace");
			});
			expect(resolved).toMatchObject({ rootPath: packageRoot, version: "2.0.0" });
		} finally {
			if (previousRuntimeDirectory === undefined) delete process.env.PI_SECAGENT_RUNTIME_DIR;
			else process.env.PI_SECAGENT_RUNTIME_DIR = previousRuntimeDirectory;
		}
	});
});
