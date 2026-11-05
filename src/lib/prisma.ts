import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@/generated/prisma/client";
import { poolConfig } from "./db-url";

export { Prisma };

/**
 * Reads are safe to repeat; writes are not (a write that reached the database before the
 * connection dropped would run twice). So only these operations are ever retried (R-028).
 */
const READ_OPERATIONS = new Set(["findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany", "count", "aggregate", "groupBy", "$queryRaw"]);

/**
 * Failures to *open* a connection: the query never reached the database. Pool exhaustion
 * ("timeout exceeded when trying to connect", P2024) is deliberately not here: retrying
 * it only adds load to a database that's already saturated.
 */
function isConnectFailure(e: unknown) {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P1001") return true;
  if (e instanceof Prisma.PrismaClientInitializationError) return true;
  const code = (e as { code?: string; cause?: { code?: string } } | null)?.code ?? (e as { cause?: { code?: string } } | null)?.cause?.code;
  if (code && ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"].includes(code)) return true;
  const msg = e instanceof Error ? e.message : "";
  return /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|Can't reach database server/i.test(msg);
}

const RETRY_DELAYS_MS = [300, 900];

/** A Prisma client on the pooled connection string, with the read-only retry policy above. */
export function createPrismaClient(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error("DATABASE_URL must be set.");
  const base = new PrismaClient({
    adapter: new PrismaPg(poolConfig(connectionString)),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
  return base.$extends({
    query: {
      $allOperations: async ({ operation, args, query }) => {
        if (!READ_OPERATIONS.has(operation)) return query(args);
        for (let attempt = 0; ; attempt++) {
          try {
            return await query(args);
          } catch (e) {
            if (!isConnectFailure(e) || attempt >= RETRY_DELAYS_MS.length) throw e;
            await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]!));
          }
        }
      },
    },
  });
}

type Client = ReturnType<typeof createPrismaClient>;
/** The client handed to `prisma.$transaction(async (tx) => …)` (the extended client minus its top-level methods). */
export type Tx = Omit<Client, "$extends" | "$transaction" | "$connect" | "$disconnect" | "$on" | "$use">;
const globalForPrisma = globalThis as unknown as { prisma?: Client };

export const prisma: Client = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
