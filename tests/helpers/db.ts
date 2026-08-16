import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Shared database harness for tests.
 *
 * Each test file gets its own SQLite file, created by running the real
 * migrations rather than `db push`. That matters: it means the tests exercise
 * the same DDL that production will run, so a broken migration fails the suite
 * instead of shipping.
 *
 * `DATABASE_URL` must be set before `@/lib/db` is first imported, so callers
 * import the client dynamically after `setupTestDatabase()` — see the usage
 * note on `createTestContext`.
 */

export interface TestDatabase {
  url: string;
  path: string;
  destroy(): void;
}

export function setupTestDatabase(label: string): TestDatabase {
  const file = path.join(
    os.tmpdir(),
    `luma-test-${label}-${process.pid}-${Math.random().toString(36).slice(2, 8)}.db`,
  );
  const url = `file:${file}`;

  process.env.DATABASE_URL = url;
  // NODE_ENV is typed readonly, but tests genuinely need to set it.
  if (!process.env.NODE_ENV) Object.assign(process.env, { NODE_ENV: "test" });

  execFileSync(
    "npx",
    ["prisma", "migrate", "deploy", "--schema=prisma/schema.prisma"],
    { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" },
  );

  return {
    url,
    path: file,
    destroy() {
      for (const suffix of ["", "-journal", "-wal", "-shm"]) {
        fs.rmSync(`${file}${suffix}`, { force: true });
      }
    },
  };
}

/**
 * Deletes all rows while leaving the schema in place. Cheaper than recreating
 * the database between tests, and ordered so foreign keys never block a delete
 * (cascades cover most of it, but being explicit keeps it obvious).
 */
export async function truncateAll(prisma: {
  notification: { deleteMany: () => Promise<unknown> };
  action: { deleteMany: () => Promise<unknown> };
  openLoopEvidence: { deleteMany: () => Promise<unknown> };
  openLoop: { deleteMany: () => Promise<unknown> };
  sourceItem: { deleteMany: () => Promise<unknown> };
  syncState: { deleteMany: () => Promise<unknown> };
  aiRun: { deleteMany: () => Promise<unknown> };
  connectedAccount: { deleteMany: () => Promise<unknown> };
  user: { deleteMany: () => Promise<unknown> };
}): Promise<void> {
  await prisma.notification.deleteMany();
  await prisma.action.deleteMany();
  await prisma.openLoopEvidence.deleteMany();
  await prisma.openLoop.deleteMany();
  await prisma.sourceItem.deleteMany();
  await prisma.syncState.deleteMany();
  await prisma.aiRun.deleteMany();
  await prisma.connectedAccount.deleteMany();
  await prisma.user.deleteMany();
}

let counter = 0;

/** Unique-per-call fixture values, so tests never collide on unique columns. */
export function uniqueEmail(prefix = "user"): string {
  counter += 1;
  return `${prefix}-${process.pid}-${counter}@example.test`;
}

export function uniqueKey(prefix = "key"): string {
  counter += 1;
  return `${prefix}-${process.pid}-${counter}`;
}
