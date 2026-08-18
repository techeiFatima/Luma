import { prisma } from "@/lib/db";
import { DAY_MS } from "@/lib/time";

/**
 * The sample inbox, as finished Open Loops.
 *
 * Luma needs an Anthropic key to read real mail, and requiring one before a
 * person can see the product at all is a bad trade: the thing they are trying
 * to judge is whether the dashboard is worth having, and that question does
 * not need a model to answer. So this installs a set of loops that look
 * exactly like extracted ones — same fields, same evidence chain, same
 * verification rules — without calling anything.
 *
 * It is used by `npm run db:seed` and by the demo endpoint when no key is
 * configured. When a key *is* present the demo runs the real pipeline instead,
 * and the UI says which of the two happened. Sample results are never
 * presented as though a model produced them.
 */

export const DEMO_EMAIL = "demo@example.com";

/**
 * Representative loops for the demo dashboard.
 *
 * Chosen to span the states the UI has to distinguish: a stated deadline
 * versus one the model inferred, a loop with money attached versus one
 * without, and a commitment with no date at all. Every `quote` appears
 * verbatim in its `bodyText` — the same rule verification enforces on real
 * extractions, so the seed can't demonstrate something the product would
 * reject.
 */
const SAMPLE_LOOPS = [
  {
    externalId: "sample-001",
    dedupeKey: "sample-loop-renewal",
    subject: "Action required: renew your professional license by March 14",
    fromName: "State Licensing Board",
    fromEmail: "noreply@licensing.example.gov",
    receivedDaysAgo: 6,
    bodyText:
      "Your license expires on March 14, 2026. Complete the online renewal form and pay the $180 fee before that date.",
    quote: "Complete the online renewal form",
    title: "Renew professional license",
    summary: "The renewal form and the $180 fee are still outstanding.",
    category: "renewal",
    dueInDays: 3,
    dueAtBasis: "explicit",
    dueAtEvidence: "pay the $180 fee before that date",
    amountMinor: 18_000,
    confidence: 0.93,
    consequence: "high",
    inferenceNotes: "The email states the date and the fee directly.",
    priorityScore: 84,
    priorityBucket: "now",
  },
  {
    externalId: "seed-002",
    dedupeKey: "seed-loop-passport",
    subject: "Your passport renewal application — documents still needed",
    fromName: "Passport Services",
    fromEmail: "no-reply@passports.example.gov",
    receivedDaysAgo: 2,
    bodyText:
      "We received your application but cannot proceed without your supporting documents. Upload your proof of citizenship by April 2, 2026 or the application will be closed.",
    quote: "Upload your proof of citizenship by April 2, 2026",
    title: "Upload passport supporting documents",
    summary: "The application is on hold until proof of citizenship is uploaded.",
    category: "form",
    dueInDays: 5,
    dueAtBasis: "explicit",
    dueAtEvidence: "Upload your proof of citizenship by April 2, 2026",
    amountMinor: null,
    confidence: 0.91,
    consequence: "high",
    inferenceNotes: "The email states the date outright.",
    priorityScore: 78,
    priorityBucket: "now",
  },
  {
    externalId: "seed-003",
    dedupeKey: "seed-loop-invoice",
    subject: "Invoice 4471 from Brightpath Studio",
    fromName: "Brightpath Studio",
    fromEmail: "billing@brightpath.example.com",
    receivedDaysAgo: 4,
    bodyText:
      "Please find invoice 4471 attached for $1,250.00, covering March design work. Payment is due within 30 days of the invoice date.",
    quote: "Payment is due within 30 days of the invoice date",
    title: "Pay Brightpath invoice 4471",
    summary: "$1,250 for March design work is outstanding.",
    category: "payment",
    dueInDays: 11,
    dueAtBasis: "inferred",
    dueAtEvidence: null,
    amountMinor: 125_000,
    confidence: 0.82,
    consequence: "medium",
    inferenceNotes:
      "No calendar date was given. The due date is calculated from the invoice date plus the stated 30 day term.",
    priorityScore: 61,
    priorityBucket: "soon",
  },
  {
    externalId: "seed-004",
    dedupeKey: "seed-loop-dentist",
    subject: "Appointment confirmed — Ridgeline Dental, April 8",
    fromName: "Ridgeline Dental",
    fromEmail: "appointments@ridgelinedental.example.com",
    receivedDaysAgo: 6,
    bodyText:
      "Your appointment is confirmed for April 8 at 9:30am. New patients must complete the medical history form before the visit — bring your insurance card with you.",
    quote: "New patients must complete the medical history form before the visit",
    title: "Complete dental forms before April 8 visit",
    summary: "The medical history form and insurance card are needed before the appointment.",
    category: "appointment_prep",
    dueInDays: 11,
    dueAtBasis: "explicit",
    dueAtEvidence: "Your appointment is confirmed for April 8 at 9:30am",
    amountMinor: null,
    confidence: 0.87,
    consequence: "medium",
    inferenceNotes: "The appointment date is stated; the preparation is required before it.",
    priorityScore: 54,
    priorityBucket: "soon",
  },
  {
    externalId: "seed-005",
    dedupeKey: "seed-loop-reference",
    subject: "Re: quick favour",
    fromName: "Priya Raman",
    fromEmail: "priya.raman@example.com",
    receivedDaysAgo: 3,
    bodyText:
      "No rush at all, but I'd really appreciate it whenever you get a chance. You mentioned you'd send over a reference letter for my grad school application.",
    quote: "You mentioned you'd send over a reference letter",
    title: "Send Priya a reference letter",
    summary: "You said you would write a reference letter for a grad school application.",
    category: "commitment",
    dueInDays: null,
    dueAtBasis: "none",
    dueAtEvidence: null,
    amountMinor: null,
    confidence: 0.79,
    consequence: "medium",
    inferenceNotes:
      "No date was given and none was assumed. The sender explicitly said there is no rush.",
    priorityScore: 33,
    priorityBucket: "later",
  },
] as const;

