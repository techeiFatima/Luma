/**
 * Environment configuration.
 *
 * Nothing here throws at import time — a missing Google client id should stop
 * you from *connecting Gmail*, not from starting the app. Each feature asserts
 * what it needs at the point of use via the `require*` helpers.
 */

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

export const env = {
  databaseUrl: optional("DATABASE_URL") ?? "file:./prisma/luma.db",
  appUrl: optional("APP_URL") ?? "http://localhost:3000",
  nodeEnv: process.env.NODE_ENV ?? "development",

  anthropicApiKey: optional("ANTHROPIC_API_KEY"),
  /** Overridable so the model is swappable without a code change. */
  anthropicModel: optional("LUMA_MODEL") ?? "claude-opus-5",

  googleClientId: optional("GOOGLE_CLIENT_ID"),
  googleClientSecret: optional("GOOGLE_CLIENT_SECRET"),

  sessionSecret: optional("SESSION_SECRET"),
  encryptionKey: optional("ENCRYPTION_KEY"),
} as const;

export const isProduction = env.nodeEnv === "production";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function requireAnthropic(): { apiKey: string; model: string } {
  if (!env.anthropicApiKey) {
    throw new ConfigError(
      "ANTHROPIC_API_KEY is not set. Extraction cannot run without it — see .env.example.",
    );
  }
  return { apiKey: env.anthropicApiKey, model: env.anthropicModel };
}

export function requireGoogleOAuth(): { clientId: string; clientSecret: string; redirectUri: string } {
  if (!env.googleClientId || !env.googleClientSecret) {
    throw new ConfigError(
      "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set. Gmail cannot be connected — see .env.example.",
    );
  }
  return {
    clientId: env.googleClientId,
    clientSecret: env.googleClientSecret,
    redirectUri: `${env.appUrl}/api/auth/google/callback`,
  };
}

/**
 * Development fallbacks are deliberately fixed strings so a forgotten env var
 * fails loudly in production instead of silently minting weak keys.
 */
export function requireSessionSecret(): string {
  if (env.sessionSecret) return env.sessionSecret;
  if (isProduction) {
    throw new ConfigError("SESSION_SECRET must be set in production.");
  }
  return "luma-dev-session-secret-do-not-use-in-production";
}

export function requireEncryptionKey(): string {
  if (env.encryptionKey) return env.encryptionKey;
  if (isProduction) {
    throw new ConfigError("ENCRYPTION_KEY must be set in production.");
  }
  return "luma-dev-encryption-key-do-not-use-in-production";
}

export const googleScopes = {
  /**
   * Read-only for the MVP. Luma never sends, deletes, or modifies mail.
   * Widening this list is a product decision, not an implementation detail.
   */
  gmail: [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/userinfo.email",
    "openid",
  ],
} as const;
