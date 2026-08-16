import { google, type gmail_v1 } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { logger } from "@/lib/logger";
import type { FetchOptions, FetchResult, MailProvider, NormalizedMessage } from "../types";
import { normalizeGmailMessage } from "./parse";
import {
  GmailApiError,
  isExpiredCursor,
  withGmailRetry,
  type RetryOptions,
} from "./retry";

const log = logger("gmail.provider");

const DEFAULT_LIMIT = 120;
/** Gmail page size; kept modest so a sync fails fast rather than hanging. */
const PAGE_SIZE = 50;
/**
 * A hard stop on pagination. Gmail can return a `nextPageToken` alongside an
 * empty page, and a loop that only ends when the token runs out will spin
 * forever on a mailbox that keeps handing one back.
 */
const MAX_PAGES = 40;

/** Labels whose messages are never open loops, so they are dropped on sight. */
const EXCLUDED_LABELS = new Set(["SPAM", "TRASH", "DRAFT", "CHAT"]);

/**
 * The slice of the Gmail API this provider actually uses.
 *
 * Declaring it explicitly, rather than depending on `gmail_v1.Gmail`, is what
 * makes the provider testable: a test supplies four functions instead of
 * mocking a generated client, and the surface we depend on stays visible.
 */
export interface GmailApi {
  users: {
    getProfile(params: { userId: string }): Promise<{ data: gmail_v1.Schema$Profile }>;
    messages: {
      list(params: {
        userId: string;
        q?: string;
        maxResults?: number;
        pageToken?: string;
      }): Promise<{ data: gmail_v1.Schema$ListMessagesResponse }>;
      get(params: {
        userId: string;
        id: string;
        format?: string;
      }): Promise<{ data: gmail_v1.Schema$Message }>;
    };
    history: {
      list(params: {
        userId: string;
        startHistoryId: string;
        historyTypes?: string[];
        maxResults?: number;
        pageToken?: string;
      }): Promise<{ data: gmail_v1.Schema$ListHistoryResponse }>;
    };
  };
}

export class GmailProvider implements MailProvider {
  readonly id = "gmail";

  constructor(
    private readonly gmail: GmailApi,
    private readonly retry: RetryOptions = {},
  ) {}

  /** The production entry point: a real client built from a user's credentials. */
  static forAuth(auth: OAuth2Client, retry: RetryOptions = {}): GmailProvider {
    return new GmailProvider(google.gmail({ version: "v1", auth }) as unknown as GmailApi, retry);
  }

  async describe(): Promise<{ accountId: string; email: string }> {
    const profile = await this.call("getProfile", () =>
      this.gmail.users.getProfile({ userId: "me" }),
    );
    const email = profile.data.emailAddress ?? "unknown";
    return { accountId: email, email };
  }

