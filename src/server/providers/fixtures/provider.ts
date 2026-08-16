import type { FetchOptions, FetchResult, MailProvider } from "../types";
import { fixtureMessages } from "./emails";

/**
 * A provider backed by a static sample inbox.
 *
 * This is what makes the pipeline runnable end-to-end without Google
 * credentials — `npm run demo` uses it — and it is the provider the tests use
 * so extraction behaviour can be checked against known inputs.
 */
export class FixtureMailProvider implements MailProvider {
  readonly id = "fixtures";

  constructor(private readonly email = "demo@example.com") {}

  async describe(): Promise<{ accountId: string; email: string }> {
    return { accountId: this.email, email: this.email };
  }

  async fetchMessages(options: FetchOptions = {}): Promise<FetchResult> {
    let messages = fixtureMessages();
    if (options.since) {
      const since = options.since;
      messages = messages.filter((message) => message.sentAt >= since);
    }
    if (options.limit) messages = messages.slice(0, options.limit);
    return { messages, cursor: null, full: true };
  }
}
