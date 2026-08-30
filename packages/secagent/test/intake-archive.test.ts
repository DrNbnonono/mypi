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
