/**
 * The Action vocabulary.
 *
 * SQLite has no enums, so these unions are the source of truth for what may go
 * in `Action.type` / `Action.status`. Keeping them in code rather than in the
 * database also means the state machine below can be unit-tested.
 */

export const ACTION_TYPES = [
  /** Prepare a reply for the user to review. Never sends. */
  "draft_email",
  /** Create a reminder inside Luma. No external effect. */
  "create_reminder",
  /** Add an event to the user's calendar. */
  "create_calendar_event",
] as const;

export type ActionType = (typeof ACTION_TYPES)[number];

export const ACTION_STATUSES = [
  "proposed",
  "approved",
  "rejected",
  "executing",
  "executed",
  "failed",
  "cancelled",
] as const;

export type ActionStatus = (typeof ACTION_STATUSES)[number];

export function isActionType(value: string): value is ActionType {
  return (ACTION_TYPES as readonly string[]).includes(value);
}

export function isActionStatus(value: string): value is ActionStatus {
  return (ACTION_STATUSES as readonly string[]).includes(value);
}

/**
 * Actions whose effects escape Luma. These may never run without an explicit,
 * per-action user approval — see `canExecute`.
 */
export const EXTERNAL_ACTION_TYPES: readonly ActionType[] = [
  "draft_email",
  "create_calendar_event",
];

export function hasExternalEffect(type: ActionType): boolean {
  return EXTERNAL_ACTION_TYPES.includes(type);
}

/** Legal status transitions. Anything not listed here is rejected. */
const TRANSITIONS: Record<ActionStatus, readonly ActionStatus[]> = {
  proposed: ["approved", "rejected", "cancelled"],
  approved: ["executing", "cancelled"],
  // Retry after a failure re-enters `executing`.
  executing: ["executed", "failed"],
  failed: ["executing", "cancelled"],
  // Terminal.
  executed: [],
  rejected: [],
  cancelled: [],
};

export function canTransition(from: ActionStatus, to: ActionStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export const TERMINAL_ACTION_STATUSES: readonly ActionStatus[] = [
  "executed",
  "rejected",
  "cancelled",
];

export function isTerminal(status: ActionStatus): boolean {
  return TERMINAL_ACTION_STATUSES.includes(status);
}

/**
 * The gate every executor must pass through.
 *
 * An action with an outside effect requires `approvedAt` to be set, regardless
 * of its `requiresApproval` flag — a bug that flipped the flag must not become
 * a bug that sends email. Being in `approved` state is not enough on its own;
 * the timestamp is the evidence that a human said yes.
 */
export function canExecute(action: {
  type: string;
  status: string;
  requiresApproval: boolean;
  approvedAt: Date | null;
}): { allowed: boolean; reason: string | null } {
  if (!isActionType(action.type)) {
    return { allowed: false, reason: `unknown action type: ${action.type}` };
  }
  if (!isActionStatus(action.status)) {
    return { allowed: false, reason: `unknown action status: ${action.status}` };
  }
  if (action.status !== "approved" && action.status !== "failed") {
    return { allowed: false, reason: `action is ${action.status}, not approved` };
  }
  if ((action.requiresApproval || hasExternalEffect(action.type)) && action.approvedAt === null) {
    return { allowed: false, reason: "action has not been approved by the user" };
  }
  return { allowed: true, reason: null };
}
