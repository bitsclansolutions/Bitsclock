import { execSync } from "node:child_process";
import { loadTestEnv } from "../../scripts/test-env.mjs";
import { startWslPostgres } from "../setup/wsl-db";
import { applySchema } from "../setup/global-setup";

/** Fresh local test database with one admin and one employee (see prepare-db.ts). */
export default async function globalSetup() {
  const env = loadTestEnv();
  const stop = env.TEST_DB_WSL_DISTRO ? await startWslPostgres(env.TEST_DB_WSL_DISTRO) : () => {};
  applySchema(env);
  execSync("npx tsx tests/e2e/prepare-db.ts", { stdio: "inherit", env: { ...process.env, ...env } });
  return stop;
}
