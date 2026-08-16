import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getConfig } from "@/config";
import { randomToken } from "@/lib/crypto";
import { isAppError, publicMessage } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { buildConsentUrl } from "@/server/providers/gmail/oauth";

export const OAUTH_STATE_COOKIE = "luma_oauth_state";

const log = logger("api.auth.google");

/**
 * Starts the Google consent flow.
 *
 * This is a browser redirect rather than a JSON API, so it does not use the
 * shared `route()` envelope — a user who lands here needs a page, not a JSON
 * error body. Failures redirect home with an error code the dashboard can show.
 */
export async function GET() {
  const config = getConfig();
  try {
    // A random state value, echoed back by Google and compared in the
    // callback, is what stops a third party from initiating the flow.
    const state = randomToken(24);
    const store = await cookies();
    store.set(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: "lax",
      secure: config.isProduction,
      path: "/",
      maxAge: 600,
    });
    return NextResponse.redirect(buildConsentUrl(state));
  } catch (error) {
    if (isAppError(error)) {
      log.warn("cannot start google oauth", { code: error.code, reason: error.message });
      return NextResponse.redirect(
        `${config.appUrl}/?error=${encodeURIComponent(publicMessage(error))}`,
      );
    }
    log.exception("google oauth start failed", error);
    return NextResponse.redirect(`${config.appUrl}/?error=oauth_unavailable`);
  }
}
