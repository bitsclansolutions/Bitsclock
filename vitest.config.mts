import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { loadTestEnv } from "./scripts/test-env.mjs";

// .env.test only (never .env), checked to be a local *_test database before anything runs.
const testEnv = loadTestEnv(fileURLToPath(new URL(".", import.meta.url)));

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/api/**/*.test.ts"],
    env: { ...testEnv, NODE_ENV: "test" },
    globalSetup: ["tests/setup/global-setup.ts"],
    setupFiles: ["tests/setup/per-file.ts"],
    // Files share one database and truncate it, so they run one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
