import { z } from "zod";
import { prisma } from "@/lib/db";
import { BadRequestError, NotFoundError } from "@/lib/errors";
import { route } from "@/server/http/route";
import { LOOP_STATUSES } from "@/server/loops/taxonomy";

const bodySchema = z.object({
  status: z.enum(LOOP_STATUSES),
  /**
   * Required when snoozing. An ISO timestamp rather than a duration keyword so
   * the client owns what "tomorrow" means — the server has no idea what
   * timezone the user is in, and a snooze that surfaces at 3am is a broken
   * promise.
   */
  snoozeUntil: z.string().datetime().optional(),
});

/**
 * Updates a loop's status. This is a Luma-local change only — it never touches
 * the user's mailbox. Actions with outside effects go through the Action table
 * and require explicit per-action approval.
 */
export const POST = route("loops.status", async ({ params, body, requireUserId }) => {
  const userId = await requireUserId();
  const { status, snoozeUntil } = await body(bodySchema);

  // Scoped by userId: an id alone is never enough to touch someone else's loop.
  const loop = await prisma.openLoop.findFirst({
    where: { id: params.id, userId },
    select: { id: true },
  });
  if (!loop) throw new NotFoundError("That open loop does not exist.");

  let snoozedUntil: Date | null = null;
  if (status === "snoozed") {
    if (!snoozeUntil) {
      throw new BadRequestError("Snoozing requires a time to bring it back.");
    }
    snoozedUntil = new Date(snoozeUntil);
    if (snoozedUntil.getTime() <= Date.now()) {
      throw new BadRequestError("Choose a time in the future to be reminded.");
    }
  }

  const resolved = status === "done" || status === "dismissed";
  const updated = await prisma.openLoop.update({
    where: { id: loop.id },
    data: {
      status,
      resolvedAt: resolved ? new Date() : null,
      snoozedUntil,
    },
  });

  return {
    id: updated.id,
    status: updated.status,
    snoozedUntil: updated.snoozedUntil,
  };
});
