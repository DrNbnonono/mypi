#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getUnsupportedNodeVersionMessage, isNodeVersionSupported } from "./node-version.js";
import { prepareDevOutputDirectory } from "./dev-output.js";
import { parseLaunchOptions } from "./pi-web-options.js";
import { prepareRuntime } from "./prepare-runtime.js";
import { wireChildProcessLifecycle } from "./process-lifecycle.js";
import { getWebProcessEnvironment } from "./runtime-env.js";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextCommands = new Set(["dev", "start"]);
const testGlobs = [
  "app/**/*.test.mjs",
  "components/**/*.test.mjs",
  "hooks/**/*.test.mjs",
  "lib/**/*.test.mjs",
  "public/**/*.test.mjs",
];

function resolveNextBin() {
  const require = createRequire(import.meta.url);
  try {
    return require.resolve("next/dist/bin/next", { paths: [packageDir] });
  } catch {
    const nextPackage = require.resolve("next/package.json", { paths: [packageDir] });
    return path.join(path.dirname(nextPackage), "dist", "bin", "next");
  }
}

function openBrowser(url) {
  if (process.platform === "win32") {
    return spawn(process.env.ComSpec || "cmd.exe", ["/c", "start", "", url], { detached: true, stdio: "ignore" });
  }
  if (process.platform === "darwin") return spawn("open", [url], { detached: true, stdio: "ignore" });
  return spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
}

function launchNext(command, args, env) {
  const { port, hostname, openBrowser: shouldOpenBrowser } = parseLaunchOptions(args, env);
  const nextArgs = [command, ...(command === "dev" ? ["--webpack"] : []), "-p", port, "-H", hostname];
  const child = spawn(process.execPath, [resolveNextBin(), ...nextArgs], {
    cwd: packageDir,
    env: { ...env, PI_WEB_HOSTNAME: hostname },
    stdio: ["inherit", "pipe", "inherit"],
  });
  wireChildProcessLifecycle(child);

  let browserOpened = false;
  const url = `http://${hostname}:${port}`;
  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    process.stdout.write(text);
    if (shouldOpenBrowser && !browserOpened && text.includes("Ready")) {
      browserOpened = true;
      const opener = openBrowser(url);
      opener.on("error", (error) => console.warn(`Could not open browser automatically: ${error.message}`));
      opener.unref();
    }
  });
}

function launchTests(args, env) {
  const targets = args.length > 0 && args.some((arg) => !arg.startsWith("-")) ? args : [...testGlobs, ...args];
  const child = spawn(process.execPath, ["--experimental-strip-types", "--test", ...targets], {
    cwd: packageDir,
    env,
    stdio: "inherit",
  });
  wireChildProcessLifecycle(child);
}

function printWarningForLanHost(hostname, env) {
  if (["127.0.0.1", "localhost", "::1", "[::1]"].includes(hostname)) return;
  const message = env.PI_WEB_PASSWORD
    ? "Sec Web is listening with Basic Auth over HTTP; use HTTPS or a trusted VPN."
    : "Sec Web is listening without authentication; use this only on a trusted network.";
  console.warn(`Warning: ${message}`);
}

function main(argv = process.argv.slice(2)) {
  if (!isNodeVersionSupported(process.versions.node)) {
    console.error(getUnsupportedNodeVersionMessage(process.versions.node));
    process.exitCode = 1;
    return;
  }

  const command = nextCommands.has(argv[0]) || argv[0] === "test" ? argv.shift() : "start";
  const env = getWebProcessEnvironment(process.env, { tmpdir: os.tmpdir(), command, cwd: packageDir });

  if (command === "test") {
    launchTests(argv, env);
    return;
  }

  try {
    prepareRuntime({ env });
  } catch (error) {
    console.error(`Unable to prepare Sec Web runtime: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }
  if (command === "dev") prepareDevOutputDirectory(packageDir, env);

  if (command === "start" && !existsSync(path.join(packageDir, ".next"))) {
    console.error("Build artifacts not found. Run npm run build in packages/web-ui first.");
    process.exitCode = 1;
    return;
  }
  const { hostname } = parseLaunchOptions(argv, env);
  printWarningForLanHost(hostname, env);
  launchNext(command, argv, env);
}

main();
