#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { runControlledScenarioBenchmark } from "../dist/scenarios/harness.js";

const scenarioIds = ["web", "pwn", "reverse", "forensics", "killchain"];
const outputArgumentIndex = process.argv.indexOf("--output");
const outputPath = outputArgumentIndex >= 0 ? process.argv[outputArgumentIndex + 1] : "/workspace/controlled-acceptance.json";

if (!outputPath) throw new Error("--output requires a file path");

const results = [];
for (const id of scenarioIds) {
	const startedAt = performance.now();
	const result = await runControlledScenarioBenchmark(id);
	const durationMs = Math.round(performance.now() - startedAt);
	results.push({
		id,
		durationMs,
		passed: result.evaluation.passed,
		score: result.evaluation.score,
		metrics: result.metrics,
		selectedTools: result.evaluation.selectedTools,
		trace: result.trace,
	});
	if (!result.evaluation.passed) throw new Error(`Controlled scenario ${id} failed: ${JSON.stringify(result.evaluation)}`);
}

const traceEntries = results.flatMap((result) => result.trace);
const validSelectedActions = traceEntries.filter(
	(entry) => entry.tool.length > 0 && entry.capability.length > 0 && entry.status !== "pending",
).length;
const successfulToolCalls = traceEntries.filter((entry) => entry.status === "succeeded").length;
const repeatedActions = traceEntries.length - new Set(traceEntries.map((entry) => `${entry.tool}:${entry.capability}`)).size;
const totalDecisions = results.reduce((sum, result) => sum + result.metrics.decisions, 0);
const totalEvidence = results.reduce((sum, result) => sum + result.metrics.evidence, 0);
const totalVerifications = results.reduce((sum, result) => sum + result.metrics.verifications, 0);
const injectedStartedAt = performance.now();
const injectedFailure = await runControlledScenarioBenchmark("killchain", { injectFailure: true });
if (!injectedFailure.evaluation.passed || injectedFailure.metrics.failedDecisions < 1 || injectedFailure.metrics.replans < 1) {
	throw new Error(`Injected failure did not produce a passing replan trace: ${JSON.stringify(injectedFailure)}`);
}

const report = {
	format: "secagent-controlled-acceptance/v1",
	createdAt: new Date().toISOString(),
	gitCommit: process.env.SECAGENT_GIT_COMMIT ?? null,
	nodeVersion: process.version,
	inputHash: createHash("sha256").update(JSON.stringify({ format: "controlled-scenario-matrix/v1", scenarioIds })).digest("hex"),
	executor: "controlled",
	passed: true,
	scenarios: results,
	metrics: {
		definitions: {
			taskUnderstandingSuccessRate: "passed scenarios / scenario count",
			candidateActionValidityRate: "valid selected actions / selected trace entries",
			toolCallSuccessRate: "successful selected actions / selected trace entries",
			replanningSuccessRate: "injected-failure run passed with at least one replan",
			evidenceVerificationCoverage: "verification records / evidence records",
			repeatedActionRatio: "repeated tool-capability selections / selected trace entries",
			averageScenarioDurationMs: "mean measured controlled scenario duration",
		},
		taskUnderstandingSuccessRate: results.filter((result) => result.passed).length / results.length,
		candidateActionValidityRate: traceEntries.length ? validSelectedActions / traceEntries.length : 0,
		toolCallSuccessRate: traceEntries.length ? successfulToolCalls / traceEntries.length : 0,
		replanningSuccessRate: injectedFailure.evaluation.passed && injectedFailure.metrics.replans > 0 ? 1 : 0,
		evidenceVerificationCoverage: totalEvidence ? totalVerifications / totalEvidence : 0,
		repeatedActionRatio: traceEntries.length ? repeatedActions / traceEntries.length : 0,
		averageScenarioDurationMs: results.length
			? Math.round(results.reduce((sum, result) => sum + result.durationMs, 0) / results.length)
			: 0,
		decisions: totalDecisions,
		toolCalls: results.reduce((sum, result) => sum + result.metrics.toolCalls, 0),
		evidence: totalEvidence,
		verifications: totalVerifications,
	},
	injectedFailure: {
		passed: injectedFailure.evaluation.passed,
		durationMs: Math.round(performance.now() - injectedStartedAt),
		failedDecisions: injectedFailure.metrics.failedDecisions,
		replans: injectedFailure.metrics.replans,
		trace: injectedFailure.trace,
	},
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${JSON.stringify({ passed: report.passed, scenarios: scenarioIds, outputPath })}\n`);
