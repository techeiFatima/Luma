export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

/** Whole days from `now` until `date`. Negative when the date has passed. */
export function daysUntil(date: Date, now: Date = new Date()): number {
  return Math.floor((date.getTime() - now.getTime()) / DAY_MS);
}

export function hoursUntil(date: Date, now: Date = new Date()): number {
  return (date.getTime() - now.getTime()) / HOUR_MS;
}

/**
 * Parses a date the model produced. We only accept unambiguous ISO forms
 * (`YYYY-MM-DD` or a full ISO timestamp) — anything looser risks inventing a
 * deadline out of a malformed string.
 */
export function parseModelDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
  const isoTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;
  if (!dateOnly.test(trimmed) && !isoTimestamp.test(trimmed)) return null;

  // Interpret a bare date as end-of-day UTC: a "due Friday" item is not overdue
  // at 00:00 on Friday.
  const parsed = dateOnly.test(trimmed)
    ? new Date(`${trimmed}T23:59:59.000Z`)
    : new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatRelativeDue(date: Date | null, now: Date = new Date()): string {
  if (!date) return "No date";
  const days = daysUntil(date, now);
  if (days < -1) return `${Math.abs(days)} days overdue`;
  if (days === -1) return "1 day overdue";
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  if (days < 7) return `Due in ${days} days`;
  if (days < 14) return "Due next week";
  return `Due ${date.toISOString().slice(0, 10)}`;
}

export function formatSentAt(date: Date, now: Date = new Date()): string {
  const days = Math.abs(daysUntil(date, now));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return date.toISOString().slice(0, 10);
}
