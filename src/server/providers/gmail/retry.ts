/**
 * Failure classification and retry for the Gmail API.
 *
 * Google reports several genuinely different problems through similar-looking
 * HTTP errors, and treating them alike is how a sync ends up either hammering a
 * quota or silently dropping mail. So every failure is classified first, and the
 * classification — not the status code — decides what happens:
 *
 *   rate_limit  wait and retry; the request was fine, we were just too eager
 *   transient   wait and retry; Google or the network wobbled
 *   revoked     stop; no amount of retrying fixes a withdrawn grant
 *   permanent   stop; the caller decides whether to skip or fail
 *
 * Notably, a 403 can mean *either* "slow down" or "you no longer have this
 * scope", and the two need opposite responses. The `reason` field is what
 * separates them.
 */
import { ConnectionRevokedError, RateLimitError, UpstreamError } from "@/lib/errors";
import { logger } from "@/lib/logger";

const log = logger("gmail.retry");

export type GmailFailureKind = "rate_limit" | "transient" | "revoked" | "permanent";

export interface GmailFailure {
  kind: GmailFailureKind;
  /** HTTP status, when the failure had one. Null for network-level errors. */
  status: number | null;
  /** Google's machine-readable reason, e.g. `userRateLimitExceeded`. */
  reason: string | null;
  /** Server-requested wait from a `Retry-After` header, in milliseconds. */
  retryAfterMs: number | null;
  message: string;
}

/** 403 reasons that mean "too fast", not "not allowed". */
const RATE_LIMIT_REASONS = new Set([
  "ratelimitexceeded",
  "userratelimitexceeded",
  "quotaexceeded",
  "dailylimitexceeded",
]);

/** Reasons that mean the grant itself is gone or too narrow to use. */
const REVOKED_REASONS = new Set([
  "insufficientpermissions",
  "autherror",
  "accesstokenscopeinsufficient",
  "forbidden_scope",
]);

/** Substrings Google and google-auth-library use for a dead grant. */
const REVOKED_MARKERS = [
  "invalid_grant",
  "token has been expired or revoked",
  "invalid credentials",
  "no refresh token",
  "access_token_scope_insufficient",
];

/** Node network errors worth another attempt. */
const TRANSIENT_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "EAI_AGAIN",
  "ENOTFOUND",
  "EPIPE",
  "ERR_SOCKET_CONNECTION_TIMEOUT",
]);

function readStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const candidate = error as { status?: unknown; code?: unknown; response?: { status?: unknown } };
  for (const value of [candidate.status, candidate.response?.status, candidate.code]) {
    if (typeof value === "number" && value >= 100 && value < 600) return value;
    // Gaxios sometimes stringifies the status into `code`.
    if (typeof value === "string" && /^\d{3}$/.test(value)) return Number(value);
  }
  return null;
}

function readReason(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const candidate = error as {
    code?: unknown;
    errors?: { reason?: unknown }[];
    response?: { data?: { error?: unknown } };
  };

  const direct = candidate.errors?.[0]?.reason;
  if (typeof direct === "string") return direct.toLowerCase();

  const data = candidate.response?.data?.error;
  if (typeof data === "string") return data.toLowerCase();
  if (typeof data === "object" && data !== null) {
    const nested = data as { status?: unknown; errors?: { reason?: unknown }[] };
    const reason = nested.errors?.[0]?.reason;
    if (typeof reason === "string") return reason.toLowerCase();
    if (typeof nested.status === "string") return nested.status.toLowerCase();
  }
  // Network errors carry a symbolic code here rather than a numeric status.
  if (typeof candidate.code === "string" && !/^\d+$/.test(candidate.code)) {
    return candidate.code.toLowerCase();
  }
  return null;
}

function readRetryAfterMs(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const headers = (error as { response?: { headers?: unknown } }).response?.headers;
  if (typeof headers !== "object" || headers === null) return null;

  // Headers may be a plain object or a fetch Headers instance.
  const raw =
    typeof (headers as Headers).get === "function"
      ? (headers as Headers).get("retry-after")
      : ((headers as Record<string, unknown>)["retry-after"] ??
        (headers as Record<string, unknown>)["Retry-After"]);

  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

  const at = new Date(String(raw)).getTime();
  return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
}

