import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const configDir = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(join(configDir, "package.json"), "utf8")) as { version: string };
let piVersion = "unknown";
try {
  const piPkgPath = join(configDir, "node_modules/@earendil-works/pi-coding-agent/package.json");
  piVersion = (JSON.parse(readFileSync(piPkgPath, "utf8")) as { version: string }).version;
} catch { /* package not found, use default */ }

const nextConfig: NextConfig = {
  experimental: {
    // Pi Web keeps long-lived Agent sessions in the server process. A Next
    // development memory restart would terminate those sessions mid-task, so
    // reduce Webpack's peak memory and leave lifecycle control to pi-web.
    devMemoryThresholdRestart: false,
    webpackMemoryOptimizations: true,
  },
  outputFileTracingRoot: join(configDir, "..", ".."),
  turbopack: {
    root: join(configDir, "..", ".."),
  },
  serverExternalPackages: [
    "undici",
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-secagent",
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-tui",
  ],
  webpack(config, { dev, isServer }) {
    // Keep workspace symlinks as node_modules paths so serverExternalPackages
    // can match them. Resolving the real path bundles Pi's lazy Node imports
    // into a webpack context, which cannot load node:fs/node:os/node:path.
    config.resolve.symlinks = false;
    if (isServer) {
      // Workspace packages are ESM-only symlinks. Next can still decide to
      // bundle them after resolving the symlink, so force native ESM imports
      // for the server build as a final package-boundary guarantee.
      config.externals.push({
        undici: "commonjs undici",
        "@earendil-works/pi-coding-agent": "module @earendil-works/pi-coding-agent",
        "@earendil-works/pi-secagent": "module @earendil-works/pi-secagent",
        "@earendil-works/pi-agent-core": "module @earendil-works/pi-agent-core",
        "@earendil-works/pi-ai": "module @earendil-works/pi-ai",
        "@earendil-works/pi-ai/compat": "module @earendil-works/pi-ai/compat",
        "@earendil-works/pi-tui": "module @earendil-works/pi-tui",
      });
    }
    if (dev && process.env.PI_WEB_WEBPACK_CACHE_DIR && config.cache?.type === "filesystem") {
      config.cache.cacheDirectory = process.env.PI_WEB_WEBPACK_CACHE_DIR;
      config.cache.maxMemoryGenerations = 0;
    }
    config.stats = { ...config.stats, errorDetails: true, moduleTrace: true };
    return config;
  },
  allowedDevOrigins: ["127.0.0.1", "192.168.*.*"],
  async headers() {
    return [
      {
        source: "/",
        headers: [
          { key: "Cache-Control", value: "private, no-cache, max-age=0, must-revalidate" },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
        ],
      },
    ];
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_PI_VERSION: piVersion,
  },
};

export default nextConfig;
