import { defineConfig } from "@playwright/test";
import { loadTestEnv } from "./scripts/test-env.mjs";

// Same safety check as the unit/API suite: only a local *_test database.
const testEnv = loadTestEnv();
const PORT = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Uses the Chrome already installed on the machine; no browser download needed.
    channel: "chrome",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npx next dev --webpack --port ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: { ...testEnv, NEXT_DIST_DIR: ".next-e2e", NODE_ENV: "development" },
  },
});
