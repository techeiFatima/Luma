import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { googleScopes, requireGoogleOAuth } from "@/lib/env";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

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
    scope: [...googleScopes.gmail],
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
    scopes: tokens.scope ?? googleScopes.gmail.join(" "),
  };
}

/**
 * Returns an authorized client for a stored account, refreshing the access
 * token when it is expired or about to expire. Refreshed tokens are written
 * back (encrypted) so the next sync starts warm.
 */
export async function authorizedClientForAccount(accountId: string): Promise<OAuth2Client> {
  const account = await prisma.connectedAccount.findUnique({ where: { id: accountId } });
  if (!account) throw new Error(`Connected account ${accountId} not found`);
  if (account.revokedAt) throw new Error(`Connected account ${accountId} has been revoked`);

  const client = createOAuthClient();
  client.setCredentials({
    access_token: decryptSecret(account.accessToken),
    refresh_token: account.refreshToken ? decryptSecret(account.refreshToken) : undefined,
    expiry_date: account.expiresAt?.getTime() ?? undefined,
  });

  const expiresSoon = !account.expiresAt || account.expiresAt.getTime() - Date.now() < 60_000;
  if (expiresSoon && account.refreshToken) {
    log.info("refreshing access token", { accountId });
    const { credentials } = await client.refreshAccessToken();
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
  }

  return client;
}
