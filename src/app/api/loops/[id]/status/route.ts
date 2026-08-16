import { z } from "zod";
import { prisma } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { route } from "@/server/http/route";
import { LOOP_STATUSES } from "@/server/loops/taxonomy";

const bodySchema = z.object({
  status: z.enum(LOOP_STATUSES),
});

/**
 * Updates a loop's status. This is a Luma-local change only — it never touches
 * the user's mailbox. Actions with outside effects go through the Action table
 * and require explicit per-action approval.
 */
export const POST = route("loops.status", async ({ params, body, requireUserId }) => {
  const userId = await requireUserId();
  const { status } = await body(bodySchema);

  const id = params.id;
  const loop = await prisma.openLoop.findFirst({ where: { id, userId }, select: { id: true } });
  if (!loop) throw new NotFoundError("That open loop does not exist.");

  const resolved = status === "done" || status === "dismissed";
  const updated = await prisma.openLoop.update({
    where: { id: loop.id },
    data: { status, resolvedAt: resolved ? new Date() : null },
  });

  return { id: updated.id, status: updated.status };
});
