import { describe, expect, it } from "vitest";

import { ConnectionRevokedError, RateLimitError } from "@/lib/errors";
import { GmailProvider, type GmailApi } from "@/server/providers/gmail/provider";
import {
  backoffDelayMs,
  classifyGmailError,
  GmailApiError,
  withGmailRetry,
} from "@/server/providers/gmail/retry";

/**
 * Gmail integration tests against a mocked API.
 *
 * These cover the paths the fixture provider cannot reach — pagination, the
 * history delta, rate limiting, and revoked grants — which is most of what can
 * actually go wrong in production. Nothing here talks to Google; the provider
 * takes its API client as a constructor argument precisely so this is possible.
 */

// --- Test doubles ----------------------------------------------------------

/** Builds a Gaxios-shaped error, which is what googleapis throws. */
function googleError(
  status: number,
  reason?: string,
  extra: { retryAfter?: string; message?: string } = {},
): Error {
  const error = new Error(extra.message ?? `Request failed with status ${status}`) as Error & {
    status: number;
    response: { status: number; headers: Record<string, string>; data: unknown };
  };
  error.status = status;
  error.response = {
    status,
    headers: extra.retryAfter ? { "retry-after": extra.retryAfter } : {},
    data: { error: { code: status, errors: reason ? [{ reason }] : [] } },
  };
  return error;
}

function message(id: string, subject = `Subject ${id}`) {
  return {
    id,
    threadId: `t-${id}`,
    internalDate: String(Date.UTC(2026, 1, 10)),
    snippet: subject,
    labelIds: ["INBOX"],
    payload: {
      headers: [
        { name: "From", value: "Alex Rivera <alex@example.com>" },
        { name: "To", value: "you@example.com" },
        { name: "Subject", value: subject },
      ],
      mimeType: "text/plain",
      body: { data: Buffer.from(`Body of ${id}`, "utf8").toString("base64url") },
    },
  };
}

interface FakeOptions {
  pages?: { ids: string[]; nextPageToken?: string }[];
  history?: {
    added?: { id: string; labelIds?: string[] }[];
    historyId?: string;
    nextPageToken?: string;
  }[];
  profileHistoryId?: string;
  /** Errors to throw before succeeding, keyed by operation. */
  failures?: Partial<Record<"list" | "get" | "profile" | "history", Error[]>>;
  /** Message ids whose `get` always fails with this error. */
  brokenMessages?: Record<string, Error>;
}

class FakeGmail implements GmailApi {
  readonly calls = { list: 0, get: 0, profile: 0, history: 0 };
  readonly listedTokens: (string | undefined)[] = [];
  readonly historyTokens: (string | undefined)[] = [];
  readonly fetchedIds: string[] = [];
  readonly queries: (string | undefined)[] = [];
  private readonly pending: Record<string, Error[]>;

  constructor(private readonly options: FakeOptions = {}) {
    this.pending = {
      list: [...(options.failures?.list ?? [])],
      get: [...(options.failures?.get ?? [])],
      profile: [...(options.failures?.profile ?? [])],
      history: [...(options.failures?.history ?? [])],
    };
  }

  private maybeFail(operation: string): void {
    const next = this.pending[operation]?.shift();
    if (next) throw next;
  }

  users = {
    getProfile: async (_params: { userId: string }) => {
      this.calls.profile += 1;
      this.maybeFail("profile");
      return {
        data: {
          emailAddress: "user@example.com",
          historyId: this.options.profileHistoryId ?? "9000",
        },
      };
    },

    messages: {
      list: async (params: { userId: string; q?: string; pageToken?: string }) => {
        this.calls.list += 1;
        this.listedTokens.push(params.pageToken);
        this.queries.push(params.q);
        this.maybeFail("list");
        const pages = this.options.pages ?? [];
        const index = params.pageToken ? Number(params.pageToken) : 0;
        const page = pages[index];
        if (!page) return { data: {} };
        return {
          data: {
            messages: page.ids.map((id) => ({ id, threadId: `t-${id}` })),
            ...(page.nextPageToken ? { nextPageToken: page.nextPageToken } : {}),
          },
        };
      },

      get: async (params: { userId: string; id: string }) => {
        this.calls.get += 1;
        this.fetchedIds.push(params.id);
        const broken = this.options.brokenMessages?.[params.id];
        if (broken) throw broken;
        this.maybeFail("get");
        return { data: message(params.id) };
      },
    },

    history: {
      list: async (params: { startHistoryId: string; pageToken?: string }) => {
        this.calls.history += 1;
        this.historyTokens.push(params.pageToken);
        this.maybeFail("history");
        const pages = this.options.history ?? [];
        const index = params.pageToken ? Number(params.pageToken) : 0;
        const page = pages[index];
        if (!page) return { data: { historyId: params.startHistoryId } };
        return {
          data: {
            history: [
              {
                id: "h1",
                messagesAdded: (page.added ?? []).map((entry) => ({
                  message: {
                    id: entry.id,
                    threadId: `t-${entry.id}`,
                    labelIds: entry.labelIds ?? ["INBOX"],
                  },
                })),
              },
            ],
            historyId: page.historyId ?? "9100",
            ...(page.nextPageToken ? { nextPageToken: page.nextPageToken } : {}),
          },
        };
      },
    },
  };
}

