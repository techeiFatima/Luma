import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import { getConfig } from "@/config";

/**
 * Single Prisma client, reused across hot reloads in development so we don't
 * exhaust connections or re-open the SQLite file on every request.
 *
 * SQLite keeps local development a one-command setup. This module is the only
 * place the database engine leaks into the codebase — moving to Postgres means
 * changing the adapter here and the provider in schema.prisma.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const config = getConfig();
  const adapter = new PrismaBetterSqlite3({ url: config.databaseUrl });
  return new PrismaClient({
    adapter,
    log: config.isDevelopment ? ["warn", "error"] : ["error"],
  });
}

function getClient(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createClient();
  }
  return globalForPrisma.prisma;
}

/**
 * Constructed on first use, not at import.
 *
 * `next build` imports every route module to collect metadata, with
 * NODE_ENV=production and none of the runtime secrets present. Building the
 * client eagerly made that step load configuration and fail the build — and it
 * would also open the SQLite file during a build that never queries it.
 * The proxy defers both until something actually touches the database.
 */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getClient();
    const value = Reflect.get(client, property, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

/**
 * Verifies the database is reachable. Used by the health endpoint; kept here
 * so nothing else needs to know what a cheap liveness query looks like.
 */
export async function checkDatabase(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const startedAt = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
