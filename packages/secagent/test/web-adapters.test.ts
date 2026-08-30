import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SecurityToolCommandResult, SecurityToolExecutor } from "../src/tools/adapter.ts";
import { getSecurityToolAdapter } from "../src/tools/registry.ts";

class FakeExecutor implements SecurityToolExecutor {
	readonly calls: Array<{ command: string; args: readonly string[] }> = [];
	run(command: string, args: readonly string[]): Promise<SecurityToolCommandResult> {
		this.calls.push({ command, args });
		if (["-version", "-V"].includes(args[0] ?? "")) return Promise.resolve({ stdout: `${command} 1.0`, stderr: "", exitCode: 0, timedOut: false, durationMs: 1 });
		const stdout = command === "httpx"
			? '{"url":"https://lab.example","status_code":200,"title":"Lab"}\n'
			: command === "ffuf"
				? '{"url":"https://lab.example/admin","status":200}\n'
				: '{"template-id":"fixture","matched-at":"https://lab.example/"}\n';
		return Promise.resolve({ stdout, stderr: "", exitCode: 0, timedOut: false, durationMs: 2 });
	}
}

const tempDirectories: string[] = [];
afterEach(async () => { for (const directory of tempDirectories.splice(0)) await rm(directory, { recursive: true, force: true }); });

describe("bounded web-security adapters", () => {
	it("normalizes httpx JSON and uses structured argv", async () => {
		const executor = new FakeExecutor();
		const result = await getSecurityToolAdapter("httpx")?.execute({ target: "https://lab.example", followRedirects: true }, { cwd: process.cwd(), executor });
		expect(result?.ok).toBe(true);
		expect((result?.output as { resultCount: number }).resultCount).toBe(1);
		expect(executor.calls.find((call) => call.command === "httpx" && call.args[0] !== "-version")?.args).toContain("-tech-detect");
	});

	it("requires an in-workspace wordlist and rate-bounds ffuf", async () => {
		const directory = await mkdtemp(join(tmpdir(), "pi-secagent-web-")); tempDirectories.push(directory);
		const wordlist = join(directory, "words.txt"); await writeFile(wordlist, "admin\napi\n");
		const executor = new FakeExecutor();
		const result = await getSecurityToolAdapter("ffuf")?.execute({ target: "https://lab.example/FUZZ", wordlist, rate: 80, threads: 20 }, { cwd: directory, executor });
		expect(result?.ok).toBe(true);
		const args = executor.calls.find((call) => call.command === "ffuf" && call.args[0] !== "-V")?.args ?? [];
		expect(args).toContain("-json");
		expect(args).toContain(wordlist);
		expect(args).not.toContain("-e");
	});

	it("uses only signed built-in nuclei templates and rejects malformed tags", async () => {
		const executor = new FakeExecutor();
		const adapter = getSecurityToolAdapter("nuclei");
		const invalid = await adapter?.execute({ target: "https://lab.example", tags: ["cve;rm"] }, { cwd: process.cwd(), executor });
		expect(invalid?.ok).toBe(false);
		const result = await adapter?.execute({ target: "https://lab.example", severities: ["high", "critical"], tags: ["cve"] }, { cwd: process.cwd(), executor });
		expect(result?.ok).toBe(true);
		const args = executor.calls.find((call) => call.command === "nuclei" && call.args[0] !== "-version")?.args ?? [];
		expect(args).toContain("-disable-unsigned-templates");
		expect(args).toContain("-no-interactsh");
		expect(args).not.toContain("-t");
	});
});