/** No real waiting, but records what the backoff asked for. */
function fakeSleep() {
  const waits: number[] = [];
  return {
    waits,
    sleep: async (ms: number) => {
      waits.push(ms);
    },
  };
}

const NO_WAIT = { sleep: async () => {}, random: () => 0.5 };

// --- Error classification --------------------------------------------------

describe("classifyGmailError", () => {
  it("treats 429 as a rate limit", () => {
    expect(classifyGmailError(googleError(429)).kind).toBe("rate_limit");
  });

  it("separates a throttling 403 from a permissions 403", () => {
    expect(classifyGmailError(googleError(403, "userRateLimitExceeded")).kind).toBe("rate_limit");
    expect(classifyGmailError(googleError(403, "insufficientPermissions")).kind).toBe("revoked");
  });

  it("reads a withdrawn grant out of an invalid_grant refresh failure", () => {
    const error = new Error("invalid_grant: Token has been expired or revoked.");
    expect(classifyGmailError(error).kind).toBe("revoked");
  });

  it("treats 401 as revoked and 5xx as transient", () => {
    expect(classifyGmailError(googleError(401)).kind).toBe("revoked");
    expect(classifyGmailError(googleError(503)).kind).toBe("transient");
  });

  it("treats a dropped connection as transient", () => {
    const error = Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
    expect(classifyGmailError(error).kind).toBe("transient");
  });

  it("does not retry a 400", () => {
    expect(classifyGmailError(googleError(400)).kind).toBe("permanent");
  });

  it("reads Retry-After in seconds", () => {
    expect(classifyGmailError(googleError(429, undefined, { retryAfter: "7" })).retryAfterMs).toBe(
      7000,
    );
  });
});

describe("backoff", () => {
  const failure = { kind: "rate_limit" as const, status: 429, reason: null, retryAfterMs: null, message: "" };

  it("grows exponentially and stays under the cap", () => {
    const options = { baseDelayMs: 500, maxDelayMs: 8000, random: () => 1 };
    expect(backoffDelayMs(1, failure, options)).toBe(500);
    expect(backoffDelayMs(2, failure, options)).toBe(1000);
    expect(backoffDelayMs(3, failure, options)).toBe(2000);
    expect(backoffDelayMs(9, failure, options)).toBe(8000);
  });

  it("jitters below the nominal delay so retries do not resynchronize", () => {
    const options = { baseDelayMs: 1000, random: () => 0 };
    expect(backoffDelayMs(1, failure, options)).toBe(500);
  });

  it("obeys Retry-After when the server sends one, still capped", () => {
    const withHeader = { ...failure, retryAfterMs: 3000 };
    expect(backoffDelayMs(1, withHeader, { maxDelayMs: 8000 })).toBe(3000);
    expect(backoffDelayMs(1, { ...failure, retryAfterMs: 999_999 }, { maxDelayMs: 8000 })).toBe(8000);
  });
});

describe("withGmailRetry", () => {
  it("retries a transient failure and returns the eventual success", async () => {
    const { waits, sleep } = fakeSleep();
    let attempts = 0;
    const result = await withGmailRetry(
      "test",
      async () => {
        attempts += 1;
        if (attempts < 3) throw googleError(503);
        return "ok";
      },
      { sleep, random: () => 1, baseDelayMs: 100 },
    );

    expect(result).toBe("ok");
    expect(attempts).toBe(3);
    expect(waits).toEqual([100, 200]);
  });

  it("gives up on a rate limit with a typed error rather than a raw one", async () => {
    await expect(
      withGmailRetry("test", async () => { throw googleError(429); }, { ...NO_WAIT, attempts: 2 }),
    ).rejects.toBeInstanceOf(RateLimitError);
  });

  it("does not retry a revoked grant — waiting cannot fix it", async () => {
    let attempts = 0;
    await expect(
      withGmailRetry(
        "test",
        async () => {
          attempts += 1;
          throw googleError(401);
        },
        NO_WAIT,
      ),
    ).rejects.toBeInstanceOf(ConnectionRevokedError);
    expect(attempts).toBe(1);
  });

  it("does not retry a permanent failure", async () => {
    let attempts = 0;
    await expect(
      withGmailRetry(
        "test",
        async () => {
          attempts += 1;
          throw googleError(400);
        },
        NO_WAIT,
      ),
    ).rejects.toBeInstanceOf(GmailApiError);
    expect(attempts).toBe(1);
  });
});

