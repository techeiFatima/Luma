import { describe, expect, it } from "vitest";
import {
  canExecute,
  canTransition,
  hasExternalEffect,
  isActionStatus,
  isActionType,
  isTerminal,
} from "@/server/domain/actions";
import {
  buildNotificationDedupeKey,
  canTransition as canNotify,
  isNotificationChannel,
} from "@/server/domain/notifications";

describe("action state machine", () => {
  it("validates the vocabulary backing the string columns", () => {
    expect(isActionType("draft_email")).toBe(true);
    expect(isActionType("delete_everything")).toBe(false);
    expect(isActionStatus("approved")).toBe(true);
    expect(isActionStatus("maybe")).toBe(false);
  });

  it("allows only the legal transitions", () => {
    expect(canTransition("proposed", "approved")).toBe(true);
    expect(canTransition("approved", "executing")).toBe(true);
    expect(canTransition("executing", "executed")).toBe(true);
    expect(canTransition("failed", "executing")).toBe(true);

    // Skipping approval is the transition that must never be possible.
    expect(canTransition("proposed", "executing")).toBe(false);
    expect(canTransition("proposed", "executed")).toBe(false);
    expect(canTransition("rejected", "approved")).toBe(false);
  });

  it("treats executed, rejected, and cancelled as terminal", () => {
    expect(isTerminal("executed")).toBe(true);
    expect(isTerminal("rejected")).toBe(true);
    expect(isTerminal("cancelled")).toBe(true);
    expect(isTerminal("proposed")).toBe(false);
    for (const status of ["executed", "rejected", "cancelled"] as const) {
      expect(canTransition(status, "executing")).toBe(false);
    }
  });

  it("knows which actions escape the app", () => {
    expect(hasExternalEffect("draft_email")).toBe(true);
    expect(hasExternalEffect("create_calendar_event")).toBe(true);
    expect(hasExternalEffect("create_reminder")).toBe(false);
  });
});

describe("canExecute", () => {
  const approved = {
    type: "draft_email",
    status: "approved",
    requiresApproval: true,
    approvedAt: new Date(),
  };

  it("allows an approved action", () => {
    expect(canExecute(approved).allowed).toBe(true);
  });

  it("refuses an action that has not been approved", () => {
    expect(canExecute({ ...approved, status: "proposed" }).allowed).toBe(false);
    expect(canExecute({ ...approved, approvedAt: null }).allowed).toBe(false);
  });

  it("still requires approval for external actions if the flag is wrong", () => {
    // A bug that flips requiresApproval must not become a bug that sends email.
    const result = canExecute({
      type: "draft_email",
      status: "approved",
      requiresApproval: false,
      approvedAt: null,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("approved");
  });

  it("allows a retry of a failed action that was approved", () => {
    expect(canExecute({ ...approved, status: "failed" }).allowed).toBe(true);
  });

  it("refuses unknown types and statuses rather than guessing", () => {
    expect(canExecute({ ...approved, type: "wire_money" }).allowed).toBe(false);
    expect(canExecute({ ...approved, status: "yolo" }).allowed).toBe(false);
  });
});

describe("notification dedupe keys", () => {
  it("is stable for the same loop, trigger, and channel", () => {
    const input = { loopId: "loop_1", trigger: "due_soon", channel: "email" } as const;
    expect(buildNotificationDedupeKey(input)).toBe(buildNotificationDedupeKey(input));
  });

  it("separates different triggers so escalation still notifies", () => {
    const base = { loopId: "loop_1", channel: "email" } as const;
    expect(buildNotificationDedupeKey({ ...base, trigger: "due_soon" })).not.toBe(
      buildNotificationDedupeKey({ ...base, trigger: "overdue" }),
    );
  });

  it("separates channels and loops", () => {
    const base = { loopId: "loop_1", trigger: "due_soon" } as const;
    expect(buildNotificationDedupeKey({ ...base, channel: "email" })).not.toBe(
      buildNotificationDedupeKey({ ...base, channel: "push" }),
    );
    expect(
      buildNotificationDedupeKey({ loopId: "loop_2", trigger: "due_soon", channel: "email" }),
    ).not.toBe(buildNotificationDedupeKey({ ...base, channel: "email" }));
  });

  it("separates recurring notifications by window", () => {
    const base = { loopId: null, trigger: "digest", channel: "email" } as const;
    expect(buildNotificationDedupeKey({ ...base, window: "2026-03-01" })).not.toBe(
      buildNotificationDedupeKey({ ...base, window: "2026-03-02" }),
    );
  });

  it("validates channels", () => {
    expect(isNotificationChannel("email")).toBe(true);
    expect(isNotificationChannel("carrier_pigeon")).toBe(false);
  });

  it("allows only the legal delivery transitions", () => {
    expect(canNotify("pending", "sent")).toBe(true);
    expect(canNotify("sent", "read")).toBe(true);
    expect(canNotify("failed", "pending")).toBe(true);
    // A sent notification cannot be un-sent.
    expect(canNotify("sent", "pending")).toBe(false);
    expect(canNotify("read", "sent")).toBe(false);
  });
});
