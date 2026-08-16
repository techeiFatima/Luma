import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The consent request itself.
 *
 * The full OAuth round trip needs Google, but the half we control is worth
 * pinning down: which scopes we ask for, and whether the request is shaped so a
 * refresh token actually comes back. Both are easy to break silently — a
 * missing `prompt` yields no refresh token on re-consent, and scope creep is
 * invisible until someone reads the consent screen.
 */

let buildConsentUrl: typeof import("@/server/providers/gmail/oauth").buildConsentUrl;
let GOOGLE_SCOPES: typeof import("@/config").GOOGLE_SCOPES;

const ORIGINAL = { ...process.env };

beforeAll(async () => {
  Object.assign(process.env, {
    GOOGLE_CLIENT_ID: "test-client-id.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "test-client-secret",
    APP_URL: "https://luma.test",
  });
  const config = await import("@/config");
  config.resetConfigCache();
  GOOGLE_SCOPES = config.GOOGLE_SCOPES;
  ({ buildConsentUrl } = await import("@/server/providers/gmail/oauth"));
});

afterAll(async () => {
  for (const key of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "APP_URL"]) {
    if (ORIGINAL[key] === undefined) delete process.env[key];
    else process.env[key] = ORIGINAL[key];
  }
  (await import("@/config")).resetConfigCache();
});

describe("consent URL", () => {
  it("asks only for read access and an account label", async () => {
    // Anything beyond this would let Luma modify mail, which it never does.
    expect([...GOOGLE_SCOPES]).toEqual([
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/userinfo.email",
      "openid",
    ]);

    const url = new URL(buildConsentUrl("state-123"));
    const requested = (url.searchParams.get("scope") ?? "").split(" ");
    expect(requested).toEqual([...GOOGLE_SCOPES]);
    expect(requested.some((scope) => /\.modify|\.send|\.compose|mail\.google\.com/.test(scope))).toBe(
      false,
    );
  });

  it("requests offline access with forced consent, so a refresh token arrives", async () => {
    const url = new URL(buildConsentUrl("state-123"));
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("client_id")).toBe("test-client-id.apps.googleusercontent.com");
  });

  it("carries the CSRF state through to Google", async () => {
    const url = new URL(buildConsentUrl("state-abc"));
    expect(url.searchParams.get("state")).toBe("state-abc");
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
  });

  it("never puts the client secret in the URL", async () => {
    expect(buildConsentUrl("state-123")).not.toContain("test-client-secret");
  });
});