// --- Pagination ------------------------------------------------------------

describe("GmailProvider pagination", () => {
  it("walks every page and hydrates each message", async () => {
    const gmail = new FakeGmail({
      pages: [
        { ids: ["a1", "a2"], nextPageToken: "1" },
        { ids: ["b1", "b2"], nextPageToken: "2" },
        { ids: ["c1"] },
      ],
    });
    const result = await new GmailProvider(gmail, NO_WAIT).fetchMessages({ limit: 100 });

    expect(result.messages.map((m) => m.externalId)).toEqual(["a1", "a2", "b1", "b2", "c1"]);
    expect(gmail.listedTokens).toEqual([undefined, "1", "2"]);
    expect(result.full).toBe(true);
  });

  it("stops at the limit instead of draining the mailbox", async () => {
    const gmail = new FakeGmail({
      pages: [
        { ids: ["a1", "a2"], nextPageToken: "1" },
        { ids: ["b1", "b2"], nextPageToken: "2" },
      ],
    });
    const result = await new GmailProvider(gmail, NO_WAIT).fetchMessages({ limit: 3 });

    expect(result.messages).toHaveLength(3);
    expect(gmail.calls.list).toBe(2);
  });

  it("terminates on an empty page that still hands back a token", async () => {
    // Gmail does this, and a loop that only checks the token spins forever.
    const gmail = new FakeGmail({
      pages: [
        { ids: ["a1"], nextPageToken: "1" },
        { ids: [], nextPageToken: "1" },
      ],
    });
    const result = await new GmailProvider(gmail, NO_WAIT).fetchMessages({ limit: 100 });

    expect(result.messages.map((m) => m.externalId)).toEqual(["a1"]);
    expect(gmail.calls.list).toBe(2);
  });

  it("scopes the query and honours `since`", async () => {
    const gmail = new FakeGmail({ pages: [{ ids: ["a1"] }] });
    await new GmailProvider(gmail, NO_WAIT).fetchMessages({
      since: new Date("2026-02-01T00:00:00Z"),
      limit: 10,
    });

    const query = gmail.queries[0]!;
    expect(query).toContain("-in:spam");
    expect(query).toContain("-category:promotions");
    expect(query).toContain(`after:${Math.floor(Date.parse("2026-02-01T00:00:00Z") / 1000)}`);
  });

  it("reads the history watermark before listing, not after", async () => {
    // Taking it afterwards would skip anything that arrived mid-sync.
    const gmail = new FakeGmail({ pages: [{ ids: ["a1"] }], profileHistoryId: "4242" });
    const result = await new GmailProvider(gmail, NO_WAIT).fetchMessages({ limit: 10 });

    expect(result.cursor).toBe("4242");
    expect(gmail.calls.profile).toBe(1);
  });
});

// --- Incremental sync ------------------------------------------------------

