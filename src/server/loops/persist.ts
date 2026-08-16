import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { buildDedupeKey, findSimilar, type ExistingLoopSummary } from "./dedupe";
import { scoreLoop } from "./priority";
import { isLoopCategory, type LoopCategory } from "./taxonomy";
import type { VerifiedLoop } from "./verify";

const log = logger("loops.persist");

export interface PersistSummary {
  created: number;
  updated: number;
}

/**
 * Writes verified loops, merging into an existing loop where one already
 * represents the same obligation.
 *
 * An update never silently discards what the user has done: a loop the user
 * marked `done` or `dismissed` is left alone, so re-syncing an old thread
 * cannot resurrect something they already dealt with.
 */
export async function persistLoops(
  userId: string,
  loops: VerifiedLoop[],
  now: Date = new Date(),
): Promise<PersistSummary> {
  const summary: PersistSummary = { created: 0, updated: 0 };
  if (loops.length === 0) return summary;

  const existing: ExistingLoopSummary[] = await prisma.openLoop.findMany({
    where: { userId },
    select: {
      id: true,
      title: true,
      category: true,
      counterpartyEmail: true,
      dueAt: true,
      status: true,
    },
  });

  for (const loop of loops) {
    const dedupeKey = buildDedupeKey(loop);

    const byKey = await prisma.openLoop.findUnique({
      where: { userId_dedupeKey: { userId, dedupeKey } },
    });
    const match = byKey ?? (await resolveSimilar(loop, existing));

    if (match) {
      if (match.status === "done" || match.status === "dismissed") {
        log.debug("skipping resolved loop", { loopId: match.id });
        continue;
      }

      // Only let a re-extraction overwrite facts when it is at least as
      // confident; otherwise a weaker later pass could erase a good date.
      const takeNewFacts = loop.confidence >= match.confidence;
      const priority = scoreLoop(
        {
          category: (isLoopCategory(match.category) ? match.category : "other") as LoopCategory,
          dueAt: takeNewFacts ? loop.dueAt : match.dueAt,
          consequence: takeNewFacts
            ? loop.consequence
            : (match.consequence as "high" | "medium" | "low"),
          confidence: Math.max(loop.confidence, match.confidence),
          firstSeenAt: match.firstSeenAt,
        },
        now,
      );

      await prisma.openLoop.update({
        where: { id: match.id },
        data: {
          lastSeenAt: now,
          confidence: Math.max(loop.confidence, match.confidence),
          priorityScore: priority.score,
          priorityBucket: priority.bucket,
          ...(takeNewFacts
            ? {
                title: loop.title,
                summary: loop.summary,
                dueAt: loop.dueAt,
                dueAtBasis: loop.dueAtBasis,
                dueAtEvidence: loop.dueAtEvidence,
                consequence: loop.consequence,
                inferenceNotes: loop.inferenceNotes,
                amountMinor: loop.amountMinor,
                amountCurrency: loop.amountCurrency,
              }
            : {}),
        },
      });

      await attachEvidence(match.id, loop);
      summary.updated += 1;
      continue;
    }

    const priority = scoreLoop(
      {
        category: loop.category,
        dueAt: loop.dueAt,
        consequence: loop.consequence,
        confidence: loop.confidence,
        firstSeenAt: now,
      },
      now,
    );

    const created = await prisma.openLoop.create({
      data: {
        userId,
        title: loop.title,
        summary: loop.summary,
        category: loop.category,
        status: "open",
        dueAt: loop.dueAt,
        dueAtBasis: loop.dueAtBasis,
        dueAtEvidence: loop.dueAtEvidence,
        counterpartyName: loop.counterpartyName,
        counterpartyEmail: loop.counterpartyEmail,
        amountMinor: loop.amountMinor,
        amountCurrency: loop.amountCurrency,
        confidence: loop.confidence,
        consequence: loop.consequence,
        inferenceNotes: loop.inferenceNotes,
        priorityScore: priority.score,
        priorityBucket: priority.bucket,
        dedupeKey,
        firstSeenAt: now,
        lastSeenAt: now,
      },
    });

    await attachEvidence(created.id, loop);
    existing.push({
      id: created.id,
      title: loop.title,
      category: loop.category,
      counterpartyEmail: loop.counterpartyEmail,
      dueAt: loop.dueAt,
      status: "open",
    });
    summary.created += 1;
  }

  log.info("persisted loops", { userId, ...summary });
  return summary;
}

async function resolveSimilar(loop: VerifiedLoop, existing: ExistingLoopSummary[]) {
  const similar = findSimilar(loop, existing);
  if (!similar) return null;
  return prisma.openLoop.findUnique({ where: { id: similar.id } });
}

async function attachEvidence(loopId: string, loop: VerifiedLoop): Promise<void> {
  for (const item of loop.evidence) {
    // The unique constraint makes this idempotent across repeated syncs.
    await prisma.openLoopEvidence.upsert({
      where: {
        loopId_sourceItemId_quote: { loopId, sourceItemId: item.sourceItemId, quote: item.quote },
      },
      create: {
        loopId,
        sourceItemId: item.sourceItemId,
        quote: item.quote,
        supports: item.supports,
      },
      update: {},
    });
  }
}

/**
 * Recomputes priority for every open loop.
 *
 * Urgency is a function of *now*, so scores go stale on their own. This runs on
 * each sync and on dashboard load so ordering is always current without any
 * model involvement.
 */
export async function rescoreOpenLoops(userId: string, now: Date = new Date()): Promise<number> {
  const loops = await prisma.openLoop.findMany({
    where: { userId, status: { in: ["open", "snoozed"] } },
  });

  let updated = 0;
  for (const loop of loops) {
    const priority = scoreLoop(
      {
        category: (isLoopCategory(loop.category) ? loop.category : "other") as LoopCategory,
        dueAt: loop.dueAt,
        consequence: loop.consequence as "high" | "medium" | "low",
        confidence: loop.confidence,
        firstSeenAt: loop.firstSeenAt,
      },
      now,
    );

    if (priority.score !== loop.priorityScore || priority.bucket !== loop.priorityBucket) {
      await prisma.openLoop.update({
        where: { id: loop.id },
        data: { priorityScore: priority.score, priorityBucket: priority.bucket },
      });
      updated += 1;
    }
  }
  return updated;
}
