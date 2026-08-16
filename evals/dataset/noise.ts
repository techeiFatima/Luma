import type { EvalEmail } from "../types";

/**
 * Emails where the correct answer is "nothing".
 *
 * Buckets: newsletter, marketing, automated, personal.
 *
 * These are the majority of a real inbox and the majority of the opportunity to
 * be wrong. Any loop extracted from a `newsletter`, `marketing`, or `personal`
 * email is a false positive by definition. The `automated` bucket is mixed on
 * purpose: some automated mail carries real obligations, and a prefilter that
 * drops everything from `noreply@` would fail the product.
 */
export const NOISE_EMAILS: EvalEmail[] = [
  // ------------------------------------------------------------- newsletters
  {
    id: "nl-01",
    subject: "The Dispatch: 12 stories we think you'll like",
    fromName: "The Dispatch",
    fromEmail: "newsletter@dispatch.example.com",
    daysAgo: 1,
    body: `This week: urban transit, a long read on shipping containers, and why your coffee
costs more.

Read online | Update preferences | Unsubscribe`,
    headers: {
      "list-unsubscribe": "<https://dispatch.example.com/unsubscribe>",
      "list-id": "dispatch-weekly.dispatch.example.com",
    },
    bucket: "newsletter",
    expected: [],
    rationale: "Standard newsletter with list headers. Should be prefiltered.",
    expectPrefiltered: true,
  },
  {
    id: "nl-02",
    subject: "Your weekly product digest",
    fromName: "Product Team",
    fromEmail: "digest@toolstack.example.com",
    daysAgo: 3,
    body: `What shipped this week: dark mode, faster search, and three bug fixes.

Coming soon: the API you've been asking for.

Manage email preferences`,
    headers: { "list-unsubscribe": "<https://toolstack.example.com/prefs>" },
    bucket: "newsletter",
    expected: [],
    rationale: "Product digest. No obligation.",
    expectPrefiltered: true,
  },
  {
    id: "nl-03",
    subject: "Deadline extended: submit to our writing contest",
    fromName: "Longform Quarterly",
    fromEmail: "editors@longformquarterly.example.com",
    daysAgo: 4,
    body: `Good news — we've extended the submission deadline for the spring contest to
March 30, 2026.

We're looking for essays between 2,000 and 6,000 words. Winners receive $1,000 and
publication.

Unsubscribe from contest announcements`,
    headers: { "list-unsubscribe": "<https://longformquarterly.example.com/u>" },
    bucket: "newsletter",
    expected: [],
    rationale:
      "Has a real date and the word 'deadline', but the user never entered — there is no obligation. A hard false-positive test.",
    expectPrefiltered: true,
  },
  {
    id: "nl-04",
    subject: "This month at the museum",
    fromName: "Fairhaven Museum",
    fromEmail: "members@fairhavenmuseum.example.org",
    daysAgo: 6,
    body: `March exhibitions, member previews, and a talk on Bauhaus textiles.

Member preview night is March 14 — RSVP if you'd like to attend.

Unsubscribe`,
    headers: { "list-unsubscribe": "<https://fairhavenmuseum.example.org/u>" },
    bucket: "newsletter",
    expected: [],
    rationale:
      "An optional RSVP to an optional event is not an open loop. Borderline, and deliberately so.",
    expectPrefiltered: true,
  },
  {
    id: "nl-05",
    subject: "5 things we learned about remote work",
    fromName: "Worklife Weekly",
    fromEmail: "hello@worklifeweekly.example.com",
    daysAgo: 2,
    body: `Our latest research report is out. Download it free.

You're receiving this because you signed up at a conference. Unsubscribe anytime.`,
    headers: { "list-unsubscribe": "<https://worklifeweekly.example.com/u>" },
    bucket: "newsletter",
    expected: [],
    rationale: "Content marketing. No obligation.",
    expectPrefiltered: true,
  },
  {
    id: "nl-06",
    subject: "Security bulletin: CVE-2026-1188",
    fromName: "OpenStack Security",
    fromEmail: "security-announce@openstack.example.org",
    daysAgo: 5,
    body: `A high-severity vulnerability has been disclosed in libwidget < 2.4.1.

Operators are advised to upgrade. Patched packages are available in all supported
channels.

You are subscribed to security-announce.`,
    headers: { "list-id": "security-announce.openstack.example.org" },
    bucket: "newsletter",
    expected: [],
    rationale:
      "A broadcast advisory, not addressed to this user's systems. Real teams may want this, but as an inbox obligation it is not one.",
    expectPrefiltered: true,
  },
  {
    id: "nl-07",
    subject: "Your Spotify Wrapped is here",
    fromName: "Soundwave",
    fromEmail: "no-reply@soundwave.example.com",
    daysAgo: 8,
    body: `You listened to 41,203 minutes this year. See your top artists.

Unsubscribe from promotional emails`,
    headers: { "list-unsubscribe": "<https://soundwave.example.com/u>" },
    bucket: "newsletter",
    expected: [],
    rationale: "Engagement email. Nothing to do.",
    expectPrefiltered: true,
  },
  {
    id: "nl-08",
    subject: "Community roundup: March",
    fromName: "DevCircle",
    fromEmail: "community@devcircle.example.org",
    daysAgo: 7,
    body: `Talks, meetups, and a call for speakers for the June conference (applications close
May 1).

Manage your subscription`,
    headers: { "list-unsubscribe": "<https://devcircle.example.org/u>" },
    bucket: "newsletter",
    expected: [],
    rationale: "A CFP the user has not entered is not an obligation.",
    expectPrefiltered: true,
  },

  // --------------------------------------------------------------- marketing
  {
    id: "mk-01",
    subject: "50% OFF EVERYTHING — 48 hours only!!",
    fromName: "Bright Home",
    fromEmail: "deals@brighthome.example.com",
    daysAgo: 2,
    body: `Our biggest sale of the season. Shop now before it's gone!

Sale ends Sunday at midnight. Don't miss out!

Unsubscribe from marketing emails`,
    headers: { "list-unsubscribe": "<https://brighthome.example.com/u>", precedence: "bulk" },
    bucket: "marketing",
    expected: [],
    rationale: "Manufactured urgency. The archetypal false-positive bait.",
    expectPrefiltered: true,
  },
  {
    id: "mk-02",
    subject: "Last chance: your cart expires tonight",
    fromName: "Gearworks",
    fromEmail: "shop@gearworks.example.com",
    daysAgo: 1,
    body: `You left 3 items in your cart. We're holding them until midnight tonight.

Complete your order now.

Unsubscribe`,
    headers: { "list-unsubscribe": "<https://gearworks.example.com/u>" },
    bucket: "marketing",
    expected: [],
    rationale: "Abandoned-cart nudge with fake urgency. Not an obligation.",
    expectPrefiltered: true,
  },
  {
    id: "mk-03",
    subject: "Act now — rates increase April 1",
    fromName: "Summit Financial",
    fromEmail: "offers@summitfinancial.example.com",
    daysAgo: 5,
    body: `Lock in today's refinance rate before the expected increase on April 1.

Pre-qualify in 3 minutes with no impact to your credit score.

You received this because you visited our site. Unsubscribe`,
    headers: { "list-unsubscribe": "<https://summitfinancial.example.com/u>" },
    bucket: "marketing",
    expected: [],
    rationale:
      "Reads exactly like a financial deadline but the user has no relationship or obligation.",
    expectPrefiltered: true,
  },
  {
    id: "mk-04",
    subject: "Webinar: scaling your data stack",
    fromName: "DataForge",
    fromEmail: "marketing@dataforge.example.com",
    daysAgo: 4,
    body: `Join us March 19 at 2pm ET. Register now — spaces are limited.

Can't make it? Register anyway and we'll send the recording.

Unsubscribe`,
    headers: { "list-unsubscribe": "<https://dataforge.example.com/u>" },
    bucket: "marketing",
    expected: [],
    rationale: "Unregistered webinar invitation. No obligation.",
    expectPrefiltered: true,
  },
  {
    id: "mk-05",
    subject: "We miss you — here's 20% off",
    fromName: "Northline Coffee",
    fromEmail: "hello@northlinecoffee.example.com",
    daysAgo: 9,
    body: `It's been a while. Come back with 20% off your next order — code MISSYOU20,
valid for 14 days.

Unsubscribe`,
    headers: { "list-unsubscribe": "<https://northlinecoffee.example.com/u>" },
    bucket: "marketing",
    expected: [],
    rationale: "Win-back campaign with an expiring code. Not an obligation.",
    expectPrefiltered: true,
  },
  {
    id: "mk-06",
    subject: "Your invitation to our exclusive event",
    fromName: "Vantage Partners",
    fromEmail: "events@vantagepartners.example.com",
    daysAgo: 6,
    body: `We'd like to invite you to an invitation-only dinner on March 24 in the city.

RSVP by March 17 to secure your place.

Unsubscribe from event invitations`,
    headers: { "list-unsubscribe": "<https://vantagepartners.example.com/u>" },
    bucket: "marketing",
    expected: [],
    rationale:
      "Cold sales invitation with an RSVP date. Real date, no obligation — a strong bait case.",
    expectPrefiltered: true,
  },
  {
    id: "mk-07",
    subject: "Upgrade to Pro and save 30%",
    fromName: "Toolstack",
    fromEmail: "growth@toolstack.example.com",
    daysAgo: 3,
    body: `You're on the free plan. Upgrade before the end of the quarter and save 30% for
your first year.

Compare plans | Unsubscribe`,
    headers: { "list-unsubscribe": "<https://toolstack.example.com/u>" },
    bucket: "marketing",
    expected: [],
    rationale: "Upsell. No obligation.",
    expectPrefiltered: true,
  },
  {
    id: "mk-08",
    subject: "Final reminder: claim your reward",
    fromName: "Rewards Program",
    fromEmail: "rewards@retailco.example.com",
    daysAgo: 7,
    body: `You have 4,200 points expiring March 31. Redeem them before they're gone.

Unsubscribe`,
    headers: { "list-unsubscribe": "<https://retailco.example.com/u>" },
    bucket: "marketing",
    expected: [],
    rationale:
      "Expiring loyalty points. Arguably a small real loss, but this is promotional mail and the product should not surface it.",
    expectPrefiltered: true,
  },

  // ------------------------------------------------- automated notifications
  {
    id: "au-01",
    subject: "New sign-in to your account",
    fromName: "Account Security",
    fromEmail: "no-reply@accounts.example.com",
    daysAgo: 1,
    body: `We noticed a new sign-in to your account from Chrome on macOS in Berlin.

If this was you, no action is needed. If not, secure your account immediately.`,
    bucket: "automated",
    expected: [],
    rationale: "Conditional security notice; the stated default is no action.",
  },
  {
    id: "au-02",
    subject: "Your order has shipped",
    fromName: "Meridian Outfitters",
    fromEmail: "shipping@meridian.example.com",
    daysAgo: 2,
    body: `Order #A8823 is on its way. Tracking: 1Z999AA10123456784.

Estimated delivery: March 4, 2026.`,
    bucket: "automated",
    expected: [],
    rationale: "Shipping notification. Nothing for the user to do.",
  },
  {
    id: "au-03",
    subject: "Build #4471 failed on main",
    fromName: "CI",
    fromEmail: "ci@build.example.com",
    daysAgo: 1,
    body: `Pipeline failed: 3 tests failing in payments/checkout.spec.ts

Triggered by: your commit a91f22c "handle partial refunds"

View logs: https://build.example.com/4471`,
    bucket: "automated",
    expected: [
      {
        key: "fix-build",
        category: "follow_up",
        match: ["build", "fail", "test", "fix"],
        dueDate: null,
        dueDateBasis: "none",
        evidenceHint: "Triggered by: your commit",
      },
    ],
    rationale:
      "Automated, but the user's own commit broke the build — a genuine obligation. Tests that automation is not blanket-filtered.",
  },
  {
    id: "au-04",
    subject: "Password expires in 5 days",
    fromName: "IT Helpdesk",
    fromEmail: "no-reply@it.yourcompany.example.com",
    daysAgo: 2,
    body: `Your network password expires on March 4, 2026.

Change it before then or you will be locked out and will need to contact the
helpdesk to regain access.`,
    bucket: "automated",
    expected: [
      {
        key: "password-change",
        category: "deadline",
        match: ["password", "change", "expire"],
        dueDate: "2026-03-04",
        dueDateBasis: "explicit",
        evidenceHint: "expires on March 4, 2026",
      },
    ],
    rationale: "Automated sender, real consequence, stated date.",
  },
  {
    id: "au-05",
    subject: "Weekly usage summary",
    fromName: "Cloudscale",
    fromEmail: "reports@cloudscale.example.com",
    daysAgo: 3,
    body: `Your usage this week: 412 GB transfer, 88 hours compute. You're at 61% of your
plan allowance.

View the full report in the console.`,
    bucket: "automated",
    expected: [],
    rationale: "Informational report, well within limits.",
  },
  {
    id: "au-06",
    subject: "Someone commented on your document",
    fromName: "Docs",
    fromEmail: "notifications@docs.example.com",
    daysAgo: 1,
    body: `Ravi Menon commented on "Q2 Planning":

  "Are these numbers final? Need to know before Thursday."

Reply in the document.`,
    bucket: "automated",
    expected: [
      {
        key: "docs-question",
        category: "unanswered_email",
        match: ["comment", "document", "question", "reply"],
        dueDate: null,
        dueDateBasis: "none",
        evidenceHint: "Are these numbers final",
      },
    ],
    rationale:
      "Notification wrapper around a real direct question. 'Before Thursday' is too vague to date reliably.",
  },
  {
    id: "au-07",
    subject: "Your backup completed successfully",
    fromName: "BackupService",
    fromEmail: "noreply@backupservice.example.com",
    daysAgo: 1,
    body: `Backup of 214 GB completed at 03:12 UTC. No errors.

Next scheduled backup: tomorrow at 03:00 UTC.`,
    bucket: "automated",
    expected: [],
    rationale: "Success notification. Nothing to do.",
  },
  {
    id: "au-08",
    subject: "Calendar invitation: Sprint review",
    fromName: "Calendar",
    fromEmail: "calendar-notification@calendar.example.com",
    daysAgo: 2,
    body: `You have been invited to "Sprint review" on March 5, 2026 at 10:00 AM.

Organizer: Ravi Menon
RSVP: Yes | Maybe | No`,
    bucket: "automated",
    expected: [],
    rationale:
      "A calendar invite is calendar state, not an inbox obligation. Deliberately excluded until the Calendar phase.",
  },
  {
    id: "au-09",
    subject: "Storage almost full",
    fromName: "Drive",
    fromEmail: "no-reply@drive.example.com",
    daysAgo: 4,
    body: `You're using 14.6 GB of your 15 GB. When you run out, you won't be able to receive
email or save files.

Free up space or get more storage.`,
    bucket: "automated",
    expected: [
      {
        key: "storage-full",
        category: "other",
        match: ["storage", "space", "full"],
        dueDate: null,
        dueDateBasis: "none",
        evidenceHint: "you won't be able to receive email",
      },
    ],
    rationale:
      "Borderline: automated, but imminent and consequential. Marked expected so a miss is visible; a system that skips it is defensibly wrong rather than badly wrong.",
  },

  // ---------------------------------------------------- irrelevant/personal
  {
    id: "pe-01",
    threadId: "th-pe-01",
    subject: "Re: dinner Saturday?",
    fromName: "Sam Ortega",
    fromEmail: "sam.ortega@example.com",
    daysAgo: 1,
    body: `Works for me! I'll book the table for 7:30 and send you the confirmation.

See you then.`,
    bucket: "personal",
    expected: [],
    rationale: "The *sender* took the action. Nothing is owed by the user.",
  },
  {
    id: "pe-02",
    threadId: "th-pe-02",
    subject: "photos from the weekend",
    fromName: "Mira Kowalski",
    fromEmail: "mira.k@example.com",
    daysAgo: 3,
    body: `Finally got round to uploading these. The one of you on the ridge is great.

Album link inside. No rush looking at them!`,
    bucket: "personal",
    expected: [],
    rationale: "Pure social. Explicitly no rush, nothing asked.",
  },
  {
    id: "pe-03",
    threadId: "th-pe-03",
    subject: "Re: that article you mentioned",
    fromName: "Daniel Osei",
    fromEmail: "d.osei@example.com",
    daysAgo: 2,
    body: `Found it — sending the link. Thought the second half was much stronger than the
first.

Anyway, hope the move went okay!`,
    bucket: "personal",
    expected: [],
    rationale: "Conversational. No request.",
  },
  {
    id: "pe-04",
    threadId: "th-pe-04",
    subject: "Notes from Tuesday's sync",
    fromName: "Wei Zhang",
    fromEmail: "wei@yourcompany.example.com",
    daysAgo: 3,
    body: `Sharing my notes for anyone who missed it.

  - Q2 roadmap is locked
  - Design review moved to next month
  - Wei to follow up with the vendor (done, sent yesterday)

Nothing needed from anyone else, just FYI.`,
    bucket: "personal",
    expected: [],
    rationale:
      "FYI notes that explicitly close out their own action item. Extracting 'follow up with vendor' would be a false positive on a completed task.",
  },
  {
    id: "pe-05",
    threadId: "th-pe-05",
    subject: "congrats!!",
    fromName: "Ana Beltran",
    fromEmail: "ana.beltran@example.com",
    daysAgo: 5,
    body: `Just saw the announcement — so pleased for you. Very well deserved.

Let's celebrate soon.`,
    bucket: "personal",
    expected: [],
    rationale:
      "'Let's celebrate soon' is a pleasantry, not a commitment. Extracting it is a false positive.",
  },
  {
    id: "pe-06",
    threadId: "th-pe-06",
    subject: "Re: recipe",
    fromName: "Tom Whitfield",
    fromEmail: "tom.w@example.com",
    daysAgo: 6,
    body: `Here it is. The trick is to salt the aubergine for at least an hour first,
otherwise it goes soggy.

Let me know how it turns out.`,
    bucket: "personal",
    expected: [],
    rationale: "'Let me know how it turns out' is conversational, not an obligation.",
  },
  {
    id: "pe-07",
    threadId: "th-pe-07",
    subject: "Out of office: back March 9",
    fromName: "Lucia Ferrari",
    fromEmail: "lucia.ferrari@partner.example.com",
    daysAgo: 2,
    body: `I'm out of the office until March 9 with limited email access.

For urgent matters contact my colleague Marco.`,
    bucket: "personal",
    expected: [],
    rationale: "Auto-reply. Contains a date; contains no obligation.",
  },
  {
    id: "pe-08",
    threadId: "th-pe-08",
    subject: "Re: welcome to the team!",
    fromName: "Ravi Menon",
    fromEmail: "ravi@yourcompany.example.com",
    daysAgo: 8,
    body: `Great to have you. I've added you to the team channel and shared the onboarding
doc — have a look when you get a chance, no deadline on it.`,
    bucket: "personal",
    expected: [],
    rationale:
      "Explicitly no deadline and no real requirement. Borderline, and deliberately marked negative to test over-eagerness.",
  },
];
