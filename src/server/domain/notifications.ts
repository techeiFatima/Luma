import { contentHash } from "@/lib/crypto";

/**
 * The Notification vocabulary.
 *
 * As with actions, these unions back the string columns and are the source of
 * truth for what the delivery pipeline may write.
 */

export const NOTIFICATION_CHANNELS = ["in_app", "email", "push"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_STATUSES = [
  "pending",
  "sent",
  "read",
  "failed",
  "suppressed",
] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export function isNotificationChannel(value: string): value is NotificationChannel {
  return (NOTIFICATION_CHANNELS as readonly string[]).includes(value);
}

export function isNotificationStatus(value: string): value is NotificationStatus {
  return (NOTIFICATION_STATUSES as readonly string[]).includes(value);
}

/**
 * Why a notification was raised. Part of the dedupe key, so a loop that
 * becomes urgent and *then* becomes overdue produces two notifications, while
 * re-running the notifier for the same reason produces none.
 */
export const NOTIFICATION_TRIGGERS = [
  "due_soon",
  "overdue",
  "newly_urgent",
  "digest",
] as const;
export type NotificationTrigger = (typeof NOTIFICATION_TRIGGERS)[number];

const TRANSITIONS: Record<NotificationStatus, readonly NotificationStatus[]> = {
  pending: ["sent", "failed", "suppressed"],
  failed: ["pending", "suppressed"],
  sent: ["read"],
  read: [],
  suppressed: [],
};

export function canTransition(from: NotificationStatus, to: NotificationStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * The key that makes "never tell the user the same thing twice" a database
 * constraint rather than an intention.
 *
 * Scoped to (loop, trigger, channel): the same loop may legitimately produce a
 * `due_soon` and later an `overdue` notification, and may reach the user on
 * more than one channel, but the same combination never fires twice.
 */
export function buildNotificationDedupeKey(input: {
  loopId: string | null;
  trigger: NotificationTrigger;
  channel: NotificationChannel;
  /** Optional bucket, e.g. a date, for recurring notifications like digests. */
  window?: string;
}): string {
  return contentHash(
    input.loopId ?? "no-loop",
    input.trigger,
    input.channel,
    input.window ?? "",
  );
}
