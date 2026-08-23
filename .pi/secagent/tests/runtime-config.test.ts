import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

interface PackageEntry {
	source: string;
	skills?: string[];
	prompts?: string[];
}

interface PiSettings {
	packages?: PackageEntry[];
}

const settingsPath = new URL("../../settings.json", import.meta.url);
const settings = JSON.parse(readFileSync(settingsPath, "utf-8")) as PiSettings;
const sources = new Set((settings.packages ?? []).map((entry) => entry.source));

test("SecAgent runtime packages are pinned project-locally", () => {
	assert.equal(sources.has("npm:pi-sandbox@0.6.3"), true);
	assert.equal(sources.has("npm:pi-mcp-adapter@2.23.0"), true);
	assert.equal(sources.has("npm:pi-subagents@0.50.0"), true);
	assert.equal(sources.has("npm:pi-trace-extension@0.1.14"), true);
});

test("generic MCP and subagent package prompts are not implicitly added to the project prompt surface", () => {
	const mcp = (settings.packages ?? []).find((entry) => entry.source.startsWith("npm:pi-mcp-adapter@"));
	const subagents = (settings.packages ?? []).find((entry) => entry.source.startsWith("npm:pi-subagents@"));
	assert.deepEqual(mcp?.skills, []);
	assert.deepEqual(subagents?.skills, []);
	assert.deepEqual(subagents?.prompts, []);
});