  private call<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    return withGmailRetry(operation, fn, this.retry);
  }

  /**
   * Gmail's `q` syntax does the first pass of filtering server-side. We exclude
   * the promotional and social categories outright: they are never open loops
   * and fetching them would be pure cost.
   */
  private buildQuery(since?: Date): string {
    const clauses = [
      "-in:chats",
      "-in:spam",
      "-in:trash",
      "-category:promotions",
      "-category:social",
    ];
    if (since) {
      clauses.push(`after:${Math.floor(since.getTime() / 1000)}`);
    }
    return clauses.join(" ");
  }

  /**
   * Prefers a delta over a re-read.
   *
   * With a cursor we ask Gmail only what changed. Without one — or when the
   * cursor has aged out, which Gmail allows after roughly a week — we fall back
   * to the dated query. The fallback is automatic because an expired cursor is
   * a routine event for anyone who does not open the app for a while, not an
   * error worth surfacing.
   */
  async fetchMessages(options: FetchOptions = {}): Promise<FetchResult> {
    const limit = options.limit ?? DEFAULT_LIMIT;

    if (options.cursor) {
      try {
        return await this.fetchIncremental(options.cursor, limit);
      } catch (error) {
        if (!isExpiredCursor(error)) throw error;
        log.info("history cursor expired, falling back to a full sync", {
          cursor: options.cursor,
        });
      }
    }

    return this.fetchFull(options.since, limit);
  }

  /** Everything added since `startHistoryId`. */
  private async fetchIncremental(startHistoryId: string, limit: number): Promise<FetchResult> {
    const ids: string[] = [];
    const seen = new Set<string>();
    let pageToken: string | undefined;
    let latestHistoryId: string | null = null;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const response = await this.call("history.list", () =>
        this.gmail.users.history.list({
          userId: "me",
          startHistoryId,
          historyTypes: ["messageAdded"],
          maxResults: PAGE_SIZE,
          ...(pageToken ? { pageToken } : {}),
        }),
      );

      latestHistoryId = response.data.historyId ?? latestHistoryId;

      for (const record of response.data.history ?? []) {
        for (const added of record.messagesAdded ?? []) {
          const message = added.message;
          if (!message?.id || seen.has(message.id)) continue;
          if ((message.labelIds ?? []).some((label) => EXCLUDED_LABELS.has(label))) continue;
          seen.add(message.id);
          ids.push(message.id);
        }
      }

      pageToken = response.data.nextPageToken ?? undefined;
      if (!pageToken || ids.length >= limit) break;
    }

    const selected = ids.slice(0, limit);
    log.info("history delta", { since: startHistoryId, changed: selected.length });

    return {
      messages: await this.hydrate(selected),
      // Falling back to the old cursor is deliberate: advancing past changes we
      // did not read would lose them permanently.
      cursor: latestHistoryId ?? startHistoryId,
      full: false,
    };
  }

  /** A bounded re-read of the recent window, used for first sync and recovery. */
  private async fetchFull(since: Date | undefined, limit: number): Promise<FetchResult> {
    // Read the watermark *before* listing. Anything that arrives mid-sync then
    // shows up in the next delta; taking it afterwards would skip those
    // messages entirely. Re-reading a few is free — ingestion is idempotent.
    let cursor: string | null = null;
    try {
      const profile = await this.call("getProfile", () =>
        this.gmail.users.getProfile({ userId: "me" }),
      );
      cursor = profile.data.historyId ?? null;
    } catch (error) {
      if (error instanceof GmailApiError) {
        log.warn("could not read historyId; next sync will be a full one", {
          status: error.failure.status,
        });
      } else {
        throw error;
      }
    }

    const query = this.buildQuery(since);
    const ids: string[] = [];
    let pageToken: string | undefined;

    for (let page = 0; page < MAX_PAGES && ids.length < limit; page += 1) {
      const response = await this.call("messages.list", () =>
        this.gmail.users.messages.list({
          userId: "me",
          q: query,
          maxResults: Math.min(PAGE_SIZE, limit - ids.length),
          ...(pageToken ? { pageToken } : {}),
        }),
      );

      const batch = response.data.messages ?? [];
      for (const message of batch) {
        if (message.id) ids.push(message.id);
      }

      pageToken = response.data.nextPageToken ?? undefined;
      // An empty page with a token would otherwise loop until MAX_PAGES.
      if (!pageToken || batch.length === 0) break;
    }

    // `maxResults` is a ceiling Gmail is free to interpret loosely, so the cap
    // is enforced here too. Hydration is the expensive half — overshooting it
    // costs real API calls.
    const selected = ids.slice(0, limit);
    log.info("listed messages", { count: selected.length, query });

    return { messages: await this.hydrate(selected), cursor, full: true };
  }

  /**
   * Fetches message bodies.
   *
   * A message that is genuinely gone (deleted between listing and reading) is
   * skipped. Anything else is rethrown, because returning a partial result while
   * advancing the cursor would drop mail on the floor and call the sync a
   * success. Failing loudly leaves the cursor untouched, so the next sync
   * simply picks the work back up.
   */
  private async hydrate(ids: string[]): Promise<NormalizedMessage[]> {
    const messages: NormalizedMessage[] = [];

    for (const id of ids) {
      try {
        const detail = await this.call("messages.get", () =>
          this.gmail.users.messages.get({ userId: "me", id, format: "full" }),
        );
        const normalized = normalizeGmailMessage(detail.data);
        if (normalized) messages.push(normalized);
      } catch (error) {
        if (error instanceof GmailApiError && error.failure.kind === "permanent") {
          log.warn("skipping unreadable message", { id, status: error.failure.status });
          continue;
        }
        throw error;
      }
    }

    return messages;
  }
}
