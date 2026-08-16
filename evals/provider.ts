import type { FetchOptions, FetchResult, MailProvider } from "@/server/providers/types";
import { EVAL_EMAILS } from "./dataset";
import { EVAL_TODAY, type EvalEmail } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Serves the evaluation dataset through the normal provider interface.
 *
 * Using the real interface matters: the emails go through the same prefilter,
 * ingestion, batching, and persistence a Gmail message would. An evaluation
 * that bypassed those stages would measure the prompt, not the product.
 *
 * `externalId` is the eval email id, so predicted loops can be traced back to
 * the email they came from through the normal evidence chain.
 */
export class EvalMailProvider implements MailProvider {
  readonly id = "fixtures";

  constructor(
    private readonly emails: EvalEmail[] = EVAL_EMAILS,
    private readonly now: Date = EVAL_TODAY,
  ) {}

  async describe(): Promise<{ accountId: string; email: string }> {
    return { accountId: "eval@example.com", email: "eval@example.com" };
  }

  async fetchMessages(_options: FetchOptions = {}): Promise<FetchResult> {
    return {
      messages: this.emails.map((email) => ({
        externalId: email.id,
        threadExternalId: email.threadId ?? email.id,
        subject: email.subject,
        fromName: email.fromName,
        fromEmail: email.fromEmail,
        toEmails: ["you@example.com"],
        sentAt: new Date(this.now.getTime() - email.daysAgo * DAY_MS),
        snippet: email.body.slice(0, 120).replace(/\s+/g, " ").trim(),
        bodyText: email.body,
        headers: { from: `${email.fromName} <${email.fromEmail}>`, ...(email.headers ?? {}) },
        labels: email.labels ?? ["INBOX"],
      })),
      cursor: null,
    };
  }
}
