import { prisma } from "@/lib/db";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { draftReply } from "../ai/draft";
import { buildNotificationDedupeKey } from "./notifications";
import { canExecute, canTransition, isActionStatus, type ActionStatus } from "./actions";

const log = logger("actions.execute");

/**
 * Running an approved action.
 *
 * Every path into here passes through `canExecute`, which is the single place
 * that decides whether something is allowed to happen. That gate checks the
 * approval *timestamp*, not just the status — a bug that flipped a status must
 * not become a bug that acts on the user's behalf.
 *
 * The executors themselves are deliberately small and, in this MVP, incapable
 * of reaching outside Luma. A reminder writes a notification. A draft writes
 * text the user has to read and send themselves. Nothing here holds a
 * credential that could send mail, because the OAuth scopes Luma requests do
 * not permit sending at all — the safety property is enforced by what was
 * never granted, not only by what this code chooses to do.
 */

export interface ExecutionResult {
  id: string;
  status: ActionStatus;
  result: string | null;
  error: string | null;
}

async function fail(actionId: string, message: string): Promise<ExecutionResult> {
  const updated = await prisma.action.update({
    where: { id: actionId },
    data: { status: "failed", failedAt: new Date(), error: message.slice(0, 1000) },
  });
  log.warn("action failed", { actionId, reason: message });
  return { id: updated.id, status: "failed", result: null, error: updated.error ?? message };
}

/** Turns an approved reminder into a scheduled notification. */
async function executeReminder(action: {
  id: string;
  userId: string;
  loopId: string | null;
  payload: string;
}): Promise<string> {
  const payload = JSON.parse(action.payload) as { remindAt?: string };
  const remindAt = payload.remindAt ? new Date(payload.remindAt) : null;
  if (!remindAt || Number.isNaN(remindAt.getTime())) {
    throw new Error("reminder has no valid time");
  }

  const loop = action.loopId
    ? await prisma.openLoop.findFirst({
        where: { id: action.loopId, userId: action.userId },
        select: { title: true, summary: true },
      })
    : null;

  const dedupeKey = buildNotificationDedupeKey({
    loopId: action.loopId,
    trigger: "due_soon",
    channel: "in_app",
    window: `reminder:${action.id}`,
  });

  await prisma.notification.create({
    data: {
      userId: action.userId,
      loopId: action.loopId,
      channel: "in_app",
      status: "pending",
      title: loop ? `Reminder: ${loop.title}` : "Reminder",
      body: loop?.summary ?? "You asked to be reminded about this.",
      scheduledFor: remindAt,
      dedupeKey,
    },
  });

  return JSON.stringify({ scheduledFor: remindAt.toISOString() });
}

/**
 * Writes a reply for the user to review.
 *
 * The draft is stored, never sent. This is the one executor that calls the
 * model, because composing prose is a language task — unlike scheduling a
 * reminder, which is arithmetic.
 */
async function executeDraft(action: {
  id: string;
  userId: string;
  loopId: string | null;
  payload: string;
}): Promise<string> {
  if (!action.loopId) throw new Error("draft action has no loop to reply to");

  const loop = await prisma.openLoop.findFirst({
    where: { id: action.loopId, userId: action.userId },
    include: {
      evidence: {
        include: { sourceItem: { select: { subject: true, fromName: true, bodyText: true } } },
        take: 3,
      },
    },
  });
  if (!loop) throw new Error("loop not found");

  const payload = JSON.parse(action.payload) as { to?: string; toName?: string };
  const source = loop.evidence[0]?.sourceItem ?? null;

  const draft = await draftReply({
    userId: action.userId,
    loopTitle: loop.title,
    loopSummary: loop.summary,
    recipientName: payload.toName ?? null,
    sourceSubject: source?.subject ?? null,
    sourceFrom: source?.fromName ?? null,
    sourceBody: source?.bodyText ?? null,
  });

  return JSON.stringify({
    to: payload.to ?? null,
    subject: draft.subject,
    body: draft.body,
    // Stated on the record the user reads, not only in the code comments.
    delivery: "not sent — copy it into your mail client when you are ready",
  });
}

/**
 * Executes one action after re-checking permission.
 *
 * Permission is re-evaluated here rather than trusted from the caller: the
 * approving request and the executing request are different moments, and only
 * the row in the database knows what actually happened in between.
 */
export async function executeAction(userId: string, actionId: string): Promise<ExecutionResult> {
  const action = await prisma.action.findFirst({ where: { id: actionId, userId } });
  if (!action) throw new NotFoundError("That action does not exist.");

  const verdict = canExecute(action);
  if (!verdict.allowed) {
    throw new ForbiddenError(`This action cannot run: ${verdict.reason}.`);
  }

  // Claim it, so two concurrent requests cannot both run the same action. The
  // guard on `status` is what makes this atomic rather than merely intended.
  const claimed = await prisma.action.updateMany({
    where: { id: action.id, userId, status: action.status },
    data: { status: "executing", attempts: { increment: 1 } },
  });
  if (claimed.count === 0) {
    throw new ForbiddenError("That action is already running.");
  }

  try {
    const result =
      action.type === "create_reminder"
        ? await executeReminder(action)
        : action.type === "draft_email"
          ? await executeDraft(action)
          : null;

    if (result === null) {
      return await fail(action.id, `no executor for action type ${action.type}`);
    }

    const updated = await prisma.action.update({
      where: { id: action.id },
      data: { status: "executed", executedAt: new Date(), result, error: null },
    });
    log.info("action executed", { actionId: action.id, type: action.type });
    return { id: updated.id, status: "executed", result: updated.result, error: null };
  } catch (error) {
    return await fail(action.id, error instanceof Error ? error.message : String(error));
  }
}

/**
 * Records the user's decision, then runs the action if they said yes.
 *
 * Approval and execution are one call because splitting them would mean an
 * approved-but-unexecuted state the user cannot see or resolve.
 */
export async function decideAction(
  userId: string,
  actionId: string,
  decision: "approve" | "reject",
): Promise<ExecutionResult> {
  const action = await prisma.action.findFirst({ where: { id: actionId, userId } });
  if (!action) throw new NotFoundError("That action does not exist.");

  if (!isActionStatus(action.status)) {
    throw new ForbiddenError("That action is in an unknown state.");
  }

  const target: ActionStatus = decision === "approve" ? "approved" : "rejected";
  if (!canTransition(action.status, target)) {
    throw new ForbiddenError(`An action that is ${action.status} cannot be ${target}.`);
  }

  if (decision === "reject") {
    const updated = await prisma.action.update({
      where: { id: action.id },
      data: { status: "rejected", rejectedAt: new Date() },
    });
    return { id: updated.id, status: "rejected", result: null, error: null };
  }

  // The timestamp is the evidence a human said yes; `canExecute` requires it.
  await prisma.action.update({
    where: { id: action.id },
    data: { status: "approved", approvedAt: new Date() },
  });

  return executeAction(userId, action.id);
}
