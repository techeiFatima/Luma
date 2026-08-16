import { z } from "zod";
import { route } from "@/server/http/route";
import { disconnectAccount } from "@/server/providers/gmail/account";

const bodySchema = z.object({
  /** Also delete the mail Luma stored and any loop left without evidence. */
  purgeData: z.boolean().default(false),
});

/**
 * Disconnects a connected account: revokes the grant at Google and destroys the
 * stored tokens.
 *
 * POST rather than DELETE because the browser reaches it from a form, and the
 * account row survives — what is deleted is the credentials, not the record
 * that the account was once connected.
 */
export const POST = route(
  "accounts.disconnect",
  async ({ requireUserId, params, body, request }) => {
    const userId = await requireUserId();

    // A bodyless disconnect is the common case and means "keep my data".
    // Anything that does send a body still has to send a valid one.
    const hasBody = (request.headers.get("content-type") ?? "").includes("application/json");
    const { purgeData } = hasBody ? await body(bodySchema) : { purgeData: false };

    return disconnectAccount({ userId, accountId: params.id!, purgeData });
  },
);
