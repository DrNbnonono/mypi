import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getLinuxDevelopmentPaths } from "./runtime-env.js";

const markerName = ".pi-web-dev-output";

function resolvedLinkTarget(linkPath) {
  return path.resolve(path.dirname(linkPath), readlinkSync(linkPath));
}

function markerMatches(target, projectDir) {
  try {
    return readFileSync(path.join(target, markerName), "utf8") === path.resolve(projectDir);
  } catch {
    return false;
  }
}

function findDependencyDirectory(projectDir) {
  let current = path.resolve(projectDir);
  const filesystemRoot = path.parse(current).root;
  while (current !== filesystemRoot) {
    const candidate = path.join(current, "node_modules");
    if (existsSync(path.join(candidate, "next", "package.json"))) return candidate;
    current = path.dirname(current);
  }
  throw new Error(`Cannot locate the Next.js dependency directory for ${projectDir}`);
}

function ensureDependencyLink(target, projectDir) {
  const linkPath = path.join(target, "node_modules");
  const dependencyDirectory = findDependencyDirectory(projectDir);
  try {
    if (lstatSync(linkPath).isSymbolicLink() && resolvedLinkTarget(linkPath) === dependencyDirectory) return;
    throw new Error(`Refusing to replace unmanaged development dependency path: ${linkPath}`);
  } catch (error) {
    if (!error || typeof error !== "object" || error.code !== "ENOENT") throw error;
  }
  symlinkSync(dependencyDirectory, linkPath, "dir");
}

/**
 * Keep Next's high-churn development output on the Linux filesystem when the
 * source checkout lives on a WSL-mounted Windows drive. The logical path stays
 * `.next`, so Next's module resolution and generated TypeScript paths keep
 * their normal project-relative behavior.
 */
export function prepareDevOutputDirectory(projectDir, env = process.env) {
  const target = env.PI_WEB_NEXT_OUTPUT_DIR;
  if (!target) return;

  const outputPath = path.join(projectDir, ".next");
  mkdirSync(target, { recursive: true, mode: 0o700 });
  chmodSync(target, 0o700);
  writeFileSync(path.join(target, markerName), path.resolve(projectDir), { encoding: "utf8", mode: 0o600 });
  ensureDependencyLink(target, projectDir);

  if (env.PI_WEB_WEBPACK_CACHE_DIR) {
    mkdirSync(env.PI_WEB_WEBPACK_CACHE_DIR, { recursive: true, mode: 0o700 });
    chmodSync(env.PI_WEB_WEBPACK_CACHE_DIR, 0o700);
  }

  try {
    const stats = lstatSync(outputPath);
    if (stats.isSymbolicLink()) {
      if (resolvedLinkTarget(outputPath) === path.resolve(target)) return;
      throw new Error(`Refusing to replace existing .next symlink: ${outputPath}`);
    }
    rmSync(outputPath, { recursive: !stats.isSymbolicLink(), force: true });
  } catch (error) {
    if (!error || typeof error !== "object" || error.code !== "ENOENT") throw error;
  }

  symlinkSync(target, outputPath, "dir");
}

/** Remove only the generated WSL development link before a production build. */
export function prepareProductionOutputDirectory(projectDir) {
  const outputPath = path.join(projectDir, ".next");
  try {
    if (!lstatSync(outputPath).isSymbolicLink()) return;
    const target = resolvedLinkTarget(outputPath);
    const defaultTarget = getLinuxDevelopmentPaths(projectDir).nextOutputDirectory;
    if (!markerMatches(target, projectDir) && target !== defaultTarget) {
      throw new Error(`Refusing to remove unmanaged .next symlink: ${outputPath}`);
    }
    rmSync(outputPath, { force: true });
  } catch (error) {
    if (!error || typeof error !== "object" || error.code !== "ENOENT") throw error;
  }
}
