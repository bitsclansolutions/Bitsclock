import { Prisma, PrismaClient } from "@prisma/client";

/** Prisma error codes that are safe to retry: dropped connection, pool timeout, server unreachable. */
const TRANSIENT = new Set(["P1001", "P1002", "P1008", "P1017", "P2024", "P2034"]);
const RETRY_DELAYS_MS = [300, 900, 2000];

function isTransient(e: unknown) {
  if (e instanceof Prisma.PrismaClientKnownRequestError) return TRANSIENT.has(e.code);
  if (e instanceof Prisma.PrismaClientInitializationError) return true;
  const msg = e instanceof Error ? e.message : "";
  return /Can't reach database server|connection pool|ECONNRESET|ETIMEDOUT|socket hang up/i.test(msg);
}

function createClient() {
  const base = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
  // Retry transient connection failures with a short backoff so a dropped
  // pooled connection or a momentary pool exhaustion doesn't surface as a 500.
  return base.$extends({
    query: {
      $allOperations: async ({ args, query }) => {
        let attempt = 0;
        for (;;) {
          try {
            return await query(args);
          } catch (e) {
            if (!isTransient(e) || attempt >= RETRY_DELAYS_MS.length) throw e;
            await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]!));
            attempt++;
          }
        }
      },
    },
  });
}

type Client = ReturnType<typeof createClient>;
const globalForPrisma = globalThis as unknown as { prisma?: Client };

export const prisma: Client = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
