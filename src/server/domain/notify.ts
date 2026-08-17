import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { listOpenLoops } from "../loops/queries";
import { isDeliverable, NOTIFIER_LOOKBACK_MS, planNotifications } from "./notifier";
import type { NotifierPolicy } from "./notifier";

const log = logger("notify");

/**
 * Runs the notifier and writes what it decides.
 *
 * The unique index on (userId, dedupeKey) is the real guarantee against
 * repeating ourselves — the in-memory key check below is an optimisation, not
 * the safety net. Two syncs racing each other will both plan the same
 * notification and the database will reject the second, which is why creates
 * are attempted individually and a conflict is treated as success.
 */
export async function runNotifier(
  userId: string,
  now: Date = new Date(),
  policy?: Partial<NotifierPolicy>,
): Promise<{ planned: number; created: number }> {
  const { items } = await listOpenLoops(userId, 50, now);

  const [existing, recentCount] = await Promise.all([
    prisma.notification.findMany({ where: { userId }, select: { dedupeKey: true } }),
    prisma.notification.count({
      where: { userId, createdAt: { gte: new Date(now.getTime() - NOTIFIER_LOOKBACK_MS) } },
    }),
  ]);

  const planned = planNotifications({
    loops: items,
    existingKeys: new Set(existing.map((row) => row.dedupeKey)),
    sentInLastDay: recentCount,
    now,
    policy,
  });

  let created = 0;
  for (const notification of planned) {
    try {
      await prisma.notification.create({
        data: {
          userId,
          loopId: notification.loopId,
          channel: notification.channel,
          status: "pending",
          title: notification.title,
          body: notification.body,
          scheduledFor: notification.scheduledFor,
          dedupeKey: notification.dedupeKey,
        },
      });
      created += 1;
    } catch {
      // Unique violation: another run got there first. Nothing to do.
    }
  }

  if (planned.length > 0) {
    log.info("notifications planned", { userId, planned: planned.length, created });
  }
  return { planned: planned.length, created };
}

export interface InboxNotification {
  id: string;
  loopId: string | null;
  title: string;
  body: string | null;
  status: string;
  createdAt: Date;
}

/**
 * What the user should see right now.
 *
 * Notifications scheduled into the future (held back by quiet hours) are
 * deliberately withheld — showing them early would defeat the point of
 * scheduling them at all.
 */
export async function listNotifications(
  userId: string,
  now: Date = new Date(),
): Promise<InboxNotification[]> {
  const rows = await prisma.notification.findMany({
    where: { userId, status: { in: ["pending", "sent"] } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return rows
    .filter((row) => isDeliverable(row, now))
    .map((row) => ({
      id: row.id,
      loopId: row.loopId,
      title: row.title,
      body: row.body,
      status: row.status,
      createdAt: row.createdAt,
    }));
}

/** Marks one notification read. Scoped by user so an id alone is not enough. */
export async function markNotificationRead(userId: string, id: string): Promise<boolean> {
  const result = await prisma.notification.updateMany({
    where: { id, userId },
    data: { status: "read", readAt: new Date() },
  });
  return result.count > 0;
}

export async function markAllNotificationsRead(userId: string): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: { userId, status: { in: ["pending", "sent"] } },
    data: { status: "read", readAt: new Date() },
  });
  return result.count;
}
