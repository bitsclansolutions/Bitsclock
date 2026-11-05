import { prisma } from "@/lib/prisma";
import { kv, kvEnabled } from "@/lib/kv";
import { handler } from "@/lib/api";

/**
 * Health check for uptime monitors and the host (R-022). Public, but says nothing beyond
 * up/down per dependency: 200 when the database (and Redis, when configured) answer,
 * 503 otherwise. Never cached.
 */
export const GET = handler(async () => {
  const timed = async (probe: () => Promise<unknown>) => {
    const started = Date.now();
    try {
      await Promise.race([probe(), new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000))]);
      return { ok: true, ms: Date.now() - started };
    } catch {
      return { ok: false, ms: Date.now() - started };
    }
  };
  const [db, redis] = await Promise.all([timed(() => prisma.$queryRaw`SELECT 1`), kvEnabled ? timed(() => kv("PING")) : Promise.resolve(null)]);
  const ok = db.ok && (redis === null || redis.ok);
  return new Response(
    JSON.stringify({ ok, database: db.ok ? "up" : "down", redis: redis === null ? "not configured" : redis.ok ? "up" : "down", at: new Date().toISOString() }),
    { status: ok ? 200 : 503, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } },
  );
});
