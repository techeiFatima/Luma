import { prisma } from "@/lib/db";
import { compareLoops } from "./priority";
import { isLoopCategory, type LoopCategory } from "./taxonomy";

/**
 * Read models for the UI.
 *
 * The dashboard shows a deliberately small number of loops. Precision is the
 * product promise, so the default view is the handful worth acting on rather
 * than everything the pipeline has ever found.
 */
export const DASHBOARD_LIMIT = 7;

export interface LoopListItem {
  id: string;
  title: string;
  summary: string;
  category: LoopCategory;
  status: string;
  dueAt: Date | null;
  dueAtBasis: string;
  counterpartyName: string | null;
  counterpartyEmail: string | null;
  amountMinor: number | null;
  amountCurrency: string | null;
  confidence: number;
  consequence: string;
  priorityScore: number;
  priorityBucket: string;
  evidenceCount: number;
}

function toListItem(loop: {
  id: string;
  title: string;
  summary: string;
  category: string;
  status: string;
  dueAt: Date | null;
  dueAtBasis: string;
  counterpartyName: string | null;
  counterpartyEmail: string | null;
  amountMinor: number | null;
  amountCurrency: string | null;
  confidence: number;
  consequence: string;
  priorityScore: number;
  priorityBucket: string;
  _count: { evidence: number };
}): LoopListItem {
  return {
    id: loop.id,
    title: loop.title,
    summary: loop.summary,
    category: (isLoopCategory(loop.category) ? loop.category : "other") as LoopCategory,
    status: loop.status,
    dueAt: loop.dueAt,
    dueAtBasis: loop.dueAtBasis,
    counterpartyName: loop.counterpartyName,
    counterpartyEmail: loop.counterpartyEmail,
    amountMinor: loop.amountMinor,
    amountCurrency: loop.amountCurrency,
    confidence: loop.confidence,
    consequence: loop.consequence,
    priorityScore: loop.priorityScore,
    priorityBucket: loop.priorityBucket,
    evidenceCount: loop._count.evidence,
  };
}

/**
 * What the dashboard treats as needing attention right now.
 *
 * A snoozed loop whose time has come counts as active even before anything has
 * written `open` back to it. The alternative — relying on the background wake
 * in `rescoreOpenLoops` — would mean a loop stays hidden until the next sync,
 * which is precisely when a user who snoozed something until this morning
 * opens the app looking for it.
 */
function activeLoopFilter(now: Date) {
  return {
    OR: [
      { status: "open" },
      { status: "snoozed", snoozedUntil: { lte: now } },
    ],
  };
}

export async function listOpenLoops(
  userId: string,
  limit = DASHBOARD_LIMIT,
  now: Date = new Date(),
) {
  const loops = await prisma.openLoop.findMany({
    where: { userId, ...activeLoopFilter(now) },
    include: { _count: { select: { evidence: true } } },
    orderBy: [{ priorityScore: "desc" }, { dueAt: "asc" }],
  });

  const items = loops.map(toListItem).sort(compareLoops);
  return { items: items.slice(0, limit), total: items.length };
}

/** Loops the user deliberately put off, with the time they chose. */
export async function listSnoozedLoops(userId: string, now: Date = new Date()) {
  const loops = await prisma.openLoop.findMany({
    where: { userId, status: "snoozed", snoozedUntil: { gt: now } },
    include: { _count: { select: { evidence: true } } },
    orderBy: { snoozedUntil: "asc" },
  });
  return loops.map((loop) => ({ ...toListItem(loop), snoozedUntil: loop.snoozedUntil }));
}

export async function listResolvedLoops(userId: string, limit = 20) {
  const loops = await prisma.openLoop.findMany({
    where: { userId, status: { in: ["done", "dismissed"] } },
    include: { _count: { select: { evidence: true } } },
    orderBy: { resolvedAt: "desc" },
    take: limit,
  });
  return loops.map(toListItem);
}

export async function getLoopDetail(userId: string, loopId: string) {
  const loop = await prisma.openLoop.findFirst({
    where: { id: loopId, userId },
    include: {
      evidence: {
        include: {
          sourceItem: {
            select: {
              id: true,
              subject: true,
              fromName: true,
              fromEmail: true,
              sentAt: true,
              snippet: true,
              provider: true,
              externalId: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  return loop;
}

/** Small counters for the dashboard header and the pipeline transparency panel. */
export async function getDashboardStats(userId: string) {
  const [documents, bulk, processed, pending, loops, lastRun, lastSync] = await Promise.all([
    prisma.sourceItem.count({ where: { userId } }),
    prisma.sourceItem.count({ where: { userId, isBulk: true } }),
    prisma.sourceItem.count({ where: { userId, processedAt: { not: null } } }),
    // Non-bulk mail that was fetched but never successfully analyzed. Anything
    // here means the last run did not finish, and the dashboard must say so
    // rather than presenting an empty list as "nothing to do".
    prisma.sourceItem.count({
      where: { userId, isBulk: false, processedAt: null },
    }),
    prisma.openLoop.count({ where: { userId, status: "open" } }),
    prisma.aiRun.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } }),
    prisma.syncState.findFirst({
      where: { account: { userId } },
      orderBy: { lastSyncedAt: "desc" },
    }),
  ]);

  return {
    documents,
    bulkFiltered: bulk,
    processed,
    pendingAnalysis: pending,
    openLoops: loops,
    lastModel: lastRun?.model ?? null,
    lastPromptVersion: lastRun?.promptVersion ?? null,
    lastRunStatus: lastRun?.status ?? null,
    lastRunError: lastRun?.error ?? null,
    lastSyncedAt: lastSync?.lastSyncedAt ?? null,
  };
}
