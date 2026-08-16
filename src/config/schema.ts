import { z } from "zod";

/**
 * The schema for every environment variable the application reads.
 *
 * One schema, in one file, is the whole point: there is a single place to look
 * up what Luma can be configured with, what is required, and what the default
 * is. Nothing else in the codebase reads `process.env` directly.
 */

const nonEmpty = z.string().trim().min(1);

/** Treats "", unset, and whitespace as absent so a blank var doesn't look set. */
const optionalString = z
  .string()
  .trim()
  .transform((value) => (value.length === 0 ? undefined : value))
  .optional();

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((value) =>
    typeof value === "boolean" ? value : ["1", "true", "yes", "on"].includes(value.toLowerCase()),
  );

export const NODE_ENVS = ["development", "test", "production"] as const;
export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;

/**
 * Secrets shorter than this are rejected in production. 32 characters is what
 * `openssl rand -base64 32` produces, which is what the docs tell people to run.
 */
export const MIN_SECRET_LENGTH = 32;

export const envSchema = z.object({
  NODE_ENV: z.enum(NODE_ENVS).default("development"),

  // --- Core ---------------------------------------------------------------
  DATABASE_URL: nonEmpty.default("file:./prisma/luma.db"),
  APP_URL: z.url().default("http://localhost:3000"),
  PORT: z.coerce.number().int().positive().max(65_535).default(3000),
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),

  // --- Secrets (required in production, dev fallbacks otherwise) -----------
  SESSION_SECRET: optionalString,
  ENCRYPTION_KEY: optionalString,

  // --- AI extraction (feature-gated) --------------------------------------
  ANTHROPIC_API_KEY: optionalString,
  LUMA_MODEL: nonEmpty.default("claude-opus-5"),
  LUMA_EFFORT: z.enum(EFFORT_LEVELS).default("high"),

  // --- Google OAuth (feature-gated) ---------------------------------------
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,

  // --- Development affordances --------------------------------------------
  /**
   * Enables the sample-inbox route, which signs in a demo user without OAuth.
   * Left unset here so the config layer can default it to on outside
   * production and off inside it — it is an unauthenticated way to create a
   * session, so production has to opt in explicitly.
   */
  ENABLE_DEMO_MODE: booleanish.optional(),
});

export type RawEnv = z.infer<typeof envSchema>;

/** Env vars whose values must never reach a log line or an error message. */
export const SECRET_ENV_KEYS = [
  "SESSION_SECRET",
  "ENCRYPTION_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_CLIENT_SECRET",
  "DATABASE_URL",
] as const satisfies readonly (keyof RawEnv)[];
