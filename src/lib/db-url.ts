import type { PoolConfig } from "pg";

const LOCAL = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
// Prisma 6 connection-string parameters that node-postgres doesn't understand.
const PRISMA_ONLY_PARAMS = ["pgbouncer", "connection_limit", "pool_timeout", "connect_timeout", "socket_timeout", "statement_cache_size", "schema"];

/**
 * node-postgres pool settings for a connection string (Prisma 7 + @prisma/adapter-pg).
 * - `connection_limit` from the old Prisma URL becomes the pool's `max` (default 10).
 * - Timeouts match Prisma 6: a connection that can't be made in 10 s fails instead of hanging.
 * - TLS: none for local databases; otherwise encrypted. Certificates are verified when
 *   DATABASE_CA_CERT (PEM) is set; without it, the connection is encrypted but the
 *   certificate isn't checked, which is what Prisma 6 did.
 */
export function poolConfig(connectionString: string): PoolConfig {
  const url = new URL(connectionString);
  const max = Number(url.searchParams.get("connection_limit")) || 10;
  for (const p of PRISMA_ONLY_PARAMS) url.searchParams.delete(p);
  const sslmode = url.searchParams.get("sslmode");
  url.searchParams.delete("sslmode");
  const ca = process.env.DATABASE_CA_CERT?.replace(/\\n/g, "\n");
  const ssl = LOCAL.has(url.hostname) || sslmode === "disable" ? false : ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false };
  return {
    connectionString: url.toString(),
    max,
    ssl,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 60_000,
  };
}
