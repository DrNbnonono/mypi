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

export function getWebProcessEnvironment(env = process.env, options = {}) {
  const childEnv = { ...env };
  if (shouldUseLinuxTempDirectory({ env: childEnv, ...options })) childEnv.TMPDIR = "/tmp";
  return childEnv;
}
