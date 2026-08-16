import type { NormalizedMessage } from "../types";

/**
 * A deliberately messy sample inbox.
 *
 * Roughly half of these contain a genuine open loop; the rest are the noise a
 * real inbox is full of — newsletters, marketing, closed threads, receipts with
 * nothing left to do. That mix is the point: precision is the thing we care
 * about, so the fixtures have to give the pipeline real chances to be wrong.
 */

interface FixtureSpec {
  externalId: string;
  threadExternalId?: string;
  subject: string;
  fromName: string;
  fromEmail: string;
  daysAgo: number;
  body: string;
  headers?: Record<string, string>;
  labels?: string[];
}

const OWNER = "you@example.com";

const specs: FixtureSpec[] = [
  {
    externalId: "fx-001",
    threadExternalId: "th-001",
    subject: "Action required: renew your professional license by March 14",
    fromName: "State Licensing Board",
    fromEmail: "noreply@licensing.example.gov",
    daysAgo: 6,
    body: `Dear licensee,

Our records show your professional license (#PL-88213) expires on March 14, 2026.

To remain in good standing you must complete the online renewal form and pay the
$180 renewal fee before March 14, 2026. Licenses not renewed by that date are
placed in inactive status and require a reinstatement application.

Renew at: https://licensing.example.gov/renew

State Licensing Board`,
  },
  {
    externalId: "fx-002",
    threadExternalId: "th-002",
    subject: "Re: contract review — can you get me comments this week?",
    fromName: "Priya Raman",
    fromEmail: "priya@northwind.example.com",
    daysAgo: 3,
    body: `Hi,

Following up on the vendor agreement I sent over Monday. Legal wants to close
this out before the end of the quarter, so could you send me your comments on
sections 4 and 7 by Friday?

If it's easier we can walk through it on a call, but I do need something written
before I pass it back to their counsel.

Thanks,
Priya`,
  },
  {
    externalId: "fx-003",
    threadExternalId: "th-003",
    subject: "Your return window closes soon — order #A7741",
    fromName: "Meridian Outfitters",
    fromEmail: "orders@meridian.example.com",
    daysAgo: 9,
    body: `Hi there,

We noticed you started a return for the Trailhead jacket (order #A7741) but the
package hasn't been dropped off yet.

Returns must be postmarked within 30 days of delivery. Your window closes on
March 2, 2026. After that we can't issue a refund for this order.

Your prepaid label is attached to the original return confirmation.

Meridian Outfitters Support`,
  },
  {
    externalId: "fx-004",
    threadExternalId: "th-004",
    subject: "Weekly digest: 12 stories we think you'll like",
    fromName: "The Dispatch",
    fromEmail: "newsletter@dispatch.example.com",
    daysAgo: 1,
    body: `This week's most-read stories, plus a long read on urban transit.

Read online | Update preferences | Unsubscribe`,
    headers: {
      "list-unsubscribe": "<https://dispatch.example.com/unsubscribe>",
      "list-id": "dispatch-weekly.dispatch.example.com",
    },
  },
  {
    externalId: "fx-005",
    threadExternalId: "th-005",
    subject: "Dentist appointment confirmed — Tue March 10, 9:00am",
    fromName: "Ridgeline Dental",
    fromEmail: "front-desk@ridgelinedental.example.com",
    daysAgo: 4,
    body: `Your appointment is confirmed for Tuesday, March 10 at 9:00 AM with Dr. Okafor.

Please complete the updated medical history form before your visit — new patients
and anyone who hasn't visited in over a year must submit it in advance. You can
fill it out here: https://ridgelinedental.example.com/forms/history

If you arrive without the form completed we may need to reschedule.

Ridgeline Dental`,
  },
  {
    externalId: "fx-006",
    threadExternalId: "th-006",
    subject: "50% OFF EVERYTHING — 48 hours only!!",
    fromName: "Bright Home",
    fromEmail: "deals@brighthome.example.com",
    daysAgo: 2,
    body: `Our biggest sale of the season is here. Shop now before it's gone!

Unsubscribe from marketing emails`,
    headers: {
      "list-unsubscribe": "<https://brighthome.example.com/unsub>",
      precedence: "bulk",
    },
  },
  {
    externalId: "fx-007",
    threadExternalId: "th-007",
    subject: "Re: happy to take a look at the deck",
    fromName: "Marcus Bell",
    fromEmail: "marcus@bellcapital.example.com",
    daysAgo: 11,
    body: `Sounds good — send it over whenever it's ready and I'll give you notes.

No rush on my end.

Marcus`,
  },
  {
    externalId: "fx-008",
    threadExternalId: "th-008",
    subject: "Your subscription renews on March 20 — $240/year",
    fromName: "Atlas Analytics",
    fromEmail: "billing@atlasanalytics.example.com",
    daysAgo: 5,
    body: `This is a reminder that your Atlas Analytics Pro annual subscription will
automatically renew on March 20, 2026 and the card on file will be charged $240.00.

If you'd like to change your plan or cancel, you can do so from billing settings
at any time before the renewal date.

Atlas Analytics Billing`,
  },
  {
    externalId: "fx-009",
    threadExternalId: "th-009",
    subject: "Reference request for Dana — deadline Friday",
    fromName: "Dana Whitfield",
    fromEmail: "dana.whitfield@example.com",
    daysAgo: 7,
    body: `Hey,

Sorry to ask, but the graduate program needs my last reference letter submitted
by this Friday and you very kindly said you'd write one back in January.

The submission link went to your email on Jan 8 — let me know if you need me to
resend it. I know it's short notice and I really appreciate it.

Dana`,
  },
  {
    externalId: "fx-010",
    threadExternalId: "th-010",
    subject: "Receipt for your payment — $42.30",
    fromName: "Corner Grocery",
    fromEmail: "receipts@cornergrocery.example.com",
    daysAgo: 2,
    body: `Thanks for shopping with us. Your card ending 4412 was charged $42.30.

No action needed. This is a receipt for your records.`,
  },
  {
    externalId: "fx-011",
    threadExternalId: "th-011",
    subject: "Passport renewal: documents still outstanding",
    fromName: "Passport Services",
    fromEmail: "no-reply@passports.example.gov",
    daysAgo: 14,
    body: `Application #PR-4471902

We have received your application but it cannot be processed until we receive:

  - A certified copy of your birth certificate
  - One passport-style photograph taken within the last 6 months

Applications with outstanding documents are closed after 90 days from the
application date (submitted January 20, 2026) and the fee is not refunded.

Passport Services`,
  },
  {
    externalId: "fx-012",
    threadExternalId: "th-012",
    subject: "Re: dinner Saturday?",
    fromName: "Sam Ortega",
    fromEmail: "sam.ortega@example.com",
    daysAgo: 1,
    body: `Works for me! I'll book the table for 7:30 and send you the confirmation.

See you then.`,
  },
  {
    externalId: "fx-013",
    threadExternalId: "th-013",
    subject: "Following up: your quote expires in 5 days",
    fromName: "Harborview Insurance",
    fromEmail: "quotes@harborview.example.com",
    daysAgo: 8,
    body: `Hi,

The homeowners policy quote we prepared for you (ref HQ-33418, $1,140/year) is
valid for 30 days and expires on March 8, 2026.

To lock in this rate you'll need to accept the quote and submit the signed
application. After March 8 we'd need to re-quote, and rates in your area have
been trending upward.

Reply to this email or call us at 555-0142 if you'd like to proceed.

Harborview Insurance`,
  },
  {
    externalId: "fx-014",
    threadExternalId: "th-014",
    subject: "Notes from Tuesday's sync",
    fromName: "Wei Zhang",
    fromEmail: "wei@example.com",
    daysAgo: 3,
    body: `Sharing my notes from the sync for anyone who missed it.

- Q2 roadmap is locked
- Design review moved to next month
- Wei to follow up with the vendor (done, sent yesterday)

Nothing needed from anyone else, just FYI.`,
  },
];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Timestamps are anchored to the start of the current UTC day, not to the
 * moment of the call.
 *
 * Ingestion detects "nothing changed" by hashing the message, and `sentAt` is
 * part of that hash. If the fixtures shifted by a few milliseconds on every
 * call, every sync would look like new content and re-run extraction — which
 * would make the sample inbox behave nothing like a real one.
 */
function startOfUtcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function fixtureMessages(now: Date = new Date()): NormalizedMessage[] {
  const anchor = startOfUtcDay(now);
  return specs.map((spec, index) => ({
    externalId: spec.externalId,
    threadExternalId: spec.threadExternalId ?? null,
    subject: spec.subject,
    fromName: spec.fromName,
    fromEmail: spec.fromEmail,
    toEmails: [OWNER],
    // A fixed per-message hour keeps ordering realistic without adding drift.
    sentAt: new Date(anchor - spec.daysAgo * DAY_MS + ((index % 12) + 8) * 60 * 60 * 1000),
    snippet: spec.body.slice(0, 120).replace(/\s+/g, " ").trim(),
    bodyText: spec.body,
    headers: { from: `${spec.fromName} <${spec.fromEmail}>`, ...(spec.headers ?? {}) },
    labels: spec.labels ?? ["INBOX"],
  }));
}
