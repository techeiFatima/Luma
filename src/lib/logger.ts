import { LOG_LEVELS } from "@/config/schema";
import { toLoggable } from "./errors";

type Level = (typeof LOG_LEVELS)[number];

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Structured JSON logging.
 *
 * Read lazily from the environment rather than from `getConfig()` so that
 * logging never depends on configuration loading successfully — a config
 * failure is precisely the moment you need logs to work.
 */
function threshold(): number {
  const configured = process.env.LOG_LEVEL as Level | undefined;
  return configured && configured in ORDER ? ORDER[configured] : ORDER.info;
}

export type LogFields = Record<string, unknown>;

/** Keys whose values are replaced with "[redacted]" wherever they appear. */
const REDACTED_KEYS = new Set([
  "password",
  "token",
  "accesstoken",
  "refreshtoken",
  "authorization",
  "authorization_token",
  "authorizationtoken",
  "apikey",
  "api_key",
  "secret",
  "sessionsecret",
  "encryptionkey",
  "clientsecret",
  "client_secret",
  "cookie",
]);

/**
 * Walks a field object and masks anything that looks like a credential.
 *
 * A logger is the easiest place in a codebase to leak a token by accident —
 * someone logs a whole request object once and it is in the log forever. This
 * makes the safe thing automatic rather than a rule people have to remember.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]";
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    output[key] = REDACTED_KEYS.has(key.toLowerCase().replace(/[-_]/g, ""))
      ? "[redacted]"
      : redact(item, depth + 1);
  }
  return output;
}

function emit(level: Level, scope: string, message: string, fields?: LogFields) {
  if (ORDER[level] < threshold()) return;
  const line = {
    level,
    scope,
    message,
    ...(fields ? (redact(fields) as LogFields) : {}),
    at: new Date().toISOString(),
  };
  const text = JSON.stringify(line);
  if (level === "error") console.error(text);
  else if (level === "warn") console.warn(text);
  else console.log(text);
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** Logs a thrown value with its stack and structured context. */
  exception(message: string, error: unknown, fields?: LogFields): void;
  /** Returns a logger that attaches `fields` to every line — e.g. a requestId. */
  child(fields: LogFields): Logger;
}

export function logger(scope: string, base: LogFields = {}): Logger {
  const merge = (fields?: LogFields) => ({ ...base, ...fields });
  return {
    debug: (message, fields) => emit("debug", scope, message, merge(fields)),
    info: (message, fields) => emit("info", scope, message, merge(fields)),
    warn: (message, fields) => emit("warn", scope, message, merge(fields)),
    error: (message, fields) => emit("error", scope, message, merge(fields)),
    exception: (message, error, fields) =>
      emit("error", scope, message, merge({ ...fields, error: toLoggable(error) })),
    child: (fields) => logger(scope, { ...base, ...fields }),
  };
}