export interface InstalledSample {
  sourceItems: number;
  loops: number;
}

/**
 * Writes the sample loops for a user. Idempotent: re-running installs nothing
 * new, so the demo button can be pressed repeatedly without piling up copies.
 */
export async function installSampleLoops(
  userId: string,
  accountId: string,
  now: Date = new Date(),
): Promise<InstalledSample> {
  let sourceItems = 0;
  let loops = 0;

  for (const sample of SAMPLE_LOOPS) {
    const item = await prisma.sourceItem.upsert({
      where: { accountId_externalId: { accountId, externalId: sample.externalId } },
      create: {
        userId,
        accountId,
        provider: "fixtures",
        kind: "email",
        externalId: sample.externalId,
        threadExternalId: `${sample.externalId}-thread`,
        subject: sample.subject,
        fromName: sample.fromName,
        fromEmail: sample.fromEmail,
        toEmails: JSON.stringify([DEMO_EMAIL]),
        sentAt: new Date(now.getTime() - sample.receivedDaysAgo * DAY_MS),
        bodyText: sample.bodyText,
        contentHash: `sample-${sample.externalId}`,
        processedAt: new Date(now.getTime() - sample.receivedDaysAgo * DAY_MS),
      },
      update: {},
    });
    sourceItems += 1;

    const loop = await prisma.openLoop.upsert({
      where: { userId_dedupeKey: { userId, dedupeKey: sample.dedupeKey } },
      create: {
        userId,
        title: sample.title,
        summary: sample.summary,
        category: sample.category,
        status: "open",
        dueAt: sample.dueInDays === null ? null : new Date(now.getTime() + sample.dueInDays * DAY_MS),
        dueAtBasis: sample.dueAtBasis,
        dueAtEvidence: sample.dueAtEvidence,
        counterpartyName: sample.fromName,
        counterpartyEmail: sample.fromEmail,
        amountMinor: sample.amountMinor,
        amountCurrency: sample.amountMinor === null ? null : "USD",
        confidence: sample.confidence,
        consequence: sample.consequence,
        inferenceNotes: sample.inferenceNotes,
        priorityScore: sample.priorityScore,
        priorityBucket: sample.priorityBucket,
        dedupeKey: sample.dedupeKey,
      },
      update: {},
    });
    loops += 1;

    await prisma.openLoopEvidence.upsert({
      where: {
        loopId_sourceItemId_quote: { loopId: loop.id, sourceItemId: item.id, quote: sample.quote },
      },
      create: { loopId: loop.id, sourceItemId: item.id, quote: sample.quote },
      update: {},
    });
  }

  return { sourceItems, loops };
}
