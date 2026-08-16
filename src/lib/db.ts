import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import path from "node:path";

/**
 * Single Prisma client, reused across hot reloads in development so we don't
 * exhaust connections or re-open the SQLite file on every request.
 *
 * SQLite keeps local development a one-command setup. The only place the
 * database engine leaks into the codebase is this file — swapping to Postgres
 * means changing the adapter here and the provider in schema.prisma.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const url =
    process.env.DATABASE_URL ?? `file:${path.join(process.cwd(), "prisma", "luma.db")}`;
  const adapter = new PrismaBetterSqlite3({ url });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
