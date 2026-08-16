/**
 * Typed application errors.
 *
 * Every error the API layer knows how to present carries its own status code
 * and a stable machine-readable `code`. Anything that is *not* an AppError is
 * treated as an unexpected bug: it is logged in full and reported to the client
 * as a generic 500, so an internal message can never leak out by accident.
 */

export type ErrorCode =
  | "bad_request"
  | "validation_failed"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "reauth_required"
  | "feature_unavailable"
  | "upstream_error"
  | "internal_error";

export abstract class AppError extends Error {
  abstract readonly code: ErrorCode;
  abstract readonly status: number;
  /** Safe to show a user. Subclasses must not put internals in `message`. */
  readonly expose: boolean = true;
  /** Extra structured context for logs — never serialized to the client. */
  readonly context: Record<string, unknown>;

  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message);
    this.name = new.target.name;
    this.context = context;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class BadRequestError extends AppError {
  readonly code = "bad_request" as const;
  readonly status = 400;
}

export class ValidationError extends AppError {
  readonly code = "validation_failed" as const;
  readonly status = 422;
  /** Field-level detail, safe to return: it describes the request, not us. */
  readonly issues: { path: string; message: string }[];

  constructor(message: string, issues: { path: string; message: string }[] = []) {
    super(message, { issues });
    this.issues = issues;
  }
}

export class UnauthorizedError extends AppError {
  readonly code = "unauthorized" as const;
  readonly status = 401;

  constructor(message = "Not signed in") {
    super(message);
  }
}

export class ForbiddenError extends AppError {
  readonly code = "forbidden" as const;
  readonly status = 403;
}

export class NotFoundError extends AppError {
  readonly code = "not_found" as const;
  readonly status = 404;

  constructor(message = "Not found") {
    super(message);
  }
}

export class ConflictError extends AppError {
  readonly code = "conflict" as const;
  readonly status = 409;
}

export class RateLimitError extends AppError {
  readonly code = "rate_limited" as const;
  readonly status = 429;
}

/**
 * The user's grant on a provider is gone — revoked in Google's account UI, a
 * refresh token that no longer works, or scopes narrowed below what we need.
 *
 * Deliberately distinct from `UnauthorizedError`: the Luma session is fine, so
 * bouncing the user to sign-in would be wrong. The only fix is reconnecting the
 * provider, which is what the message tells them to do.
 */
export class ConnectionRevokedError extends AppError {
  readonly code = "reauth_required" as const;
  readonly status = 409;

  constructor(
    readonly provider: string,
    message = "Access to your account was revoked. Reconnect it to keep syncing.",
    context: Record<string, unknown> = {},
  ) {
    super(message, { provider, ...context });
  }
}

/**
 * A feature is switched off or not configured — a missing API key, OAuth not
 * set up. 503 rather than 500: the request was fine, the capability is absent.
 */
export class ConfigError extends AppError {
  readonly code = "feature_unavailable" as const;
  readonly status = 503;
}

/** A third party (Google, Anthropic) failed. The detail stays in the logs. */
export class UpstreamError extends AppError {
  readonly code = "upstream_error" as const;
  readonly status = 502;
  override readonly expose = false;

  constructor(
    message: string,
    readonly provider: string,
    context: Record<string, unknown> = {},
  ) {
    super(message, { provider, ...context });
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** The client-facing message for an error, with internals stripped out. */
export function publicMessage(error: unknown): string {
  if (isAppError(error) && error.expose) return error.message;
  if (isAppError(error)) return DEFAULT_MESSAGES[error.code];
  return DEFAULT_MESSAGES.internal_error;
}

const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  bad_request: "The request could not be understood.",
  validation_failed: "The request was not valid.",
  unauthorized: "Not signed in.",
  forbidden: "You do not have access to this.",
  not_found: "Not found.",
  conflict: "That conflicts with the current state.",
  rate_limited: "Too many requests. Try again shortly.",
  reauth_required: "That account needs to be reconnected.",
  feature_unavailable: "That feature is not available on this instance.",
  upstream_error: "An upstream service failed. Try again shortly.",
  internal_error: "Something went wrong on our end.",
};

/** Normalizes any thrown value into something loggable. */
export function toLoggable(error: unknown): {
  message: string;
  name: string;
  stack?: string;
  context?: Record<string, unknown>;
} {
  if (isAppError(error)) {
    return {
      message: error.message,
      name: error.name,
      ...(error.stack ? { stack: error.stack } : {}),
      context: error.context,
    };
  }
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      ...(error.stack ? { stack: error.stack } : {}),
    };
  }
  return { message: String(error), name: "UnknownError" };
}
