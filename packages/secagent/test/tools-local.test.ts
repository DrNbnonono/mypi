import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getSecurityToolAdapter } from "../src/tools/registry.ts";

let server: Server;
let baseUrl: string;
let fixtureDirectory: string;

beforeAll(async () => {
	server = createServer((_request, response) => {
		response.writeHead(200, { "content-type": "text/plain" });
		response.end("local-secagent-ok\n");
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => resolve());
	});
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("local test server did not bind to an address");
	baseUrl = `http://127.0.0.1:${address.port}/health`;
	fixtureDirectory = await mkdtemp(join(tmpdir(), "pi-secagent-real-tools-"));
	await writeFile(join(fixtureDirectory, "sample.bin"), Buffer.from("ELF\0local-string\0", "utf8"));
});

afterAll(async () => {
	await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
	await rm(fixtureDirectory, { recursive: true, force: true });
});

describe("real localhost and fixture tool execution", () => {
	it("uses curl against a local-only HTTP server", async () => {
		const result = await getSecurityToolAdapter("curl")?.execute(
			{ target: baseUrl, timeoutMs: 5000 },
			{ cwd: fixtureDirectory },
		);
		expect(result?.ok).toBe(true);
		expect((result?.output as { statusCode: number; body: string }).statusCode).toBe(200);
		expect((result?.output as { body: string }).body).toContain("local-secagent-ok");
	});

	it("uses nmap only against loopback", async () => {
		const result = await getSecurityToolAdapter("nmap")?.execute(
			{ target: "127.0.0.1", ports: "1", serviceDetection: false, timeoutMs: 15000 },
			{ cwd: fixtureDirectory },
		);
		expect(result?.ok).toBe(true);
		expect((result?.output as { targets: string[]; stdout: string }).targets).toEqual(["127.0.0.1"]);
		expect((result?.output as { stdout: string }).stdout).toContain("Nmap scan report");
	});

	it("uses file and strings on a temporary fixture", async () => {
		const path = join(fixtureDirectory, "sample.bin");
		const fileResult = await getSecurityToolAdapter("file")?.execute({ path }, { cwd: fixtureDirectory });
		const stringsResult = await getSecurityToolAdapter("strings")?.execute(
			{ path, minLength: 6 },
			{ cwd: fixtureDirectory },
		);
		expect(fileResult?.ok).toBe(true);
		expect((fileResult?.output as { identification: string }).identification).toContain("data");
		expect(stringsResult?.ok).toBe(true);
		expect((stringsResult?.output as { strings: string[] }).strings).toContain("local-string");
	});
});