describe("GmailProvider incremental sync", () => {
  it("asks for a delta when it has a cursor, and never lists the mailbox", async () => {
    const gmail = new FakeGmail({
      history: [{ added: [{ id: "n1" }, { id: "n2" }], historyId: "9100" }],
    });
    const result = await new GmailProvider(gmail, NO_WAIT).fetchMessages({ cursor: "9000" });

    expect(result.messages.map((m) => m.externalId)).toEqual(["n1", "n2"]);
    expect(result.cursor).toBe("9100");
    expect(result.full).toBe(false);
    expect(gmail.calls.list).toBe(0);
  });

  it("pages through history and de-duplicates repeated ids", async () => {
    const gmail = new FakeGmail({
      history: [
        { added: [{ id: "n1" }, { id: "n2" }], nextPageToken: "1" },
        { added: [{ id: "n2" }, { id: "n3" }], historyId: "9200" },
      ],
    });
    const result = await new GmailProvider(gmail, NO_WAIT).fetchMessages({ cursor: "9000" });

    expect(result.messages.map((m) => m.externalId)).toEqual(["n1", "n2", "n3"]);
    expect(gmail.historyTokens).toEqual([undefined, "1"]);
  });

  it("drops spam and drafts the delta reports", async () => {
    const gmail = new FakeGmail({
      history: [
        {
          added: [
            { id: "keep" },
            { id: "junk", labelIds: ["SPAM"] },
            { id: "unsent", labelIds: ["DRAFT"] },
          ],
        },
      ],
    });
    const result = await new GmailProvider(gmail, NO_WAIT).fetchMessages({ cursor: "9000" });

    expect(result.messages.map((m) => m.externalId)).toEqual(["keep"]);
  });

  it("advances the cursor even when nothing changed", async () => {
    const gmail = new FakeGmail({ history: [] });
    const result = await new GmailProvider(gmail, NO_WAIT).fetchMessages({ cursor: "9000" });

    expect(result.messages).toEqual([]);
    expect(result.cursor).toBe("9000");
    expect(gmail.calls.get).toBe(0);
  });

  it("falls back to a full sync when the cursor has aged out", async () => {
    // Gmail answers 404 for a startHistoryId it no longer retains.
    const gmail = new FakeGmail({
      failures: { history: [googleError(404, "notFound")] },
      pages: [{ ids: ["a1"] }],
      profileHistoryId: "9999",
    });
    const result = await new GmailProvider(gmail, NO_WAIT).fetchMessages({ cursor: "1" });

    expect(result.full).toBe(true);
    expect(result.messages.map((m) => m.externalId)).toEqual(["a1"]);
    expect(result.cursor).toBe("9999");
  });

  it("does not silently fall back when history is merely rate-limited", async () => {
    // Falling back here would turn a momentary throttle into a full re-read.
    const gmail = new FakeGmail({
      failures: { history: [googleError(429), googleError(429), googleError(429), googleError(429)] },
      pages: [{ ids: ["a1"] }],
    });

    await expect(
      new GmailProvider(gmail, NO_WAIT).fetchMessages({ cursor: "9000" }),
    ).rejects.toBeInstanceOf(RateLimitError);
    expect(gmail.calls.list).toBe(0);
  });
});

// --- Error handling during hydration ---------------------------------------

describe("GmailProvider error handling", () => {
  it("retries a rate-limited message instead of dropping it", async () => {
    const gmail = new FakeGmail({
      pages: [{ ids: ["a1", "a2"] }],
      failures: { get: [googleError(429, undefined, { retryAfter: "1" })] },
    });
    const result = await new GmailProvider(gmail, NO_WAIT).fetchMessages({ limit: 10 });

    expect(result.messages.map((m) => m.externalId)).toEqual(["a1", "a2"]);
    expect(gmail.calls.get).toBe(3); // one throttled attempt, then both messages
  });

  it("skips a message that no longer exists", async () => {
    const gmail = new FakeGmail({
      pages: [{ ids: ["a1", "gone", "a2"] }],
      brokenMessages: { gone: googleError(404, "notFound") },
    });
    const result = await new GmailProvider(gmail, NO_WAIT).fetchMessages({ limit: 10 });

    expect(result.messages.map((m) => m.externalId)).toEqual(["a1", "a2"]);
  });

  it("fails the sync rather than returning a partial window as complete", async () => {
    // Returning early here while advancing the cursor would lose mail silently.
    const gmail = new FakeGmail({
      pages: [{ ids: ["a1", "a2", "a3"] }],
      brokenMessages: { a2: googleError(429) },
    });

    await expect(
      new GmailProvider(gmail, NO_WAIT).fetchMessages({ limit: 10 }),
    ).rejects.toBeInstanceOf(RateLimitError);
  });

  it("surfaces a revoked grant as something the user must act on", async () => {
    const gmail = new FakeGmail({ failures: { profile: [googleError(401)] } });

    await expect(
      new GmailProvider(gmail, NO_WAIT).fetchMessages({ limit: 10 }),
    ).rejects.toBeInstanceOf(ConnectionRevokedError);
  });

  it("still syncs when the watermark is unreadable, and says the cursor is unknown", async () => {
    const gmail = new FakeGmail({
      failures: { profile: [googleError(400)] },
      pages: [{ ids: ["a1"] }],
    });
    const result = await new GmailProvider(gmail, NO_WAIT).fetchMessages({ limit: 10 });

    expect(result.messages).toHaveLength(1);
    expect(result.cursor).toBeNull();
  });

  it("identifies the connected mailbox", async () => {
    const gmail = new FakeGmail();
    expect(await new GmailProvider(gmail, NO_WAIT).describe()).toEqual({
      accountId: "user@example.com",
      email: "user@example.com",
    });
  });
});
