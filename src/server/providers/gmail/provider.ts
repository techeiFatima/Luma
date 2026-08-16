import { google, type gmail_v1 } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { logger } from "@/lib/logger";
import type { FetchOptions, FetchResult, MailProvider, NormalizedMessage } from "../types";
import { normalizeGmailMessage } from "./parse";

const log = logger("gmail.provider");

const DEFAULT_LIMIT = 120;
/** Gmail page size; kept modest so a sync fails fast rather than hanging. */
const PAGE_SIZE = 50;

export class GmailProvider implements MailProvider {
  readonly id = "gmail";
  private readonly gmail: gmail_v1.Gmail;

  constructor(auth: OAuth2Client) {
    this.gmail = google.gmail({ version: "v1", auth });
  }

  async describe(): Promise<{ accountId: string; email: string }> {
    const profile = await this.gmail.users.getProfile({ userId: "me" });
    const email = profile.data.emailAddress ?? "unknown";
    return { accountId: email, email };
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

  async fetchMessages(options: FetchOptions = {}): Promise<FetchResult> {
    const limit = options.limit ?? DEFAULT_LIMIT;
    const query = this.buildQuery(options.since);

    const ids: string[] = [];
    let pageToken: string | undefined;
    while (ids.length < limit) {
      const page: gmail_v1.Schema$ListMessagesResponse = (
        await this.gmail.users.messages.list({
          userId: "me",
          q: query,
          maxResults: Math.min(PAGE_SIZE, limit - ids.length),
          pageToken,
        })
      ).data;

      for (const message of page.messages ?? []) {
        if (message.id) ids.push(message.id);
      }
      pageToken = page.nextPageToken ?? undefined;
      if (!pageToken) break;
    }

    log.info("listed messages", { count: ids.length, query });

    const messages: NormalizedMessage[] = [];
    for (const id of ids) {
      try {
        const detail = await this.gmail.users.messages.get({
          userId: "me",
          id,
          format: "full",
        });
        const normalized = normalizeGmailMessage(detail.data);
        if (normalized) messages.push(normalized);
      } catch (error) {
        // One unreadable message must not abort the whole sync.
        log.warn("failed to fetch message", { id, error: String(error) });
      }
    }

    // Gmail's historyId gives us a cursor for future incremental syncs.
    let cursor: string | null = null;
    try {
      const profile = await this.gmail.users.getProfile({ userId: "me" });
      cursor = profile.data.historyId ?? null;
    } catch (error) {
      log.warn("could not read historyId", { error: String(error) });
    }

    return { messages, cursor };
  }
}
