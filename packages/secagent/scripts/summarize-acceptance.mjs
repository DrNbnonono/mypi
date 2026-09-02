#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

const [outputDir, projectName, sessionId, summaryPath] = process.argv.slice(2);
if (!outputDir || !projectName || !sessionId || !summaryPath) throw new Error("acceptance summary arguments are incomplete");

const controlled = JSON.parse(await readFile(join(outputDir, "controlled-acceptance.json"), "utf8"));
const initial = JSON.parse(await readFile(join(outputDir, "profile-initial.json"), "utf8"));
const restored = JSON.parse(await readFile(join(outputDir, "profile-after-restart.json"), "utf8"));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const controlledBytes = await readFile(join(outputDir, "controlled-acceptance.json"));
const summary = {
	format: "secagent-competition-acceptance/v1",
	createdAt: new Date().toISOString(),
	gitCommit: process.env.SECAGENT_GIT_COMMIT ?? controlled.gitCommit ?? null,
	nodeVersion: process.version,
	passed: controlled.passed && initial.agentMode === "sec" && restored.agentMode === "sec",
	composeProject: projectName,
	sessionId,
	evidenceSha256: {
		controlledAcceptance: sha256(controlledBytes),
		profileInitial: sha256(await readFile(join(outputDir, "profile-initial.json"))),
		profileAfterRestart: sha256(await readFile(join(outputDir, "profile-after-restart.json"))),
	},
	metrics: controlled.metrics ?? null,
	controlled,
	restartRecovery: {
		initialMode: initial.agentMode,
		restoredMode: restored.agentMode,
		scopeRestored: JSON.stringify(restored).includes("fixture"),
	},
};
if (!summary.passed || !summary.restartRecovery.scopeRestored) throw new Error("acceptance summary did not pass");
summary.summarySha256 = sha256(JSON.stringify(summary));
await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${JSON.stringify({ passed: summary.passed, summaryPath })}\n`);
