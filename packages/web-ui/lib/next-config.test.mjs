import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const monorepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

test("scopes Next.js output file tracing to the monorepo root", async () => {
  const config = await createJiti(import.meta.url).import("../next.config.ts", { default: true });

  assert.equal(config.outputFileTracingRoot, monorepoRoot);
  assert.ok(config.serverExternalPackages.includes("@earendil-works/pi-secagent"));
  const previousCacheDirectory = process.env.PI_WEB_WEBPACK_CACHE_DIR;
  process.env.PI_WEB_WEBPACK_CACHE_DIR = "/tmp/pi-web-webpack-test";
  const webpackConfig = config.webpack(
    { resolve: { symlinks: true }, externals: [], cache: { type: "filesystem", cacheDirectory: ".next/cache" } },
    { dev: true, isServer: true },
  );
  if (previousCacheDirectory === undefined) delete process.env.PI_WEB_WEBPACK_CACHE_DIR;
  else process.env.PI_WEB_WEBPACK_CACHE_DIR = previousCacheDirectory;
  assert.equal(webpackConfig.resolve.symlinks, false);
  assert.equal(webpackConfig.cache.cacheDirectory, "/tmp/pi-web-webpack-test");
  assert.equal(webpackConfig.cache.maxMemoryGenerations, 0);
  assert.equal(
    webpackConfig.externals.at(-1)["@earendil-works/pi-secagent"],
    "module @earendil-works/pi-secagent",
  );
  assert.equal(webpackConfig.externals.at(-1).undici, "commonjs undici");
  assert.equal(config.experimental.devMemoryThresholdRestart, false);
  assert.equal(config.experimental.webpackMemoryOptimizations, true);
  assert.equal(config.devIndicators, false);
});
