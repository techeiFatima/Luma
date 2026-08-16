/**
 * Provider abstraction.
 *
 * Everything downstream of this file works on `NormalizedMessage`, never on a
 * Gmail API type. Adding Outlook, or swapping Gmail for a fixture provider in
 * tests, means implementing this interface and nothing else.
 */

export interface NormalizedMessage {
  /** Provider-native message id. Stable across syncs — the idempotency key. */
  externalId: string;
  threadExternalId: string | null;
  subject: string | null;
  fromName: string | null;
  fromEmail: string | null;
  toEmails: string[];
  sentAt: Date;
  snippet: string | null;
  /** Plain-text body. Providers are responsible for stripping HTML. */
  bodyText: string;
  /** Raw headers we need for prefiltering (lowercased keys). */
  headers: Record<string, string>;
  /** Provider labels, where the provider has them (Gmail: INBOX, SENT, ...). */
  labels: string[];
}

export interface FetchOptions {
  /** Only return messages newer than this. */
  since?: Date;
  /** Hard cap on messages returned in one sync. */
  limit?: number;
  /** Provider cursor from the previous sync, when incremental sync is possible. */
  cursor?: string | null;
}

export interface FetchResult {
  messages: NormalizedMessage[];
  /** Cursor to persist for the next incremental sync, if the provider has one. */
  cursor: string | null;
  /**
   * True when this was a complete re-read of the requested window rather than a
   * delta. Callers use it to decide whether `lastFullSyncAt` moved, so a stale
   * cursor that keeps forcing full syncs stays visible instead of looking
   * like a healthy incremental one.
   */
  full: boolean;
}

export interface MailProvider {
  readonly id: string;
  /** Human-readable identity of the connected account, e.g. the email address. */
  describe(): Promise<{ accountId: string; email: string }>;
  fetchMessages(options: FetchOptions): Promise<FetchResult>;
}
