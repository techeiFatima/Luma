import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDatabase, uniqueEmail, uniqueKey, type TestDatabase } from "./helpers/db";

/**
 * The approval gate, against a real database.
 *
 * This is the highest-stakes code in the product: everything else can be wrong
 * and merely unhelpful, whereas an action that runs without consent is a
 * betrayal of the thing the user was promised. So these tests are written
 * adversarially — the question is not "does approval work" but "can execution
 * happen without it", tried several different ways.
 */

let database: TestDatabase;
let prisma: typeof import("@/lib/db").prisma;
let executeAction: typeof import("@/server/domain/execute").executeAction;
let decideAction: typeof import("@/server/domain/execute").decideAction;
let proposalsFor: typeof import("@/server/domain/propose").proposalsFor;

const NOW = new Date("2026-03-10T12:00:00Z");
const DAY = 86_400_000;

async function makeUser() {
  return prisma.user.create({ data: { email: uniqueEmail("act") } });
}

async function makeLoop(userId: string, overrides: Record<string, unknown> = {}) {
  return prisma.openLoop.create({
    data: {
      userId,
      title: "Reply to Priya about the contract",
      summary: "She asked for comments on sections 4 and 7.",
      category: "unanswered_email",
      confidence: 0.9,
      consequence: "medium",
      dedupeKey: uniqueKey("loop"),
      dueAt: new Date(NOW.getTime() + 3 * DAY),
      counterpartyName: "Priya Raman",
      counterpartyEmail: "priya@example.com",
      ...overrides,
    },
  });
}

async function makeAction(
  userId: string,
  loopId: string | null,
  overrides: Record<string, unknown> = {},
) {
  return prisma.action.create({
    data: {
      userId,
      loopId,
      type: "create_reminder",
      status: "proposed",
      summary: "Remind you the day before.",
      payload: JSON.stringify({ remindAt: new Date(NOW.getTime() + 2 * DAY).toISOString() }),
      requiresApproval: false,
      idempotencyKey: uniqueKey("action"),
      ...overrides,
    },
  });
}

beforeAll(async () => {
  database = setupTestDatabase("actions-execute");
  ({ prisma } = await import("@/lib/db"));
  ({ executeAction, decideAction } = await import("@/server/domain/execute"));
  ({ proposalsFor } = await import("@/server/domain/propose"));
}, 60_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.destroy();
});

beforeEach(async () => {
  await prisma.notification.deleteMany();
  await prisma.action.deleteMany();
  await prisma.openLoop.deleteMany();
  await prisma.user.deleteMany();
});

describe("nothing runs without consent", () => {
  it("refuses to execute an action that is merely proposed", async () => {
    const user = await makeUser();
    const action = await makeAction(user.id, null);

    await expect(executeAction(user.id, action.id)).rejects.toThrow(/not approved/i);
    expect(await prisma.notification.count()).toBe(0);
  });

  it("refuses to execute a rejected action", async () => {
    const user = await makeUser();
    const action = await makeAction(user.id, null, {
      status: "rejected",
      rejectedAt: new Date(),
    });

    await expect(executeAction(user.id, action.id)).rejects.toThrow();
  });

  it("refuses an external action whose status says approved but has no timestamp", async () => {
    // The exact shape a status-flipping bug would produce. The gate checks the
    // timestamp precisely so that a wrong status cannot become a wrong action.
    const user = await makeUser();
    const loop = await makeLoop(user.id);
    const action = await makeAction(user.id, loop.id, {
      type: "draft_email",
      requiresApproval: true,
      status: "approved",
      approvedAt: null,
    });

    await expect(executeAction(user.id, action.id)).rejects.toThrow(/not been approved/i);
  });

  it("refuses to run another user's action", async () => {
    const mine = await makeUser();
    const theirs = await makeUser();
    const action = await makeAction(theirs.id, null, {
      status: "approved",
      approvedAt: new Date(),
    });

    await expect(executeAction(mine.id, action.id)).rejects.toThrow(/does not exist/i);
    // And nothing was created on either side.
    expect(await prisma.notification.count()).toBe(0);
  });

  it("refuses to approve an action belonging to someone else", async () => {
    const mine = await makeUser();
    const theirs = await makeUser();
    const action = await makeAction(theirs.id, null);

    await expect(decideAction(mine.id, action.id, "approve")).rejects.toThrow(/does not exist/i);
    const untouched = await prisma.action.findUniqueOrThrow({ where: { id: action.id } });
    expect(untouched.status).toBe("proposed");
    expect(untouched.approvedAt).toBeNull();
  });
});

