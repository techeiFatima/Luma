import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { encryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { getConfig } from "@/config";
import { logger } from "@/lib/logger";
import { setSessionCookie } from "@/lib/session";
import { exchangeCodeForTokens } from "@/server/providers/gmail/oauth";
import { OAUTH_STATE_COOKIE } from "../route";

const log = logger("auth.callback");

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) {
    return NextResponse.redirect(`${getConfig().appUrl}/?error=${encodeURIComponent(oauthError)}`);
  }

  const store = await cookies();
  const expectedState = store.get(OAUTH_STATE_COOKIE)?.value;
  if (!code || !state || !expectedState || state !== expectedState) {
    log.warn("rejected callback with bad state");
    return NextResponse.redirect(`${getConfig().appUrl}/?error=invalid_oauth_state`);
  }
  store.delete(OAUTH_STATE_COOKIE);

  try {
    const tokens = await exchangeCodeForTokens(code);

    const user = await prisma.user.upsert({
      where: { email: tokens.email },
      create: { email: tokens.email },
      update: {},
    });

    await prisma.connectedAccount.upsert({
      where: {
        userId_provider_providerAccountId: {
          userId: user.id,
          provider: "gmail",
          providerAccountId: tokens.email,
        },
      },
      create: {
        userId: user.id,
        provider: "gmail",
        providerAccountId: tokens.email,
        accessToken: encryptSecret(tokens.accessToken),
        refreshToken: tokens.refreshToken ? encryptSecret(tokens.refreshToken) : null,
        expiresAt: tokens.expiresAt,
        scopes: tokens.scopes,
      },
      update: {
        accessToken: encryptSecret(tokens.accessToken),
        // Google omits the refresh token on re-consent sometimes; keep the old one.
        ...(tokens.refreshToken ? { refreshToken: encryptSecret(tokens.refreshToken) } : {}),
        expiresAt: tokens.expiresAt,
        scopes: tokens.scopes,
        revokedAt: null,
      },
    });

    await setSessionCookie(user.id);
    log.info("connected gmail account", { userId: user.id });
    return NextResponse.redirect(`${getConfig().appUrl}/`);
  } catch (error) {
    log.error("oauth callback failed", { error: String(error) });
    return NextResponse.redirect(`${getConfig().appUrl}/?error=oauth_failed`);
  }
}
