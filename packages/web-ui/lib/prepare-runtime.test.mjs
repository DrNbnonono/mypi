import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getRuntimeFingerprint, isRuntimePrepared, isRuntimeWorkspace, markRuntimePrepared, prepareRuntime } from "../bin/prepare-runtime.js";

async function createFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-web-runtime-"));
  await mkdir(path.join(root, "packages/secagent/src"), { recursive: true });
  await mkdir(path.join(root, "packages/coding-agent/src"), { recursive: true });
  await mkdir(path.join(root, "packages/secagent"), { recursive: true });
  await mkdir(path.join(root, "packages/coding-agent"), { recursive: true });
  await writeFile(path.join(root, "package.json"), "{}\n");
  await writeFile(path.join(root, "tsconfig.base.json"), "{}\n");
  await writeFile(path.join(root, "packages/secagent/package.json"), "{}\n");
  await writeFile(path.join(root, "packages/secagent/tsconfig.build.json"), "{}\n");
  await writeFile(path.join(root, "packages/coding-agent/package.json"), "{}\n");
  await writeFile(path.join(root, "packages/coding-agent/tsconfig.json"), "{}\n");
  await writeFile(path.join(root, "packages/coding-agent/tsconfig.build.json"), "{}\n");
  await writeFile(path.join(root, "packages/secagent/src/index.ts"), "export {};\n");
  await writeFile(path.join(root, "packages/coding-agent/src/index.ts"), "export {};\n");
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("builds SecAgent before Coding Agent and skips unchanged runtime inputs", async (t) => {
  const root = await createFixture(t);
  const webRoot = path.join(root, "web-ui");
  const built = [];
  const syncBuild = (name) => {
    built.push(name);
    const packageName = name.includes("secagent") ? "secagent" : "coding-agent";
    const outputDir = path.join(root, `packages/${packageName}/dist`);
    mkdirSync(outputDir);
    writeFileSync(path.join(outputDir, "index.js"), "export {};\n");
  };
  const first = prepareRuntime({ repoRoot: root, webRoot, runBuild: syncBuild });
  assert.equal(first.prepared, true);
  assert.deepEqual(built, ["@earendil-works/pi-secagent", "@earendil-works/pi-coding-agent"]);
  assert.equal(isRuntimePrepared({ repoRoot: root, webRoot }), true);
  assert.equal(prepareRuntime({ repoRoot: root, webRoot, runBuild: syncBuild }).prepared, false);

  const marked = markRuntimePrepared({ repoRoot: root, webRoot });
  assert.equal(marked.fingerprint, getRuntimeFingerprint(root));
  assert.equal(isRuntimePrepared({ repoRoot: root, webRoot }), true);

  await writeFile(path.join(root, "packages/secagent/src/index.ts"), "export const changed = true;\n");
  assert.notEqual(getRuntimeFingerprint(root), first.fingerprint);
});

test("does not try to build workspace packages from a published install", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-web-published-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let buildCalled = false;
  assert.equal(isRuntimeWorkspace(root), false);
  assert.deepEqual(prepareRuntime({ repoRoot: root, webRoot: root, runBuild: () => { buildCalled = true; } }), {
    prepared: false,
    skipped: true,
  });
  assert.equal(buildCalled, false);
});
