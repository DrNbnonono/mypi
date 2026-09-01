import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

function readProcVersion() {
  try {
    return readFileSync("/proc/version", "utf8");
  } catch {
    return "";
  }
}

export function isWsl({
  platform = process.platform,
  env = process.env,
  release = os.release(),
  procVersion = readProcVersion(),
} = {}) {
  if (platform !== "linux") return false;
  return Boolean(
    env.WSL_DISTRO_NAME ||
    env.WSL_INTEROP ||
    /microsoft|wsl/i.test(release) ||
    /microsoft|wsl/i.test(procVersion),
  );
}

export function shouldUseLinuxTempDirectory({
  platform = process.platform,
  env = process.env,
  tmpdir = os.tmpdir(),
  release = os.release(),
  procVersion = readProcVersion(),
} = {}) {
  const normalized = path.posix.normalize(tmpdir.replaceAll("\\", "/"));
  return isWsl({ platform, env, release, procVersion }) && (normalized === "/mnt" || normalized.startsWith("/mnt/"));
}

export function shouldUseLinuxWebpackCache({
  platform = process.platform,
  env = process.env,
  cwd = process.cwd(),
  release = os.release(),
  procVersion = readProcVersion(),
} = {}) {
  const normalized = path.posix.normalize(cwd.replaceAll("\\", "/"));
  return isWsl({ platform, env, release, procVersion }) && (normalized === "/mnt" || normalized.startsWith("/mnt/"));
}

export function getLinuxDevelopmentPaths(cwd) {
  const projectId = createHash("sha256").update(cwd).digest("hex").slice(0, 12);
  return {
    nextOutputDirectory: path.join("/tmp", `pi-web-next-${projectId}`),
    webpackCacheDirectory: path.join("/tmp", `pi-web-webpack-${projectId}`),
  };
}

export function getWebProcessEnvironment(env = process.env, options = {}) {
  const childEnv = { ...env };
  if (shouldUseLinuxTempDirectory({ env: childEnv, ...options })) childEnv.TMPDIR = "/tmp";
  if (
    options.command === "dev" &&
    !childEnv.PI_WEB_WEBPACK_CACHE_DIR &&
    shouldUseLinuxWebpackCache({ env: childEnv, ...options })
  ) {
    const cwd = options.cwd || process.cwd();
    const paths = getLinuxDevelopmentPaths(cwd);
    childEnv.PI_WEB_WEBPACK_CACHE_DIR = paths.webpackCacheDirectory;
    childEnv.PI_WEB_NEXT_OUTPUT_DIR = paths.nextOutputDirectory;
  }
  return childEnv;
}
