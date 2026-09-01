import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readlink, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  prepareDevOutputDirectory,
  prepareProductionOutputDirectory,
} from "../bin/dev-output.js";
import { getLinuxDevelopmentPaths } from "../bin/runtime-env.js";

const testTmpdir = process.platform === "linux" ? "/tmp" : tmpdir();

test("moves WSL development output behind the logical .next path", async (t) => {
  const root = await mkdtemp(path.join(testTmpdir, "pi-web-dev-output-"));
  const projectDir = path.join(root, "project");
  const target = path.join(root, "next-output");
  const webpackCache = path.join(root, "webpack-cache");
  await mkdir(path.join(projectDir, ".next"), { recursive: true });
  await mkdir(path.join(root, "node_modules", "next"), { recursive: true });
  await writeFile(path.join(root, "node_modules", "next", "package.json"), "{}\n");
  await writeFile(path.join(projectDir, ".next", "stale"), "stale");
  t.after(() => rm(root, { recursive: true, force: true }));

  prepareDevOutputDirectory(projectDir, {
    PI_WEB_NEXT_OUTPUT_DIR: target,
    PI_WEB_WEBPACK_CACHE_DIR: webpackCache,
  });

  assert.equal((await lstat(path.join(projectDir, ".next"))).isSymbolicLink(), true);
  assert.equal(path.resolve(projectDir, await readlink(path.join(projectDir, ".next"))), target);
  assert.equal(path.resolve(target, await readlink(path.join(target, "node_modules"))), path.join(root, "node_modules"));
  assert.equal((await stat(target)).mode & 0o777, 0o700);
  assert.equal((await stat(webpackCache)).mode & 0o777, 0o700);
  prepareDevOutputDirectory(projectDir, {
    PI_WEB_NEXT_OUTPUT_DIR: target,
    PI_WEB_WEBPACK_CACHE_DIR: webpackCache,
  });
});

test("production preparation removes only the generated output link", async (t) => {
  const root = await mkdtemp(path.join(testTmpdir, "pi-web-production-output-"));
  const projectDir = path.join(root, "project");
  const target = path.join(root, "next-output");
  await mkdir(projectDir);
  await mkdir(path.join(root, "node_modules", "next"), { recursive: true });
  await writeFile(path.join(root, "node_modules", "next", "package.json"), "{}\n");
  t.after(() => rm(root, { recursive: true, force: true }));

  prepareDevOutputDirectory(projectDir, { PI_WEB_NEXT_OUTPUT_DIR: target });
  await writeFile(path.join(target, "preserved"), "preserved");
  prepareProductionOutputDirectory(projectDir);

  await assert.rejects(lstat(path.join(projectDir, ".next")), { code: "ENOENT" });
  assert.equal((await lstat(path.join(target, "preserved"))).isFile(), true);
});

test("production preparation removes a generated link after WSL clears its target", async (t) => {
  const root = await mkdtemp(path.join(testTmpdir, "pi-web-dangling-output-"));
  const projectDir = path.join(root, "project");
  const target = getLinuxDevelopmentPaths(projectDir).nextOutputDirectory;
  await mkdir(projectDir);
  t.after(() => rm(root, { recursive: true, force: true }));
  await symlink(target, path.join(projectDir, ".next"), "dir");

  prepareProductionOutputDirectory(projectDir);

  await assert.rejects(lstat(path.join(projectDir, ".next")), { code: "ENOENT" });
});

test("does not replace or remove an unmanaged output symlink", async (t) => {
  const root = await mkdtemp(path.join(testTmpdir, "pi-web-unmanaged-output-"));
  const projectDir = path.join(root, "project");
  const managedTarget = path.join(root, "managed-output");
  const unmanagedTarget = path.join(root, "unmanaged-output");
  await mkdir(projectDir);
  await mkdir(unmanagedTarget);
  await mkdir(path.join(root, "node_modules", "next"), { recursive: true });
  await writeFile(path.join(root, "node_modules", "next", "package.json"), "{}\n");
  t.after(() => rm(root, { recursive: true, force: true }));
  await symlink(unmanagedTarget, path.join(projectDir, ".next"), "dir");

  assert.throws(
    () => prepareDevOutputDirectory(projectDir, { PI_WEB_NEXT_OUTPUT_DIR: managedTarget }),
    /Refusing to replace existing \.next symlink/,
  );
  assert.throws(
    () => prepareProductionOutputDirectory(projectDir),
    /Refusing to remove unmanaged \.next symlink/,
  );
  assert.equal((await lstat(path.join(projectDir, ".next"))).isSymbolicLink(), true);
});
