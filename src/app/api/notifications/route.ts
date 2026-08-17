import { z } from "zod";
import { route } from "@/server/http/route";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/server/domain/notify";

export const GET = route("notifications.list", async ({ requireUserId }) => {
  const userId = await requireUserId();
  return { notifications: await listNotifications(userId) };
});

const bodySchema = z.object({
  /** Omit to mark everything read. */
  id: z.string().min(1).optional(),
});

export const POST = route("notifications.read", async ({ requireUserId, body }) => {
  const userId = await requireUserId();
  const { id } = await body(bodySchema);

  // Scoped by userId inside both helpers — an id alone never reaches another
  // user's row, and a miss returns `false` rather than throwing, so probing
  // for valid ids reveals nothing.
  if (id) return { read: (await markNotificationRead(userId, id)) ? 1 : 0 };
  return { read: await markAllNotificationsRead(userId) };
});
