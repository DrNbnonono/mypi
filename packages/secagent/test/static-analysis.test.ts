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
		if (args[0] === "--version")
			return Promise.resolve({
				stdout: `${command} GNU Binutils 2.42`,
				stderr: "",
				exitCode: 0,
				timedOut: false,
				durationMs: 1,
			});
		const stdout =
			command === "readelf"
				? "ELF Header:\n  Type: DYN (Position-Independent Executable file)\n  Machine: Advanced Micro Devices X86-64\n  Entry point address: 0x401000\n  GNU_STACK 0x000000 0x000000 0x000000 0x0 0x0 RW 0x10\n  GNU_RELRO 0x000000\n  1: 000000 __stack_chk_fail\n 0x000000000000001e (FLAGS) BIND_NOW\n"
				: "sample.bin: file format elf64-x86-64\n";
		return Promise.resolve({ stdout, stderr: "", exitCode: 0, timedOut: false, durationMs: 2 });
	}
}

const tempDirectories: string[] = [];
afterEach(async () => {
	for (const directory of tempDirectories.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe("static analysis adapters", () => {
	it("executes readelf and objdump with constrained argv inside the session cwd", async () => {
		const directory = await mkdtemp(join(tmpdir(), "pi-secagent-static-"));
		tempDirectories.push(directory);
		const fixture = join(directory, "sample.bin");
		await writeFile(fixture, Buffer.from("ELF fixture"));
		const executor = new FakeExecutor();
		const readelf = await getSecurityToolAdapter("readelf")?.execute(
			{ path: fixture, action: "security" },
			{ cwd: directory, executor },
		);
		const objdump = await getSecurityToolAdapter("objdump")?.execute(
			{ path: fixture, action: "disassemble" },
			{ cwd: directory, executor },
		);
		expect(readelf?.ok).toBe(true);
		const facts = (readelf?.output as { facts: { architecture?: string; mitigations?: Record<string, string> } })
			.facts;
		expect(facts.architecture).toContain("X86-64");
		expect(facts.mitigations).toMatchObject({
			pie: "likely-enabled",
			nx: "enabled",
			relro: "full",
			stackCanary: "detected",
		});
		expect(objdump?.ok).toBe(true);
		expect(executor.calls.find((call) => call.command === "readelf" && call.args[0] !== "--version")?.args).toEqual([
			"-W",
			"-h",
			"-l",
			"-s",
			"-d",
			fixture,
		]);
		expect(executor.calls.find((call) => call.command === "objdump" && call.args[0] !== "--version")?.args).toEqual([
			"-d",
			fixture,
		]);
	});

	it("rejects unsupported actions before execution", async () => {
		const directory = await mkdtemp(join(tmpdir(), "pi-secagent-static-"));
		tempDirectories.push(directory);
		const fixture = join(directory, "sample.bin");
		await writeFile(fixture, Buffer.from("fixture"));
		const result = await getSecurityToolAdapter("readelf")?.execute(
			{ path: fixture, action: "execute" },
			{ cwd: directory, executor: new FakeExecutor() },
		);
		expect(result?.ok).toBe(false);
		expect(result?.diagnostic?.code).toBe("precondition");
	});
});
