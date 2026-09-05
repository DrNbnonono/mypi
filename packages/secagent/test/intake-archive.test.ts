import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateArchiveEntries } from "../src/intake/archive.ts";
import { createSecurityTaskSpec } from "../src/intake/intake.ts";

describe("security intake", () => {
	it("classifies structured assets without treating them as scope", () => {
		const task = createSecurityTaskSpec({
			goal: "Assess lab",
			assets: [{ name: "openapi.json", content: JSON.stringify({ openapi: "3.1.0", paths: {} }) }],
			declaredAuthorization: ["Organizer lab"],
		});
		expect(task.assets[0]?.kind).toBe("openapi");
		expect(task.pendingConfirmations).toContain("Confirm explicit target scope before network actions");
	});

	it("rejects invalid structured input", () => {
		expect(() => createSecurityTaskSpec({ goal: "Assess", assets: [{ name: "broken.json", content: "{" }] })).toThrow(
			/Invalid JSON/,
		);
	});

	it("validates YAML, CSV, PDF, and image inputs without granting discovered targets", () => {
		const pngHeader = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64");
		const task = createSecurityTaskSpec({
			goal: "Review supplied evidence",
			assets: [
				{ name: "api.yaml", content: "openapi: 3.1.0\ninfo: {}\npaths: {}\ntarget: https://lab.example" },
				{ name: "targets.csv", content: "name,target\nweb,127.0.0.1\n" },
				{
					name: "notice.pdf",
					contentBase64: Buffer.from("%PDF-1.7\nhttps://lab.example", "utf8").toString("base64"),
				},
				{ name: "screen.png", contentBase64: pngHeader },
			],
		});
		expect(task.assets.map((asset) => asset.kind)).toEqual(["openapi", "csv", "pdf", "image"]);
		expect(task.assets.every((asset) => asset.formatValid === true)).toBe(true);
		expect(task.assets[0]?.detectedTargets).toContain("https://lab.example");
		expect(task.pendingConfirmations).toContain("Confirm explicit target scope before network actions");
	});

	it("keeps path-backed intake inside the Session working directory", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-secagent-intake-"));
		const cwd = join(root, "cwd");
		const outside = join(root, "outside.json");
		await mkdir(cwd);
		await writeFile(outside, "{}");
		try {
			expect(() =>
				createSecurityTaskSpec(
					{ goal: "Assess", assets: [{ name: "outside.json", path: "../outside.json" }] },
					{ cwd },
				),
			).toThrow(/inside the Session working directory/);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("rejects malformed YAML, CSV, and OpenAPI documents", () => {
		expect(() =>
			createSecurityTaskSpec({ goal: "Assess", assets: [{ name: "broken.yaml", content: "a: [" }] }),
		).toThrow(/Invalid YAML/);
		expect(() =>
			createSecurityTaskSpec({
				goal: "Assess",
				assets: [{ name: "broken.csv", content: 'name,target\n"unterminated' }],
			}),
		).toThrow(/Invalid CSV/);
		expect(() =>
			createSecurityTaskSpec({ goal: "Assess", assets: [{ name: "openapi.yaml", content: "openapi: 2.0\n" }] }),
		).toThrow(/Invalid OpenAPI/);
	});

	it("rejects traversal, absolute paths, excessive nesting, and file counts", () => {
		expect(() => validateArchiveEntries(["../escape"])).toThrow(/Unsafe/);
		expect(() => validateArchiveEntries(["/absolute"])).toThrow(/Unsafe/);
		expect(() =>
			validateArchiveEntries(["a/b/c/d"], { maxFiles: 10, maxTotalBytes: 1, maxEntryBytes: 1, maxDepth: 3 }),
		).toThrow(/nesting/);
		expect(() =>
			validateArchiveEntries(["a", "b"], { maxFiles: 1, maxTotalBytes: 1, maxEntryBytes: 1, maxDepth: 3 }),
		).toThrow(/limit/);
	});
});
