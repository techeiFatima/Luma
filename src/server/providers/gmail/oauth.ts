import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { GOOGLE_SCOPES, requireGoogleOAuth } from "@/config";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { ConnectionRevokedError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { classifyGmailError } from "./retry";

const log = logger("gmail.oauth");

export function createOAuthClient(): OAuth2Client {
  const { clientId, clientSecret, redirectUri } = requireGoogleOAuth();
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

/**
 * Builds the consent URL. `prompt: "consent"` is required to reliably receive a
 * refresh token; without it Google omits one on repeat authorizations.
 */
export function buildConsentUrl(state: string): string {
  return createOAuthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: false,
    scope: [...GOOGLE_SCOPES],
    state,
  });
}

export async function exchangeCodeForTokens(code: string) {
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.access_token) throw new Error("Google did not return an access token");

  client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const profile = await oauth2.userinfo.get();
  const email = profile.data.email;
  if (!email) throw new Error("Google did not return an account email");

  return {
    email,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? null,
    expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    scopes: tokens.scope ?? GOOGLE_SCOPES.join(" "),
  };
}

/**
 * Records that a grant is no longer usable, and destroys what is left of it.
 *
 * Called when Google tells us the grant is gone — the user revoked it in their
 * account settings, or the refresh token expired. Keeping the dead credentials
 * would serve no purpose, so they are cleared rather than merely flagged.
 */
export async function markAccountRevoked(accountId: string, reason: string): Promise<void> {
  await prisma.connectedAccount.updateMany({
    where: { id: accountId, revokedAt: null },
    data: { revokedAt: new Date(), accessToken: "", refreshToken: null, expiresAt: null },
  });
  await prisma.syncState.updateMany({
    where: { accountId },
    data: { lastError: `Access revoked: ${reason}`, cursor: null },
  });
  log.warn("account grant revoked", { accountId, reason });
}

/**
 * Returns an authorized client for a stored account, refreshing the access
 * token when it is expired or about to expire. Refreshed tokens are written
 * back (encrypted) so the next sync starts warm.
 *
 * A refresh that fails because the grant is gone is not an outage: the account
 * is marked revoked so the UI can ask for a reconnection instead of retrying a
 * credential that will never work again.
 */
export async function authorizedClientForAccount(accountId: string): Promise<OAuth2Client> {
  const account = await prisma.connectedAccount.findUnique({ where: { id: accountId } });
  if (!account) throw new Error(`Connected account ${accountId} not found`);
  if (account.revokedAt) {
    throw new ConnectionRevokedError("gmail", "This Gmail account is disconnected. Reconnect it to sync.");
  }

  const client = createOAuthClient();
  client.setCredentials({
    access_token: account.accessToken ? decryptSecret(account.accessToken) : undefined,
    refresh_token: account.refreshToken ? decryptSecret(account.refreshToken) : undefined,
    expiry_date: account.expiresAt?.getTime() ?? undefined,
  });

  const expiresSoon = !account.expiresAt || account.expiresAt.getTime() - Date.now() < 60_000;
  if (expiresSoon && account.refreshToken) {
    log.info("refreshing access token", { accountId });
    let credentials;
    try {
      ({ credentials } = await client.refreshAccessToken());
    } catch (error) {
      const failure = classifyGmailError(error);
      if (failure.kind === "revoked") {
        await markAccountRevoked(accountId, failure.reason ?? "refresh rejected");
        throw new ConnectionRevokedError("gmail");
      }
      throw error;
    }

    client.setCredentials(credentials);
    if (credentials.access_token) {
      await prisma.connectedAccount.update({
        where: { id: accountId },
        data: {
          accessToken: encryptSecret(credentials.access_token),
          expiresAt: credentials.expiry_date ? new Date(credentials.expiry_date) : null,
          ...(credentials.refresh_token
            ? { refreshToken: encryptSecret(credentials.refresh_token) }
            : {}),
        },
      });
    }
  } else if (expiresSoon && !account.refreshToken) {
    // Nothing left to refresh with; the only way forward is re-consent.
    await markAccountRevoked(accountId, "no refresh token");
    throw new ConnectionRevokedError("gmail");
  }

  return client;
}
