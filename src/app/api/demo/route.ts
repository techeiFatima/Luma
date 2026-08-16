import { NextResponse } from "next/server";
import { encryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { ConfigError } from "@/lib/env";
import { logger } from "@/lib/logger";
import { setSessionCookie } from "@/lib/session";
import { FixtureMailProvider } from "@/server/providers/fixtures/provider";
import { runPipeline } from "@/server/pipeline/run";

const log = logger("api.demo");

const DEMO_EMAIL = "demo@example.com";

/**
 * Runs the real pipeline over the sample inbox.
 *
 * This is not a mock of the product — extraction, verification, dedupe, and
 * prioritization all run exactly as they do for a connected mailbox. Only the
 * source of the messages differs, which is the point of the provider interface.
 */
export async function POST() {
  try {
    const user = await prisma.user.upsert({
      where: { email: DEMO_EMAIL },
      create: { email: DEMO_EMAIL, name: "Demo" },
      update: {},
    });

    const account = await prisma.connectedAccount.upsert({
      where: {
        userId_provider_providerAccountId: {
          userId: user.id,
          provider: "fixtures",
          providerAccountId: DEMO_EMAIL,
        },
      },
      create: {
        userId: user.id,
        provider: "fixtures",
        providerAccountId: DEMO_EMAIL,
        accessToken: encryptSecret("sample-inbox"),
        scopes: "sample-inbox:read",
      },
      update: {},
    });

    await setSessionCookie(user.id);

    const summary = await runPipeline({
      userId: user.id,
      accountId: account.id,
      provider: new FixtureMailProvider(DEMO_EMAIL),
    });

    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    if (error instanceof ConfigError) {
      return NextResponse.json({ error: error.message }, { status: 501 });
    }
    const message = error instanceof Error ? error.message : String(error);
    log.error("demo run failed", { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
