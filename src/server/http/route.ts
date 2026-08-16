import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  AppError,
  isAppError,
  publicMessage,
  ValidationError,
  type ErrorCode,
} from "@/lib/errors";
import { logger, type Logger } from "@/lib/logger";
import { getSessionUserId } from "@/lib/session";
import { UnauthorizedError } from "@/lib/errors";

/**
 * The shared shape of every JSON API response.
 *
 * Having one envelope means clients have exactly one thing to branch on, and
 * every error carries a requestId that ties the user's report to a log line.
 */
export type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ErrorCode; message: string; requestId: string; issues?: unknown } };

export const REQUEST_ID_HEADER = "x-request-id";

export interface RouteContext {
  readonly request: NextRequest;
  readonly requestId: string;
  readonly log: Logger;
  /** Route params, already awaited. */
  readonly params: Record<string, string>;
  /** Throws UnauthorizedError when there is no session. */
  requireUserId(): Promise<string>;
  /** Parses and validates the JSON body, throwing ValidationError on failure. */
  body<T>(schema: z.ZodType<T>): Promise<T>;
}

export function jsonOk<T>(data: T, requestId: string, status = 200): NextResponse {
  return NextResponse.json<ApiResponse<T>>(
    { ok: true, data },
    { status, headers: { [REQUEST_ID_HEADER]: requestId } },
  );
}

function jsonError(error: unknown, requestId: string): NextResponse {
  const status = isAppError(error) ? error.status : 500;
  const code: ErrorCode = isAppError(error) ? error.code : "internal_error";
  const payload: ApiResponse<never> = {
    ok: false,
    error: {
      code,
      message: publicMessage(error),
      requestId,
      ...(error instanceof ValidationError && error.issues.length > 0
        ? { issues: error.issues }
        : {}),
    },
  };
  return NextResponse.json(payload, {
    status,
    headers: { [REQUEST_ID_HEADER]: requestId },
  });
}

type Handler<T> = (context: RouteContext) => Promise<T> | T;

/**
 * Wraps a route handler with request ids, structured logging, and error
 * translation.
 *
 * Handlers throw typed errors and return plain data; they never build a
 * NextResponse or decide a status code. That keeps the error contract in one
 * place instead of re-implemented, slightly differently, in every route.
 */
export function route<T>(name: string, handler: Handler<T>) {
  return async (
    request: NextRequest,
    routeParams?: { params: Promise<Record<string, string>> },
  ): Promise<NextResponse> => {
    const requestId = request.headers.get(REQUEST_ID_HEADER) ?? randomUUID();
    const log = logger(`api.${name}`).child({ requestId });
    const startedAt = Date.now();
    const params = routeParams?.params ? await routeParams.params : {};

    const context: RouteContext = {
      request,
      requestId,
      log,
      params,
      async requireUserId() {
        const userId = await getSessionUserId();
        if (!userId) throw new UnauthorizedError();
        return userId;
      },
      async body<B>(schema: z.ZodType<B>): Promise<B> {
        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          throw new ValidationError("Request body must be valid JSON.");
        }
        const parsed = schema.safeParse(raw);
        if (!parsed.success) {
          throw new ValidationError(
            "The request body did not match the expected shape.",
            parsed.error.issues.map((issue) => ({
              path: issue.path.join(".") || "(root)",
              message: issue.message,
            })),
          );
        }
        return parsed.data;
      },
    };

    try {
      const data = await handler(context);
      log.info("request ok", { method: request.method, durationMs: Date.now() - startedAt });
      return jsonOk(data, requestId);
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      if (isAppError(error) && error.status < 500) {
        // Expected outcomes (not signed in, not found, bad input) are not bugs.
        log.warn("request rejected", {
          method: request.method,
          durationMs,
          status: error.status,
          code: error.code,
          reason: error.message,
        });
      } else {
        log.exception("request failed", error, { method: request.method, durationMs });
      }
      return jsonError(error, requestId);
    }
  };
}

export { AppError };
