import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

const cacheDir = process.env.VITEST_CACHE_DIR ?? join(tmpdir(), `pi-secagent-vitest-${process.pid}`);
mkdirSync(cacheDir, { recursive: true });

export default defineConfig({
	cacheDir,
	test: {
		include: ["test/**/*.test.ts"],
	},
});
