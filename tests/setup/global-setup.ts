import { execSync } from "node:child_process";
import { assertSafeDatabase, loadTestEnv } from "../../scripts/test-env.mjs";
import { startWslPostgres } from "./wsl-db";

/**
 * Runs once before the whole suite: re-checks that the target is a local *_test database,
 * starts it when it lives in WSL, then brings its schema up to date. Data is reset per
 * file in per-file.ts.
 */
export default async function setup() {
  const env = loadTestEnv();
  assertSafeDatabase(process.env.DATABASE_URL ?? env.DATABASE_URL);
  const stop = env.TEST_DB_WSL_DISTRO ? await startWslPostgres(env.TEST_DB_WSL_DISTRO) : () => {};
  applySchema(env);
  return stop;
}

/**
 * Applies any committed migrations the test database doesn't have yet (`migrate deploy`
 * never drops data), so the suite tests exactly the schema production will run. Each test
 * file then empties the tables itself (per-file.ts). If a migration is edited after it was
 * applied, recreate the local test database (docs/05-quality/testing.md).
 */
export function applySchema(env: Record<string, string | undefined>) {
  execSync("npx prisma migrate deploy", { stdio: "inherit", env: { ...process.env, ...env } });
}
