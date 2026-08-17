import { DAY_MS } from "@/lib/time";
import type { LoopListItem } from "../loops/queries";
import {
  buildNotificationDedupeKey,
  type NotificationChannel,
  type NotificationTrigger,
} from "./notifications";

/**
 * Deciding what is worth interrupting someone for.
 *
 * The delivery mechanics are the easy half. The hard half is restraint: a
 * product that notifies about everything gets muted, and a muted product
 * cannot do its job at all. So the bar here is deliberately higher than the
 * bar for showing something on the dashboard. Appearing in the list means
 * "this is worth your attention when you look"; a notification means "this is
 * worth taking your attention now", and most true obligations do not clear
 * that second bar.
 *
 * Four rules do the work:
 *   1. Only time-sensitive, consequential, confidently-extracted loops qualify.
 *   2. The same thing is never announced twice — enforced by a unique index,
 *      not by remembering to check.
 *   3. Several at once collapse into one digest rather than a burst.
 *   4. Nothing arrives in the middle of the night; it waits for morning.
 */

export interface NotifierPolicy {
  /** Loops below this priority never justify an interruption. */
  minPriorityScore: number;
  /** Below this confidence, Luma is not sure enough to interrupt. */
  minConfidence: number;
  /** How close a deadline must be to count as time-sensitive. */
  dueSoonHours: number;
  /** More candidates than this in one run collapse into a digest. */
  digestThreshold: number;
  /** Hard ceiling per rolling day, digests included. */
  maxPerDay: number;
  /** Local hour (0-23) when quiet time starts. */
  quietFromHour: number;
  /** Local hour (0-23) when quiet time ends. */
  quietUntilHour: number;
  /** Minutes to add to UTC to get the user's local time. */
  utcOffsetMinutes: number;
}

export const DEFAULT_POLICY: NotifierPolicy = {
  minPriorityScore: 60,
  minConfidence: 0.7,
  dueSoonHours: 48,
  digestThreshold: 2,
  maxPerDay: 3,
  quietFromHour: 21,
  quietUntilHour: 8,
  utcOffsetMinutes: 0,
};

export interface PlannedNotification {
  loopId: string | null;
  trigger: NotificationTrigger;
  channel: NotificationChannel;
  title: string;
  body: string;
  scheduledFor: Date;
  dedupeKey: string;
}

export interface NotifierInput {
  loops: LoopListItem[];
  /** Dedupe keys already present for this user. */
  existingKeys: Set<string>;
  /** Notifications already created in the last 24 hours. */
  sentInLastDay: number;
  now: Date;
  policy?: Partial<NotifierPolicy>;
}

function localHour(date: Date, offsetMinutes: number): number {
  return new Date(date.getTime() + offsetMinutes * 60_000).getUTCHours();
}

/**
 * Moves a delivery time out of quiet hours.
 *
 * Quiet hours delay rather than suppress. A deadline that becomes urgent at
 * 2am is still urgent at 8am, and dropping the notification entirely would
 * mean the one night something genuinely mattered is the night Luma said
 * nothing.
 */
export function nextDeliverableTime(now: Date, policy: NotifierPolicy): Date {
  const hour = localHour(now, policy.utcOffsetMinutes);
  const inQuietPeriod =
    policy.quietFromHour > policy.quietUntilHour
      ? hour >= policy.quietFromHour || hour < policy.quietUntilHour
      : hour >= policy.quietFromHour && hour < policy.quietUntilHour;

  if (!inQuietPeriod) return now;

  const local = new Date(now.getTime() + policy.utcOffsetMinutes * 60_000);
  const wake = new Date(local);
  wake.setUTCHours(policy.quietUntilHour, 0, 0, 0);
  // Past this morning's wake time means we are in the evening half of the
  // quiet window, so the next opening is tomorrow.
  if (wake.getTime() <= local.getTime()) wake.setUTCDate(wake.getUTCDate() + 1);

  return new Date(wake.getTime() - policy.utcOffsetMinutes * 60_000);
}

function hoursUntil(date: Date, now: Date): number {
  return (date.getTime() - now.getTime()) / 3_600_000;
}

