import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = join(packageRoot, "fixtures");
const templateRoot = join(packageRoot, "templates");

async function readFixture(path: string): Promise<string> {
	return readFile(join(fixtureRoot, path), "utf8");
}

describe("offline loopback/container fixtures", () => {
	it("contains the complete offline fixture manifest", async () => {
		const manifest = JSON.parse(await readFixture("manifest.json")) as {
			offline: boolean;
			publicNetwork: boolean;
			tools: string[];
			fixtures: Array<{ id: string; path: string }>;
		};
		expect(manifest.offline).toBe(true);
		expect(manifest.publicNetwork).toBe(false);
		expect(manifest.tools).toEqual(["nmap", "curl", "file", "binutils", "binwalk", "libimage-exiftool-perl"]);
		expect(manifest.fixtures.map((fixture) => fixture.id)).toEqual([
			"web-http",
			"network-discovery",
			"pwn-elf",
			"reverse-elf",
			"forensics-png",
		]);
		for (const fixture of manifest.fixtures) await expect(readFixture(fixture.path)).resolves.toBeTruthy();
	});

	it("keeps service bindings and published ports local", async () => {
		const server = await readFixture("web/http-server.mjs");
		const compose = await readFile(join(templateRoot, "docker-compose.yml"), "utf8");
		expect(server).toContain('process.env.FIXTURE_HOST ?? "127.0.0.1"');
		expect(server).toContain('new Set(["127.0.0.1", "0.0.0.0"])');
		expect(compose).toContain("internal: true");
		expect(compose).toMatch(/127\.0\.0\.1:\$\{SECAGENT_WEB_PORT:-30141\}:30141/);
		expect(compose).not.toMatch(/ports:\s*\n\s*-\s*["'](?!127\.0\.0\.1)/);
		expect(compose).not.toContain("fixture-web:8080:8080");
	});

	it("pins the required apt security tools and exposes both entries", async () => {
		const dockerfile = await readFile(join(templateRoot, "Dockerfile"), "utf8");
		for (const packageName of ["nmap", "curl", "file", "binutils", "binwalk", "libimage-exiftool-perl"]) {
			expect(dockerfile).toMatch(new RegExp(`\\"${packageName}=[^\\"]+\\"`));
		}
		expect(dockerfile).toContain("BASE_IMAGE=node:22-bookworm-slim");
		expect(dockerfile).toContain("SecAgent image diagnostic");
		expect(dockerfile).toContain("node packages/web-ui/bin/prepare-runtime.js --mark-only");
		for (const runtimePackage of [
			"pi-sandbox@0.6.3",
			"pi-mcp-adapter@2.23.0",
			"pi-subagents@0.50.0",
			"pi-trace-extension@0.1.14",
		]) {
			expect(dockerfile).toContain(runtimePackage);
		}
		expect(dockerfile).toContain("HOME=/tmp/secagent-home");
		const entrypoint = await readFile(join(templateRoot, "entrypoint.sh"), "utf8");
		expect(entrypoint).toContain("--agent-mode sec");
		expect(entrypoint).toContain("pi-web.js start");
	});

	it("contains no public network target or secret material", async () => {
		const manifest = JSON.parse(await readFixture("manifest.json")) as {
			allowedHosts: string[];
			fixtures: Array<{ target?: string }>;
		};
		const allowedHosts = new Set(manifest.allowedHosts);
		for (const fixture of manifest.fixtures) {
			if (!fixture.target) continue;
			const target = fixture.target.includes("://") ? new URL(fixture.target).hostname : fixture.target;
			expect(allowedHosts.has(target), `${fixture.target} is outside the fixture allow-list`).toBe(true);
		}
		const sourceFiles = [
			"README.md",
			"web/http-server.mjs",
			"pwn/vulnerable.c",
			"reverse/branchy.c",
			"forensics/create-sample.mjs",
		];
		for (const path of sourceFiles) {
			const source = await readFixture(path);
			expect(source).not.toMatch(/(?:sk-|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]+ KEY-----)/);
			expect(source).not.toMatch(/https?:\/\/(?!127\.0\.0\.1|localhost|fixture-web)/);
		}
	});
});
