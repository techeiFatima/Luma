import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUserId } from "@/lib/session";
import { isLoopStatus } from "@/server/loops/taxonomy";

/**
 * Updates a loop's status. This is a Luma-local change only — it never touches
 * the user's mailbox. Actions with outside effects are out of scope for the MVP
 * and would require explicit per-action approval.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { status?: unknown };

  if (typeof body.status !== "string" || !isLoopStatus(body.status)) {
    return NextResponse.json({ error: "Unknown status" }, { status: 400 });
  }

  const loop = await prisma.openLoop.findFirst({ where: { id, userId }, select: { id: true } });
  if (!loop) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const resolved = body.status === "done" || body.status === "dismissed";
  const updated = await prisma.openLoop.update({
    where: { id: loop.id },
    data: {
      status: body.status,
      resolvedAt: resolved ? new Date() : null,
    },
  });

  return NextResponse.json({ ok: true, status: updated.status });
}
