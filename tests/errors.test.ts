import { describe, expect, it } from "vitest";
import {
  BadRequestError,
  ConfigError,
  ConflictError,
  ForbiddenError,
  isAppError,
  NotFoundError,
  publicMessage,
  RateLimitError,
  toLoggable,
  UnauthorizedError,
  UpstreamError,
  ValidationError,
} from "@/lib/errors";
import { redact } from "@/lib/logger";

describe("error taxonomy", () => {
  it("maps each error to its HTTP status and code", () => {
    const cases = [
      [new BadRequestError("bad"), 400, "bad_request"],
      [new UnauthorizedError(), 401, "unauthorized"],
      [new ForbiddenError("no"), 403, "forbidden"],
      [new NotFoundError(), 404, "not_found"],
      [new ConflictError("conflict"), 409, "conflict"],
      [new ValidationError("invalid"), 422, "validation_failed"],
      [new RateLimitError("slow down"), 429, "rate_limited"],
      [new UpstreamError("gmail exploded", "gmail"), 502, "upstream_error"],
      [new ConfigError("no key"), 503, "feature_unavailable"],
    ] as const;

    for (const [error, status, code] of cases) {
      expect(error.status).toBe(status);
      expect(error.code).toBe(code);
      expect(isAppError(error)).toBe(true);
    }
  });

  it("keeps upstream detail out of the client-facing message", () => {
    const error = new UpstreamError("connect ECONNREFUSED 10.0.0.5:443", "gmail");
    expect(publicMessage(error)).not.toContain("10.0.0.5");
    // ...but keeps it for the logs.
    expect(toLoggable(error).message).toContain("10.0.0.5");
    expect(toLoggable(error).context).toMatchObject({ provider: "gmail" });
  });

  it("never leaks an unexpected error's message", () => {
    const error = new Error("SQLITE_ERROR: no such column: users.secret_column");
    expect(isAppError(error)).toBe(false);
    expect(publicMessage(error)).toBe("Something went wrong on our end.");
  });

  it("exposes validation issues, because they describe the request", () => {
    const error = new ValidationError("bad body", [{ path: "status", message: "required" }]);
    expect(publicMessage(error)).toBe("bad body");
    expect(error.issues).toEqual([{ path: "status", message: "required" }]);
  });

  it("normalizes a non-Error throw", () => {
    expect(toLoggable("something odd")).toMatchObject({
      message: "something odd",
      name: "UnknownError",
    });
  });
});

describe("log redaction", () => {
  it("masks credential-shaped keys anywhere in the payload", () => {
    const output = redact({
      userId: "user_1",
      accessToken: "ya29.super-secret",
      nested: { refresh_token: "1//refresh", clientSecret: "shh", safe: "keep me" },
      list: [{ apiKey: "sk-ant-123" }],
    }) as Record<string, unknown>;

    const serialized = JSON.stringify(output);
    expect(serialized).not.toContain("ya29.super-secret");
    expect(serialized).not.toContain("1//refresh");
    expect(serialized).not.toContain("sk-ant-123");
    expect(serialized).not.toContain("shh");
    // Non-secret fields survive, or the logs would be useless.
    expect(serialized).toContain("user_1");
    expect(serialized).toContain("keep me");
  });

  it("leaves primitives alone and terminates on deep structures", () => {
    expect(redact("plain")).toBe("plain");
    expect(redact(42)).toBe(42);
    expect(redact(null)).toBeNull();

    let deep: Record<string, unknown> = { value: "bottom" };
    for (let i = 0; i < 12; i++) deep = { nested: deep };
    expect(() => JSON.stringify(redact(deep))).not.toThrow();
  });
});
