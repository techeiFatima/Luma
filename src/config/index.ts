import { ConfigError } from "@/lib/errors";
import { envSchema, MIN_SECRET_LENGTH, SECRET_ENV_KEYS, type RawEnv } from "./schema";

/**
 * Typed application configuration.
 *
 * Loading is lazy and memoized rather than done at import time, for two
 * reasons: `next build` imports every module without a real environment, and
 * tests need to load a config with a specific environment. Call `getConfig()`.
 *
 * The rules are:
 *  - An *invalid* value is always fatal, in every environment. A malformed
 *    APP_URL is a bug wherever it happens.
 *  - A *missing* secret is fatal only in production. Development gets a fixed,
 *    obviously-fake fallback so `npm run dev` works with no setup, and
 *    production refuses to start rather than silently minting a weak key.
 */

export interface AppConfig {
  readonly env: RawEnv["NODE_ENV"];
  readonly isProduction: boolean;
  readonly isTest: boolean;
  readonly isDevelopment: boolean;

  readonly databaseUrl: string;
  readonly appUrl: string;
  readonly port: number;
  readonly logLevel: RawEnv["LOG_LEVEL"];

  readonly sessionSecret: string;
  readonly encryptionKey: string;

  readonly ai: {
    readonly enabled: boolean;
    readonly apiKey: string | undefined;
    readonly model: string;
    readonly effort: RawEnv["LUMA_EFFORT"];
  };

  readonly google: {
    readonly enabled: boolean;
    readonly clientId: string | undefined;
    readonly clientSecret: string | undefined;
    readonly redirectUri: string;
    /** Read-only. Luma cannot send, delete, or modify mail. */
    readonly scopes: readonly string[];
  };

  readonly demoMode: boolean;
}

/**
 * Every scope is read-only, and that is a product decision as much as a
 * security one. Luma's promise is that it notices things — nothing it does
 * requires the ability to change the user's mail or calendar, so asking for
 * that ability would be borrowing trust it has no use for. Writing anything
 * (a calendar event, a draft) is a separate, explicitly approved action and
 * would need its own incremental consent.
 */
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "openid",
] as const;

const DEV_SESSION_SECRET = "dev-only-session-secret-not-for-production";
const DEV_ENCRYPTION_KEY = "dev-only-encryption-key-not-for-production";

function formatIssues(issues: { path: PropertyKey[]; message: string }[]): string {
  return issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

export function buildConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    // Zod reports the offending key but never the value, so this is safe to log.
    throw new ConfigError(`Invalid environment configuration — ${formatIssues(parsed.error.issues)}`);
  }

  const raw = parsed.data;
  const isProduction = raw.NODE_ENV === "production";

  const problems: string[] = [];
  if (isProduction) {
    for (const key of ["SESSION_SECRET", "ENCRYPTION_KEY"] as const) {
      const value = raw[key];
      if (!value) problems.push(`${key} is required in production`);
      else if (value.length < MIN_SECRET_LENGTH) {
        problems.push(`${key} must be at least ${MIN_SECRET_LENGTH} characters`);
      }
    }
  }
  if (problems.length > 0) {
    throw new ConfigError(`Invalid environment configuration — ${problems.join("; ")}`);
  }

  const googleEnabled = Boolean(raw.GOOGLE_CLIENT_ID && raw.GOOGLE_CLIENT_SECRET);

  return {
    env: raw.NODE_ENV,
    isProduction,
    isTest: raw.NODE_ENV === "test",
    isDevelopment: raw.NODE_ENV === "development",

    databaseUrl: raw.DATABASE_URL,
    appUrl: raw.APP_URL.replace(/\/$/, ""),
    port: raw.PORT,
    logLevel: raw.LOG_LEVEL,

    sessionSecret: raw.SESSION_SECRET ?? DEV_SESSION_SECRET,
    encryptionKey: raw.ENCRYPTION_KEY ?? DEV_ENCRYPTION_KEY,

    ai: {
      enabled: Boolean(raw.ANTHROPIC_API_KEY),
      apiKey: raw.ANTHROPIC_API_KEY,
      model: raw.LUMA_MODEL,
      effort: raw.LUMA_EFFORT,
    },

    google: {
      enabled: googleEnabled,
      clientId: raw.GOOGLE_CLIENT_ID,
      clientSecret: raw.GOOGLE_CLIENT_SECRET,
      redirectUri: `${raw.APP_URL.replace(/\/$/, "")}/api/auth/google/callback`,
      scopes: GOOGLE_SCOPES,
    },

    // On by default in development and test; production must opt in.
    demoMode: raw.ENABLE_DEMO_MODE ?? !isProduction,
  };
}

let cached: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (!cached) cached = buildConfig();
  return cached;
}

/** Test-only: forces the next `getConfig()` to re-read the environment. */
export function resetConfigCache(): void {
  cached = null;
}

/**
 * Feature guards. These throw a typed error the API layer turns into a clean
 * 503, rather than letting a missing key surface as an opaque crash.
 */
export function requireAi(): { apiKey: string; model: string; effort: RawEnv["LUMA_EFFORT"] } {
  const { ai } = getConfig();
  if (!ai.apiKey) {
    throw new ConfigError(
      "ANTHROPIC_API_KEY is not set. AI extraction is unavailable — see .env.example.",
    );
  }
  return { apiKey: ai.apiKey, model: ai.model, effort: ai.effort };
}

export function requireGoogleOAuth(): {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
} {
  const { google } = getConfig();
  if (!google.clientId || !google.clientSecret) {
    throw new ConfigError(
      "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set. Gmail cannot be connected — see .env.example.",
    );
  }
  return {
    clientId: google.clientId,
    clientSecret: google.clientSecret,
    redirectUri: google.redirectUri,
  };
}

/**
 * A redacted view of configuration, safe to log or expose on a diagnostics
 * endpoint. Secrets are reported as present/absent, never by value.
 */
export function describeConfig(config: AppConfig = getConfig()) {
  return {
    env: config.env,
    appUrl: config.appUrl,
    logLevel: config.logLevel,
    features: {
      ai: config.ai.enabled,
      google: config.google.enabled,
      demoMode: config.demoMode,
    },
    model: config.ai.model,
    secretsConfigured: {
      SESSION_SECRET: config.sessionSecret !== DEV_SESSION_SECRET,
      ENCRYPTION_KEY: config.encryptionKey !== DEV_ENCRYPTION_KEY,
    },
  };
}

export { SECRET_ENV_KEYS };
export type { RawEnv };
