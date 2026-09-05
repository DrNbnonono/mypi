import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getWebProcessEnvironment } from "./runtime-env.js";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultRepoRoot = path.resolve(packageDir, "..", "..");

const runtimeInputs = [
  "package.json",
  "tsconfig.base.json",
  "packages/secagent/package.json",
  "packages/secagent/tsconfig.build.json",
  "packages/secagent/src",
  "packages/secagent/agents",
  "packages/secagent/templates",
  "packages/coding-agent/package.json",
  "packages/coding-agent/tsconfig.json",
  "packages/coding-agent/tsconfig.build.json",
  "packages/coding-agent/src",
];

function listFiles(root, relativePath, files = []) {
  const absolutePath = path.join(root, relativePath);
  if (!existsSync(absolutePath)) return files;

  const stat = statSync(absolutePath);
  if (stat.isFile()) {
    files.push({
      path: relativePath.split(path.sep).join("/"),
      size: stat.size,
      sha256: createHash("sha256").update(readFileSync(absolutePath)).digest("hex"),
    });
    return files;
  }

  for (const entry of readdirSync(absolutePath, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    listFiles(root, path.join(relativePath, entry.name), files);
  }
  return files;
}

export function getRuntimeFingerprint(repoRoot = defaultRepoRoot) {
  const files = runtimeInputs
    .flatMap((input) => listFiles(repoRoot, input))
    .sort((left, right) => left.path.localeCompare(right.path));
  return createHash("sha256").update(JSON.stringify(files)).digest("hex");
}

function getMarkerPath(webRoot) {
  // Next may remove `.next` when starting dev mode, so keep the preparation
  // marker in the ignored package-local dependency cache instead.
  return path.join(webRoot, "node_modules", ".cache", "pi-web-runtime-prepared.json");
}

function runtimeOutputs(repoRoot) {
  return [
    path.join(repoRoot, "packages/secagent/dist/index.js"),
    path.join(repoRoot, "packages/coding-agent/dist/index.js"),
  ];
}

export function isRuntimeWorkspace(repoRoot = defaultRepoRoot) {
  return existsSync(path.join(repoRoot, "packages/secagent/src"))
    && existsSync(path.join(repoRoot, "packages/coding-agent/src"));
}

export function isRuntimePrepared({ repoRoot = defaultRepoRoot, webRoot = packageDir } = {}) {
  if (runtimeOutputs(repoRoot).some((output) => !existsSync(output))) return false;

  try {
    const marker = JSON.parse(readFileSync(getMarkerPath(webRoot), "utf8"));
    return marker.fingerprint === getRuntimeFingerprint(repoRoot);
  } catch {
    return false;
  }
}

export function markRuntimePrepared({ repoRoot = defaultRepoRoot, webRoot = packageDir } = {}) {
  if (runtimeOutputs(repoRoot).some((output) => !existsSync(output))) {
    throw new Error("SecAgent and Coding Agent build outputs are required before marking the Web runtime prepared");
  }
  const fingerprint = getRuntimeFingerprint(repoRoot);
  const markerPath = getMarkerPath(webRoot);
  const temporaryPath = `${markerPath}.${process.pid}.${Date.now()}.tmp`;
  mkdirSync(path.dirname(markerPath), { recursive: true });
  try {
    writeFileSync(temporaryPath, `${JSON.stringify({ fingerprint, preparedAt: new Date().toISOString() })}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    renameSync(temporaryPath, markerPath);
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
  return { fingerprint };
}

function resolveNpmCommand() {
	// Node >= 18.20/20.12 refuses to spawn .cmd/.bat shims directly (EINVAL on
	// Windows), so prefer invoking npm's JS entry through the current runtime.
	const npmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
	if (existsSync(npmCli)) return { command: process.execPath, args: [npmCli], shell: false };
	return {
		command: process.platform === "win32" ? "npm.cmd" : "npm",
		args: [],
		shell: process.platform === "win32",
	};
}

function runWorkspaceBuild(repoRoot, packageName, env) {
	const npm = resolveNpmCommand();
	const result = spawnSync(npm.command, [...npm.args, "run", "build", `--workspace=${packageName}`], {
		cwd: repoRoot,
		env,
		stdio: "inherit",
		shell: npm.shell,
	});
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`${packageName} build failed with exit code ${result.status ?? "unknown"}`);
}

export function prepareRuntime({
  repoRoot = defaultRepoRoot,
  webRoot = packageDir,
  env = getWebProcessEnvironment(),
  runBuild = (packageName) => runWorkspaceBuild(repoRoot, packageName, env),
} = {}) {
  // Published Pi Web installs consume package artifacts from node_modules and
  // do not have workspace sources to rebuild.
  if (!isRuntimeWorkspace(repoRoot)) return { prepared: false, skipped: true };
  if (isRuntimePrepared({ repoRoot, webRoot })) return { prepared: false, fingerprint: getRuntimeFingerprint(repoRoot) };

  runBuild("@earendil-works/pi-secagent");
  runBuild("@earendil-works/pi-coding-agent");

  const { fingerprint } = markRuntimePrepared({ repoRoot, webRoot });
  return { prepared: true, fingerprint };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  if (process.argv.includes("--mark-only")) markRuntimePrepared();
  else prepareRuntime();
}
