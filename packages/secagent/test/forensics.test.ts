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
		if (command === "exiftool" && args[0] === "-ver")
			return Promise.resolve({ stdout: "13.10", stderr: "", exitCode: 0, timedOut: false, durationMs: 1 });
		if (args[0] === "--version")
			return Promise.resolve({
				stdout: `${command} 3.1.0`,
				stderr: "",
				exitCode: 0,
				timedOut: false,
				durationMs: 1,
			});
		if (command === "binwalk")
			return Promise.resolve({
				stdout: "DECIMAL HEXADECIMAL DESCRIPTION\n0 0x0 PNG image data\n128 0x80 Zip archive data\n",
				stderr: "",
				exitCode: 0,
				timedOut: false,
				durationMs: 2,
			});
		return Promise.resolve({
			stdout: '[{"FileName":"sample.png","FileType":"PNG"}]',
			stderr: "",
			exitCode: 0,
			timedOut: false,
			durationMs: 2,
		});
	}
}

const tempDirectories: string[] = [];
afterEach(async () => {
	for (const directory of tempDirectories.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe("forensic artifact adapters", () => {
	it("keeps binwalk scan-only and parses exiftool metadata", async () => {
		const directory = await mkdtemp(join(tmpdir(), "pi-secagent-forensics-"));
		tempDirectories.push(directory);
		const fixture = join(directory, "sample.png");
		await writeFile(fixture, Buffer.from("fixture"));
		const executor = new FakeExecutor();
		const binwalk = await getSecurityToolAdapter("binwalk")?.execute({ path: fixture }, { cwd: directory, executor });
		const exiftool = await getSecurityToolAdapter("exiftool")?.execute(
			{ path: fixture },
			{ cwd: directory, executor },
		);
		expect(binwalk?.ok).toBe(true);
		expect((binwalk?.output as { scanOnly: boolean; hits: string[] }).scanOnly).toBe(true);
		expect(executor.calls.find((call) => call.command === "binwalk" && call.args[0] !== "--version")?.args).toEqual([
			fixture,
		]);
		expect(exiftool?.ok).toBe(true);
		expect((exiftool?.output as { metadata: Array<{ FileType: string }> }).metadata[0]?.FileType).toBe("PNG");
		expect(executor.calls.find((call) => call.command === "exiftool" && call.args[0] !== "-ver")?.args).toEqual([
			"-j",
			fixture,
		]);
	});
});
