import { getConfig } from "@/config";
import { encryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { setSessionCookie } from "@/lib/session";
import { route } from "@/server/http/route";
import { FixtureMailProvider } from "@/server/providers/fixtures/provider";
import { runPipeline } from "@/server/pipeline/run";

const DEMO_EMAIL = "demo@example.com";

/**
 * Runs the real pipeline over the sample inbox.
 *
 * This is not a mock of the product — extraction, verification, dedupe, and
 * prioritization all run exactly as they do for a connected mailbox. Only the
 * source of the messages differs, which is the point of the provider interface.
 *
 * It signs a user in without OAuth, so it is gated on `demoMode`: on outside
 * production, and off inside it unless explicitly enabled.
 */
export const POST = route("demo", async ({ log }) => {
  if (!getConfig().demoMode) {
    throw new ForbiddenError("Demo mode is disabled on this instance.");
  }

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
  log.info("running sample inbox", { userId: user.id });

  return runPipeline({
    userId: user.id,
    accountId: account.id,
    provider: new FixtureMailProvider(DEMO_EMAIL),
  });
});
