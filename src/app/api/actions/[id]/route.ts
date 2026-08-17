import { z } from "zod";
import { route } from "@/server/http/route";
import { decideAction } from "@/server/domain/execute";

const bodySchema = z.object({
  decision: z.enum(["approve", "reject"]),
});

/**
 * The approval gate, as an endpoint.
 *
 * There is deliberately no way to execute an action without a decision
 * attached — no `/execute` route exists — so "run this" and "the user said
 * yes" cannot come apart. `decideAction` re-checks permission against the
 * stored row rather than trusting anything in this request.
 */
export const POST = route("actions.decide", async ({ requireUserId, params, body }) => {
  const userId = await requireUserId();
  const { decision } = await body(bodySchema);
  return decideAction(userId, params.id!, decision);
});
