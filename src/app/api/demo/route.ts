import { getConfig } from "@/config";
import { encryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { setSessionCookie } from "@/lib/session";
import { route } from "@/server/http/route";
import { DEMO_EMAIL, installSampleLoops } from "@/server/demo/sample";
import { proposeForUser } from "@/server/domain/propose";
import { FixtureMailProvider } from "@/server/providers/fixtures/provider";
import { runPipeline } from "@/server/pipeline/run";

/**
 * Signs in to a sample inbox so the product can be judged without credentials.
 *
 * Two modes, and the difference is stated rather than hidden:
 *
 *   with an API key — the real pipeline runs over the sample messages.
 *     Extraction, verification, dedupe, and prioritization all execute exactly
 *     as they would for a connected mailbox; only the source of the mail differs.
 *
 *   without one — a prepared set of loops is installed instead.
 *     Nothing is analyzed, and the response says so, so the dashboard is never
 *     passing off fixtures as something a model produced.
 *
 * The second mode exists because requiring a key before someone can see the
 * dashboard at all made the first-run page a dead end: neither button worked,
 * and the app was, accurately, "just a page".
 *
 * Gated on `demoMode`: on outside production, off inside it unless enabled.
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

  if (!getConfig().ai.enabled) {
    const installed = await installSampleLoops(user.id, account.id);
    await proposeForUser(user.id);
    log.info("installed sample loops (no api key configured)", { userId: user.id });
    return {
      mode: "sample" as const,
      analyzed: false,
      loops: installed.loops,
      note: "Prepared sample results. Add ANTHROPIC_API_KEY to analyze the sample inbox for real.",
    };
  }

  log.info("running the real pipeline over the sample inbox", { userId: user.id });
  const summary = await runPipeline({
    userId: user.id,
    accountId: account.id,
    provider: new FixtureMailProvider(DEMO_EMAIL),
  });

  return { mode: "analyzed" as const, analyzed: true, ...summary };
});