/** Whether a single loop clears the bar for interrupting someone. */
export function qualifies(
  loop: LoopListItem,
  policy: NotifierPolicy,
  now: Date,
): { trigger: NotificationTrigger; reason: string } | null {
  if (loop.status !== "open") return null;
  // Uncertainty is a reason to stay quiet. The dashboard can afford to show a
  // 0.6-confidence loop; a notification cannot.
  if (loop.confidence < policy.minConfidence) return null;
  if (loop.consequence === "low") return null;
  if (!loop.dueAt) return null;

  const hours = hoursUntil(loop.dueAt, now);
  if (hours < 0) {
    // Something already missed is worth saying regardless of score — that is
    // the case the product exists for.
    return { trigger: "overdue", reason: "deadline has passed" };
  }
  if (hours <= policy.dueSoonHours && loop.priorityScore >= policy.minPriorityScore) {
    return { trigger: "due_soon", reason: "deadline is close" };
  }
  return null;
}

function describeDue(loop: LoopListItem, now: Date): string {
  const hours = hoursUntil(loop.dueAt!, now);
  if (hours < -24) return `was due ${Math.round(Math.abs(hours) / 24)} days ago`;
  if (hours < 0) return "was due yesterday";
  if (hours < 24) return "is due today";
  return "is due tomorrow";
}

/**
 * Decides what to send. Pure: no database, no clock of its own, so every rule
 * above is directly testable.
 */
export function planNotifications(input: NotifierInput): PlannedNotification[] {
  const policy = { ...DEFAULT_POLICY, ...input.policy };
  const { now } = input;

  const remaining = policy.maxPerDay - input.sentInLastDay;
  if (remaining <= 0) return [];

  const candidates = input.loops
    .map((loop) => ({ loop, verdict: qualifies(loop, policy, now) }))
    .filter((entry): entry is { loop: LoopListItem; verdict: { trigger: NotificationTrigger; reason: string } } =>
      entry.verdict !== null,
    )
    // Most urgent first, so a cap or a digest keeps the important ones.
    .sort((a, b) => b.loop.priorityScore - a.loop.priorityScore);

  const scheduledFor = nextDeliverableTime(now, policy);
  const channel: NotificationChannel = "in_app";

  // --- Several at once become one message ----------------------------------
  if (candidates.length > policy.digestThreshold) {
    // The window keys the digest to a calendar day, so a second sync on the
    // same day cannot produce a second digest.
    const window = new Date(now.getTime() + policy.utcOffsetMinutes * 60_000)
      .toISOString()
      .slice(0, 10);
    const dedupeKey = buildNotificationDedupeKey({
      loopId: null,
      trigger: "digest",
      channel,
      window,
    });
    if (input.existingKeys.has(dedupeKey)) return [];

    const overdue = candidates.filter((c) => c.verdict.trigger === "overdue").length;
    const lead = candidates[0]!.loop;
    return [
      {
        loopId: null,
        trigger: "digest",
        channel,
        title: `${candidates.length} things need you`,
        body:
          overdue > 0
            ? `${overdue} of them are already overdue, starting with ${lead.title}.`
            : `The most pressing is ${lead.title}, which ${describeDue(lead, now)}.`,
        scheduledFor,
        dedupeKey,
      },
    ];
  }

  // --- One or two: name them individually ----------------------------------
  const planned: PlannedNotification[] = [];
  for (const { loop, verdict } of candidates) {
    if (planned.length >= remaining) break;

    const dedupeKey = buildNotificationDedupeKey({
      loopId: loop.id,
      trigger: verdict.trigger,
      channel,
    });
    if (input.existingKeys.has(dedupeKey)) continue;

    planned.push({
      loopId: loop.id,
      trigger: verdict.trigger,
      channel,
      title:
        verdict.trigger === "overdue"
          ? `${loop.title} is overdue`
          : `${loop.title} ${describeDue(loop, now)}`,
      body: loop.summary,
      scheduledFor,
      dedupeKey,
    });
  }

  return planned;
}

/** Notifications whose scheduled time has arrived. */
export function isDeliverable(notification: { scheduledFor: Date | null }, now: Date): boolean {
  return !notification.scheduledFor || notification.scheduledFor.getTime() <= now.getTime();
}

export const NOTIFIER_LOOKBACK_MS = DAY_MS;
