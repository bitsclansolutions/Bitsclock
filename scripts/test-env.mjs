// Loads .env.test and refuses to continue unless it points at a local *_test database.
// Shared by the Vitest config, the Playwright config and `npm run test:db:*`, so no
// test tool can ever be aimed at the Supabase (dev or production) database.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** Parse .env.test (never .env) and return its variables. */
export function loadTestEnv(root = process.cwd()) {
  const file = resolve(root, ".env.test");
  if (!existsSync(file)) {
    throw new Error("Missing .env.test. Copy .env.test.example to .env.test and point it at a local test database.");
  }
  const env = parseEnv(readFileSync(file, "utf8"));
  assertSafeDatabase(env.DATABASE_URL, "DATABASE_URL");
  assertSafeDatabase(env.DIRECT_URL ?? env.DATABASE_URL, "DIRECT_URL");
  return env;
}

/** Throws unless the URL is a Postgres database on this machine whose name ends in _test. */
export function assertSafeDatabase(url, label = "DATABASE_URL") {
  if (!url) throw new Error(`${label} is missing in .env.test.`);
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${label} in .env.test is not a valid URL.`);
  }
  const db = parsed.pathname.replace(/^\//, "");
  if (!LOCAL_HOSTS.has(parsed.hostname) || !db.endsWith("_test")) {
    throw new Error(
      `Refusing to run tests: ${label} must point at a local database whose name ends in "_test" (got host "${parsed.hostname}", database "${db}"). The suite empties every table.`,
    );
  }
}
