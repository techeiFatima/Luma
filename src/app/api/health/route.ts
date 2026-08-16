import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getConfig } from "@/config";
import { checkDatabase, prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { REQUEST_ID_HEADER } from "@/server/http/route";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Health check.
 *
 * Deliberately not wrapped in the standard `route()` envelope: a monitor wants
 * a bare 200/503 and a small, stable body, not an `{ok, data}` wrapper it has
 * to unwrap. It is also the one endpoint that must keep working when the rest
 * of the app is broken, so it depends on as little as possible.
 *
 * Unauthenticated, so the body carries no configuration values and no error
 * detail outside development — only whether each dependency is answering.
 */

const startedAt = Date.now();

interface Check {
  name: string;
  ok: boolean;
  latencyMs?: number;
  detail?: string;
}

/**
 * Reachable is not the same as ready. A database that answers `SELECT 1` but
 * has no schema will fail every real request, so readiness checks that
 * migrations have actually been applied.
 */
async function checkMigrations(): Promise<Check> {
  const start = Date.now();
  try {
    const rows = await prisma.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*) as count FROM _prisma_migrations WHERE finished_at IS NOT NULL
    `;
    const applied = Number(rows[0]?.count ?? 0);
    return {
      name: "migrations",
      ok: applied > 0,
      latencyMs: Date.now() - start,
      detail: applied > 0 ? `${applied} applied` : "no migrations applied",
    };
  } catch (error) {
    return {
      name: "migrations",
      ok: false,
      latencyMs: Date.now() - start,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function GET() {
  const requestId = randomUUID();
  const log = logger("api.health").child({ requestId });

  let config: ReturnType<typeof getConfig> | null = null;
  let configOk = true;
  let configDetail: string | undefined;
  try {
    config = getConfig();
  } catch (error) {
    configOk = false;
    configDetail = error instanceof Error ? error.message : String(error);
  }

  const database = await checkDatabase();
  const migrations = database.ok
    ? await checkMigrations()
    : { name: "migrations", ok: false, detail: "skipped: database unreachable" };

  const checks: Check[] = [
    { name: "config", ok: configOk, ...(configDetail ? { detail: configDetail } : {}) },
    {
      name: "database",
      ok: database.ok,
      latencyMs: database.latencyMs,
      ...(database.error ? { detail: database.error } : {}),
    },
    migrations,
  ];

  const isDevelopment = config?.isDevelopment ?? process.env.NODE_ENV !== "production";
  const healthy = checks.every((check) => check.ok);

  const body = {
    status: healthy ? ("ok" as const) : ("degraded" as const),
    version: process.env.npm_package_version ?? "0.1.0",
    env: config?.env ?? process.env.NODE_ENV ?? "unknown",
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
    checks: checks.map((check) =>
      // Failure detail can name internal paths, so it stays in the logs in
      // production and the response only says which check failed.
      isDevelopment ? check : { name: check.name, ok: check.ok, latencyMs: check.latencyMs },
    ),
    // Which optional capabilities are wired up. Booleans only — never values.
    features: config
      ? { ai: config.ai.enabled, google: config.google.enabled, demoMode: config.demoMode }
      : undefined,
  };

  if (!healthy) {
    log.warn("health check degraded", {
      failed: checks.filter((check) => !check.ok).map((check) => check.name),
    });
  }

  return NextResponse.json(body, {
    status: healthy ? 200 : 503,
    headers: { [REQUEST_ID_HEADER]: requestId, "cache-control": "no-store" },
  });
}
