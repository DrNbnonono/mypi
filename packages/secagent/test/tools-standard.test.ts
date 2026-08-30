import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SecurityToolCommandResult, SecurityToolExecutor } from "../src/tools/adapter.ts";
import { getSecurityToolAdapter } from "../src/tools/registry.ts";

class FakeExecutor implements SecurityToolExecutor {
	readonly calls: Array<{ command: string; args: readonly string[]; timeoutMs: number }> = [];
	private readonly responses = new Map<string, SecurityToolCommandResult>();
	private readonly missing = new Set<string>();

	set(command: string, result: SecurityToolCommandResult): void {
		this.responses.set(command, result);
	}

	setForFirstArgument(command: string, firstArgument: string, result: SecurityToolCommandResult): void {
		this.responses.set(`${command}:${firstArgument}`, result);
	}

	setMissing(command: string): void {
		this.missing.add(command);
	}

	run(
		command: string,
		args: readonly string[],
		options: { cwd: string; signal?: AbortSignal; timeoutMs: number },
	): Promise<SecurityToolCommandResult> {
		this.calls.push({ command, args, timeoutMs: options.timeoutMs });
		if (this.missing.has(command)) {
			const error = new Error(`missing ${command}`) as NodeJS.ErrnoException;
			error.code = "ENOENT";
			return Promise.reject(error);
		}
		const response = this.responses.get(`${command}:${args[0] ?? ""}`) ?? this.responses.get(command);
		return Promise.resolve(
			response ?? { stdout: `${command} 1.0`, stderr: "", exitCode: 0, timedOut: false, durationMs: 1 },
		);
	}
}

const tempDirectories: string[] = [];

afterEach(async () => {
	for (const directory of tempDirectories.splice(0)) await rm(directory, { recursive: true, force: true });
});

function result(stdout: string, exitCode = 0, timedOut = false): SecurityToolCommandResult {
	return { stdout, stderr: "", exitCode, timedOut, durationMs: 2 };
}

describe("standard security tool adapters", () => {
	it("registers nmap, extracts normalized targets, and executes structured argv", async () => {
		const adapter = getSecurityToolAdapter("nmap");
		const executor = new FakeExecutor();
		executor.set("nmap", result("Nmap 7.95\nHost is up"));
		expect(adapter).toBeDefined();
		expect(await adapter?.checkAvailability({ cwd: process.cwd(), executor })).toMatchObject({
			available: true,
			version: "Nmap 7.95",
		});
		expect(adapter?.extractTargets({ targets: ["https://127.0.0.1:8080/path"] })).toEqual(["127.0.0.1"]);
		const executed = await adapter?.execute(
			{ target: "127.0.0.1", ports: "80,443", timing: 3, timeoutMs: 5000 },
			{ cwd: process.cwd(), executor },
		);
		expect(executed?.ok).toBe(true);
		expect(executor.calls.map((call) => call.command)).toEqual(["nmap", "nmap", "nmap"]);
		expect(executor.calls[2]?.args).toEqual(["-Pn", "-sV", "-p", "80,443", "-T3", "127.0.0.1"]);
		expect((executed?.output as { targets: string[] }).targets).toEqual(["127.0.0.1"]);
	});

	it("executes curl without a shell and normalizes HTTP status", async () => {
		const adapter = getSecurityToolAdapter("curl");
		const executor = new FakeExecutor();
		executor.set("curl", result("hello\n__PI_CURL_STATUS__:200"));
		const input = { target: "http://127.0.0.1:18080/health", method: "GET", followRedirects: true, timeoutMs: 7000 };
		expect(adapter?.extractTargets(input)).toEqual(["http://127.0.0.1:18080/health"]);
		const executed = await adapter?.execute(input, { cwd: process.cwd(), executor });
		expect(executed?.ok).toBe(true);
		expect(executed?.diagnostic).toBeUndefined();
		expect((executed?.output as { body: string; statusCode: number }).body).toBe("hello");
		expect((executed?.output as { statusCode: number }).statusCode).toBe(200);
		expect(executor.calls[1]?.command).toBe("curl");
		expect(executor.calls[1]?.args).not.toContain("|");
	});

	it("reports missing tools and command timeouts structurally", async () => {
		const missing = new FakeExecutor();
		missing.setMissing("nmap");
		const missingResult = await getSecurityToolAdapter("nmap")?.execute(
			{ target: "127.0.0.1" },
			{ cwd: process.cwd(), executor: missing },
		);
		expect(missingResult?.diagnostic?.code).toBe("missing");
		expect(
			await getSecurityToolAdapter("nmap")?.checkAvailability({ cwd: process.cwd(), executor: missing }),
		).toMatchObject({ available: false, diagnostic: { code: "missing" } });

		const timedOut = new FakeExecutor();
		timedOut.set("curl", result("curl 8.0"));
		timedOut.setForFirstArgument("curl", "--silent", result("", 0, true));
		const timeoutResult = await getSecurityToolAdapter("curl")?.execute(
			{ target: "http://127.0.0.1", timeoutMs: 20 },
			{ cwd: process.cwd(), executor: timedOut },
		);
		expect(timeoutResult?.diagnostic?.code).toBe("timeout");
		expect(timeoutResult?.ok).toBe(false);
	});

	it("runs file and strings only on regular files inside the session cwd", async () => {
		const directory = await mkdtemp(join(tmpdir(), "pi-secagent-tools-"));
		tempDirectories.push(directory);
		const fixture = join(directory, "sample.bin");
		await writeFile(fixture, Buffer.from("ELF\0secret-token\0", "utf8"));
		const executor = new FakeExecutor();
		executor.set("file", result("sample.bin: ELF 64-bit LSB executable"));
		executor.set("strings", result("ELF\nsecret-token\n"));
		const fileResult = await getSecurityToolAdapter("file")?.execute({ path: fixture }, { cwd: directory, executor });
		const stringsResult = await getSecurityToolAdapter("strings")?.execute(
			{ path: fixture, minLength: 6 },
			{ cwd: directory, executor },
		);
		expect((fileResult?.output as { identification: string }).identification).toContain("ELF");
		expect((stringsResult?.output as { strings: string[] }).strings).toEqual(["ELF", "secret-token"]);
		expect(executor.calls.find((call) => call.command === "file" && call.args[0] !== "--version")?.args[0]).toBe(
			"--",
		);
		expect(executor.calls.find((call) => call.command === "strings" && call.args[0] !== "--version")?.args).toEqual([
			"-a",
			"-n",
			"6",
			"--",
			fixture,
		]);
		await mkdir(join(directory, "nested"));
		const outsideResult = await getSecurityToolAdapter("file")?.execute(
			{ path: "../outside.bin" },
			{ cwd: join(directory, "nested"), executor },
		);
		expect(outsideResult?.diagnostic?.code).toBe("precondition");
	});
});
