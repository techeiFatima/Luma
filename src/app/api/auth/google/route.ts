import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomToken } from "@/lib/crypto";
import { ConfigError } from "@/lib/env";
import { isProduction } from "@/lib/env";
import { buildConsentUrl } from "@/server/providers/gmail/oauth";

export const OAUTH_STATE_COOKIE = "luma_oauth_state";

/** Starts the Google consent flow. State is stored in a short-lived cookie to block CSRF. */
export async function GET() {
  try {
    const state = randomToken(24);
    const store = await cookies();
    store.set(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction,
      path: "/",
      maxAge: 600,
    });
    return NextResponse.redirect(buildConsentUrl(state));
  } catch (error) {
    if (error instanceof ConfigError) {
      return NextResponse.json({ error: error.message }, { status: 501 });
    }
    throw error;
  }
}
