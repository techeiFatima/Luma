/**
 * The categories of Open Loop the product recognizes.
 *
 * This list is closed on purpose. A fixed taxonomy is what lets the
 * deterministic prioritizer reason about an item without asking the model what
 * a category "means", and it keeps the dashboard legible.
 */
export const LOOP_CATEGORIES = [
  "deadline",
  "follow_up",
  "appointment_prep",
  "form",
  "renewal",
  "payment",
  "return",
  "commitment",
  "application",
  "reservation",
  "unanswered_email",
  "other",
] as const;

export type LoopCategory = (typeof LOOP_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<LoopCategory, string> = {
  deadline: "Deadline",
  follow_up: "Follow-up",
  appointment_prep: "Appointment prep",
  form: "Form",
  renewal: "Renewal",
  payment: "Payment",
  return: "Return",
  commitment: "Commitment",
  application: "Application",
  reservation: "Reservation",
  unanswered_email: "Unanswered email",
  other: "Other",
};

/**
 * How much inherent weight a category carries when nothing else distinguishes
 * two loops. A missed licence renewal costs more than an unanswered email.
 */
export const CATEGORY_WEIGHTS: Record<LoopCategory, number> = {
  deadline: 1.0,
  payment: 0.95,
  renewal: 0.9,
  application: 0.9,
  form: 0.85,
  return: 0.8,
  commitment: 0.8,
  appointment_prep: 0.75,
  follow_up: 0.7,
  reservation: 0.65,
  unanswered_email: 0.6,
  other: 0.5,
};

export function isLoopCategory(value: string): value is LoopCategory {
  return (LOOP_CATEGORIES as readonly string[]).includes(value);
}

export const LOOP_STATUSES = ["open", "done", "dismissed", "snoozed"] as const;
export type LoopStatus = (typeof LOOP_STATUSES)[number];

export function isLoopStatus(value: string): value is LoopStatus {
  return (LOOP_STATUSES as readonly string[]).includes(value);
}
