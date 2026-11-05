/**
 * Production configuration rules. Checked once at server start by src/instrumentation.ts,
 * which refuses to start a production server that breaks any of them.
 *
 * - APP_URL (R-062): links in emails are built only from it, never from request headers,
 *   so a forged Host header can't point a reset or invite link at another site.
 * - Redis (D-004): production runs on several instances; caches, invalidations and rate
 *   limits must be shared, so Upstash Redis is required.
 * - AUTH_SECRET and DATABASE_URL must be present and sane.
 */
export function productionConfigProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  const problems: string[] = [];
  const app = env.APP_URL?.trim();
  if (!app) problems.push("APP_URL is not set. Set it to the public https:// address of the app.");
  else {
    try {
      const u = new URL(app);
      if (u.protocol !== "https:") problems.push("APP_URL must start with https:// in production.");
    } catch {
      problems.push("APP_URL is not a valid URL.");
    }
  }
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
    problems.push("UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set in production (shared cache and rate limits, D-004).");
  }
  if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32) problems.push("AUTH_SECRET must be at least 32 characters.");
  if (!env.DATABASE_URL) problems.push("DATABASE_URL is not set.");
  return problems;
}

export const isProduction = () => process.env.NODE_ENV === "production";