export function classifyGmailError(error: unknown): GmailFailure {
  const status = readStatus(error);
  const reason = readReason(error);
  const message = error instanceof Error ? error.message : String(error);
  const haystack = `${message} ${reason ?? ""}`.toLowerCase();
  const retryAfterMs = readRetryAfterMs(error);

  const base = { status, reason, retryAfterMs, message };

  if (REVOKED_MARKERS.some((marker) => haystack.includes(marker))) {
    return { ...base, kind: "revoked" };
  }
  if (status === 401) return { ...base, kind: "revoked" };
  if (status === 429) return { ...base, kind: "rate_limit" };
  if (status === 403) {
    if (reason && RATE_LIMIT_REASONS.has(reason)) return { ...base, kind: "rate_limit" };
    if (reason && REVOKED_REASONS.has(reason)) return { ...base, kind: "revoked" };
    // An unlabelled 403 from Gmail is overwhelmingly a quota problem, and
    // waiting is the cheaper mistake: a retry costs seconds, whereas wrongly
    // declaring the account revoked pushes the user through consent again.
    return { ...base, kind: "rate_limit" };
  }
  if (status !== null && status >= 500) return { ...base, kind: "transient" };
  if (status === null && reason && TRANSIENT_CODES.has(reason.toUpperCase())) {
    return { ...base, kind: "transient" };
  }
  if (status === null && /socket hang up|network|timeout/i.test(message)) {
    return { ...base, kind: "transient" };
  }
  return { ...base, kind: "permanent" };
}

/** A Gmail failure that survived retries. Carries the classification for callers. */
export class GmailApiError extends UpstreamError {
  constructor(
    readonly failure: GmailFailure,
    readonly operation: string,
  ) {
    super(`Gmail ${operation} failed: ${failure.message}`, "gmail", {
      operation,
      status: failure.status,
      reason: failure.reason,
      kind: failure.kind,
    });
  }
}

export interface RetryOptions {
  /** Total attempts, including the first. */
  attempts?: number;
  /** Delay before the first retry; doubles thereafter. */
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Injectable so tests do not actually wait. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable so backoff is deterministic under test. */
  random?: () => number;
}

const DEFAULTS = {
  attempts: 4,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  random: Math.random,
};

export function backoffDelayMs(
  attempt: number,
  failure: GmailFailure,
  options: RetryOptions = {},
): number {
  const base = options.baseDelayMs ?? DEFAULTS.baseDelayMs;
  const max = options.maxDelayMs ?? DEFAULTS.maxDelayMs;
  const random = options.random ?? DEFAULTS.random;

  // A server-supplied Retry-After is an instruction, not a suggestion — but it
  // is still capped, so a hostile or mistaken header cannot stall a sync.
  if (failure.retryAfterMs !== null) return Math.min(failure.retryAfterMs, max);

  const exponential = Math.min(base * 2 ** (attempt - 1), max);
  // Full jitter: without it, every parallel request retries in lockstep and
  // recreates the burst that triggered the limit.
  return Math.round(exponential * (0.5 + random() * 0.5));
}

/**
 * Runs a Gmail call, retrying the failures that are worth retrying.
 *
 * Throws a typed error when it gives up: `ConnectionRevokedError` when the user
 * must reconnect, `RateLimitError` when we exhausted retries against a quota,
 * and `GmailApiError` (carrying the classification) otherwise.
 */
export async function withGmailRetry<T>(
  operation: string,
  call: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? DEFAULTS.attempts;
  const sleep = options.sleep ?? DEFAULTS.sleep;

  let lastFailure: GmailFailure | null = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await call();
    } catch (error) {
      const failure = classifyGmailError(error);
      lastFailure = failure;

      if (failure.kind === "revoked") {
        throw new ConnectionRevokedError("gmail", undefined, {
          operation,
          reason: failure.reason,
        });
      }
      if (failure.kind === "permanent" || attempt === attempts) break;

      const delay = backoffDelayMs(attempt, failure, options);
      log.warn("retrying gmail call", {
        operation,
        attempt,
        of: attempts,
        kind: failure.kind,
        status: failure.status,
        delayMs: delay,
      });
      await sleep(delay);
    }
  }

  const failure = lastFailure ?? {
    kind: "permanent" as const,
    status: null,
    reason: null,
    retryAfterMs: null,
    message: "unknown failure",
  };

  if (failure.kind === "rate_limit") {
    throw new RateLimitError(
      "Gmail is rate-limiting this account. Luma will pick up where it left off shortly.",
      { operation, status: failure.status, reason: failure.reason },
    );
  }
  throw new GmailApiError(failure, operation);
}

/** True when Gmail rejected a `startHistoryId` as too old to serve. */
export function isExpiredCursor(error: unknown): boolean {
  return error instanceof GmailApiError && error.failure.status === 404;
}