describe("approval runs the action exactly once", () => {
  it("approves, executes, and records the decision", async () => {
    const user = await makeUser();
    const loop = await makeLoop(user.id);
    const action = await makeAction(user.id, loop.id);

    const result = await decideAction(user.id, action.id, "approve");

    expect(result.status).toBe("executed");
    const stored = await prisma.action.findUniqueOrThrow({ where: { id: action.id } });
    expect(stored.approvedAt).not.toBeNull();
    expect(stored.executedAt).not.toBeNull();

    // The reminder became a scheduled notification and nothing else.
    const notifications = await prisma.notification.findMany();
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.title).toContain("Reply to Priya");
    expect(notifications[0]!.scheduledFor).not.toBeNull();
  });

  it("will not execute the same action twice", async () => {
    const user = await makeUser();
    const loop = await makeLoop(user.id);
    const action = await makeAction(user.id, loop.id);

    await decideAction(user.id, action.id, "approve");
    await expect(decideAction(user.id, action.id, "approve")).rejects.toThrow();
    expect(await prisma.notification.count()).toBe(1);
  });

  it("records a rejection without running anything", async () => {
    const user = await makeUser();
    const action = await makeAction(user.id, null);

    const result = await decideAction(user.id, action.id, "reject");

    expect(result.status).toBe("rejected");
    expect(await prisma.notification.count()).toBe(0);
    const stored = await prisma.action.findUniqueOrThrow({ where: { id: action.id } });
    expect(stored.rejectedAt).not.toBeNull();
    expect(stored.approvedAt).toBeNull();
  });

  it("survives a concurrent double approval without acting twice", async () => {
    const user = await makeUser();
    const loop = await makeLoop(user.id);
    const action = await makeAction(user.id, loop.id);

    const results = await Promise.allSettled([
      decideAction(user.id, action.id, "approve"),
      decideAction(user.id, action.id, "approve"),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.notification.count()).toBe(1);
  });
});

describe("what gets proposed", () => {
  it("offers a reminder when there is still time to be reminded", () => {
    const proposals = proposalsFor(
      {
        id: "l1",
        title: "Renew licence",
        category: "renewal",
        dueAt: new Date(NOW.getTime() + 5 * DAY),
        counterpartyName: null,
        counterpartyEmail: null,
        status: "open",
      },
      NOW,
    );
    expect(proposals.map((p) => p.type)).toEqual(["create_reminder"]);
  });

  it("does not offer a reminder for a deadline that is already here", () => {
    const proposals = proposalsFor(
      {
        id: "l2",
        title: "Renew licence",
        category: "renewal",
        dueAt: new Date(NOW.getTime() + 3600_000),
        counterpartyName: null,
        counterpartyEmail: null,
        status: "open",
      },
      NOW,
    );
    expect(proposals).toEqual([]);
  });

  it("offers a draft only when there is a person to reply to", () => {
    const base = {
      id: "l3",
      title: "Reply to Priya",
      category: "unanswered_email",
      dueAt: null,
      counterpartyName: "Priya",
      status: "open",
    };

    expect(proposalsFor({ ...base, counterpartyEmail: "priya@example.com" }, NOW).map((p) => p.type)).toEqual([
      "draft_email",
    ]);
    expect(proposalsFor({ ...base, counterpartyEmail: null }, NOW)).toEqual([]);
  });

  it("proposes nothing for a loop the user already closed", () => {
    const proposals = proposalsFor(
      {
        id: "l4",
        title: "Done already",
        category: "unanswered_email",
        dueAt: new Date(NOW.getTime() + 5 * DAY),
        counterpartyName: "Priya",
        counterpartyEmail: "priya@example.com",
        status: "done",
      },
      NOW,
    );
    expect(proposals).toEqual([]);
  });

  it("marks a draft as needing approval and a reminder as not", () => {
    // A reminder never leaves Luma; a draft is a message about to involve
    // someone else, so it carries the stricter flag.
    const proposals = proposalsFor(
      {
        id: "l5",
        title: "Reply to Priya",
        category: "follow_up",
        dueAt: new Date(NOW.getTime() + 5 * DAY),
        counterpartyName: "Priya",
        counterpartyEmail: "priya@example.com",
        status: "open",
      },
      NOW,
    );

    const byType = Object.fromEntries(proposals.map((p) => [p.type, p.requiresApproval]));
    expect(byType.create_reminder).toBe(false);
    expect(byType.draft_email).toBe(true);
  });
});
