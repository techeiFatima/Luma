import type { EvalEmail } from "../types";

/**
 * Emails that contain a genuine obligation for the user.
 *
 * Buckets: deadline, follow_up, commitment, appointment, form.
 * Every one of these has at least one expected loop — a miss here is a recall
 * failure, which is the product failing at its actual job.
 */
export const OBLIGATION_EMAILS: EvalEmail[] = [
  // ---------------------------------------------------------------- deadlines
  {
    id: "dl-01",
    subject: "Final notice: tax documents due March 14",
    fromName: "Harlow & Finch Accounting",
    fromEmail: "clients@harlowfinch.example.com",
    daysAgo: 5,
    body: `Hi,

We still need your 2025 income documents to file on time. Please upload your W-2,
1099s, and mortgage interest statement to the client portal by March 14, 2026.

If we don't have them by then we'll need to file an extension on your behalf,
which delays any refund by several weeks.

Portal: https://portal.harlowfinch.example.com

Best,
Dana at Harlow & Finch`,
    bucket: "deadline",
    expected: [
      {
        key: "tax-docs",
        category: "deadline",
        match: ["tax", "document", "upload", "portal"],
        dueDate: "2026-03-14",
        dueDateBasis: "explicit",
        evidenceHint: "by March 14, 2026",
      },
    ],
    rationale: "Hard stated deadline with a named consequence and a clear user action.",
  },
  {
    id: "dl-02",
    subject: "Scholarship application closes Friday",
    fromName: "Ridgeway Foundation",
    fromEmail: "awards@ridgeway.example.org",
    daysAgo: 2,
    body: `Dear applicant,

Your application for the Ridgeway Community Scholarship is saved but not submitted.
Applications close at 5:00 PM on Friday, March 6, 2026. Incomplete applications are
not reviewed.

You still need to attach your transcript and submit.

Ridgeway Foundation`,
    bucket: "deadline",
    expected: [
      {
        key: "scholarship-submit",
        category: "application",
        match: ["scholarship", "application", "submit"],
        dueDate: "2026-03-06",
        dueDateBasis: "explicit",
        evidenceHint: "close at 5:00 PM on Friday, March 6, 2026",
      },
    ],
    rationale:
      "An unsubmitted application with a stated close date. Category is 'application' rather than the bucket name — the bucket is only how the dataset is organized.",
  },
  {
    id: "dl-03",
    subject: "Jury summons — response required within 10 days",
    fromName: "County Clerk of Court",
    fromEmail: "noreply@courts.example.gov",
    daysAgo: 3,
    body: `JUROR SUMMONS #JS-2026-88431

You are summoned for jury service. You must complete and return the enclosed
qualification questionnaire within 10 days of the date of this notice
(dated February 26, 2026).

Failure to respond may result in a contempt citation.

Respond online at https://courts.example.gov/jury with your juror number.`,
    bucket: "deadline",
    expected: [
      {
        key: "jury-questionnaire",
        category: "form",
        match: ["juror", "jury", "questionnaire", "respond"],
        dueDate: "2026-03-08",
        dueDateBasis: "inferred",
        evidenceHint: "within 10 days of the date of this notice",
      },
    ],
    rationale:
      "The deadline is computable (Feb 26 + 10 days) but not stated as a date, so a correct system marks it inferred rather than explicit.",
  },
  {
    id: "dl-04",
    subject: "Open enrollment ends March 31",
    fromName: "Benefits Team",
    fromEmail: "benefits@yourcompany.example.com",
    daysAgo: 8,
    body: `Open enrollment for the 2026-2027 plan year runs through March 31, 2026.

Our records show you have not made elections. If you take no action you will be
enrolled in the default plan at the default contribution, which may not match
last year's coverage.

Make your elections in Workday.`,
    bucket: "deadline",
    expected: [
      {
        key: "benefits-elections",
        category: "deadline",
        match: ["enrollment", "election", "benefit"],
        dueDate: "2026-03-31",
        dueDateBasis: "explicit",
        evidenceHint: "through March 31, 2026",
      },
    ],
    rationale: "Stated deadline, explicit consequence of inaction, user must act.",
  },
  {
    id: "dl-05",
    subject: "Visa appointment documents — 48 hours left",
    fromName: "Consular Services",
    fromEmail: "appointments@consular.example.gov",
    daysAgo: 1,
    body: `Your visa interview is scheduled for March 12, 2026.

Required documents must be uploaded at least 7 days before your interview date.
Our system shows nothing uploaded yet.

Required: passport bio page, proof of funds, employment letter.`,
    bucket: "deadline",
    expected: [
      {
        key: "visa-docs",
        category: "deadline",
        match: ["visa", "document", "upload"],
        dueDate: "2026-03-05",
        dueDateBasis: "inferred",
        evidenceHint: "at least 7 days before your interview date",
      },
    ],
    rationale:
      "Deadline is interview date minus 7 days = March 5. Derived, so 'inferred'. Subject says '48 hours' which contradicts the body — a good system should trust the computable rule.",
  },
  {
    id: "dl-06",
    subject: "Contract signature needed before end of month",
    fromName: "Ines Vogel",
    fromEmail: "ines.vogel@brightpath.example.com",
    daysAgo: 4,
    body: `Hi,

Legal has approved the final version. We need your signature on the MSA before the
end of this month so we can start the engagement on April 1.

DocuSign link went out separately — let me know if it didn't arrive.

Ines`,
    bucket: "deadline",
    expected: [
      {
        key: "sign-msa",
        category: "deadline",
        match: ["sign", "contract", "msa"],
        dueDate: "2026-03-31",
        dueDateBasis: "inferred",
        evidenceHint: "before the end of this month",
      },
    ],
    rationale: "'End of this month' is derivable from the send date; inferred, not explicit.",
  },
  {
    id: "dl-07",
    subject: "Parking permit expires March 9",
    fromName: "Campus Parking",
    fromEmail: "parking@university.example.edu",
    daysAgo: 6,
    body: `Your parking permit (Lot C, #4412) expires on March 9, 2026.

Vehicles in Lot C without a valid permit after that date are ticketed at $75 per
occurrence. Renew online through the parking portal.`,
    bucket: "deadline",
    expected: [
      {
        key: "parking-permit",
        category: "renewal",
        match: ["parking", "permit", "renew"],
        dueDate: "2026-03-09",
        dueDateBasis: "explicit",
        evidenceHint: "expires on March 9, 2026",
      },
    ],
    rationale: "Renewal framing with a hard date and a monetary consequence.",
  },
  {
    id: "dl-08",
    subject: "Response needed: proposed settlement",
    fromName: "Okonjo Legal",
    fromEmail: "m.okonjo@okonjolegal.example.com",
    daysAgo: 2,
    body: `The other side has made an offer. Under the scheduling order we must respond
within 14 days of service, which was February 27, 2026.

Please review the attached and let me know how you'd like to proceed. I need your
decision no later than March 10 so I have time to draft.

Michael`,
    bucket: "deadline",
    expected: [
      {
        key: "settlement-decision",
        category: "deadline",
        match: ["settlement", "respond", "decision", "offer"],
        dueDate: "2026-03-10",
        dueDateBasis: "explicit",
        evidenceHint: "no later than March 10",
      },
    ],
    rationale:
      "Two dates appear (Mar 13 from the 14-day rule, Mar 10 from the lawyer). The operative user deadline is the stated March 10.",
  },
  {
    id: "dl-09",
    subject: "Storage unit auction notice",
    fromName: "SecureSpace Storage",
    fromEmail: "billing@securespace.example.com",
    daysAgo: 9,
    body: `Unit B-207 is 60 days past due in the amount of $384.00.

Per your rental agreement and state law, the contents will be sold at public
auction if the balance is not paid in full by March 20, 2026.`,
    bucket: "deadline",
    expected: [
      {
        key: "storage-balance",
        category: "payment",
        match: ["storage", "balance", "pay", "unit"],
        dueDate: "2026-03-20",
        dueDateBasis: "explicit",
        evidenceHint: "paid in full by March 20, 2026",
      },
    ],
    rationale: "Severe consequence, stated date, amount present ($384.00 = 38400 minor units).",
  },
  {
    id: "dl-10",
    subject: "Passport expires in under 6 months",
    fromName: "Travel Desk",
    fromEmail: "travel@yourcompany.example.com",
    daysAgo: 12,
    body: `Heads up — your passport on file expires on August 2, 2026.

Many destinations require at least six months of validity on arrival, which means
it is effectively unusable for travel booked after early February. If you have
international travel planned this year, start the renewal now; processing is
currently 8-11 weeks.`,
    bucket: "deadline",
    expected: [
      {
        key: "passport-renew",
        category: "renewal",
        match: ["passport", "renew"],
        dueDate: null,
        dueDateBasis: "none",
        evidenceHint: "start the renewal now",
      },
    ],
    rationale:
      "Real obligation but NO firm deadline — the Aug 2 date is the expiry, not a due date. A system that sets dueAt = 2026-08-02 has made a date error.",
  },

  // -------------------------------------------------------------- follow-ups
  {
    id: "fu-01",
    threadId: "th-fu-01",
    subject: "Re: budget numbers for Q2",
    fromName: "Tomas Lindqvist",
    fromEmail: "tomas@yourcompany.example.com",
    daysAgo: 4,
    body: `Any update on the Q2 headcount numbers? I asked last week and I need them to
finish the board deck.

I'm presenting Thursday so I really need them by Wednesday at the latest.

Tomas`,
    bucket: "follow_up",
    expected: [
      {
        key: "q2-numbers",
        category: "follow_up",
        match: ["q2", "headcount", "number", "budget"],
        dueDate: "2026-03-04",
        dueDateBasis: "inferred",
        evidenceHint: "by Wednesday at the latest",
      },
    ],
    rationale:
      "Chased request with a soft but computable deadline (the Wednesday after Feb 25 = Mar 4). Inferred.",
  },
  {
    id: "fu-02",
    threadId: "th-fu-02",
    subject: "Following up on my invoice",
    fromName: "Priya Nair",
    fromEmail: "priya@nairdesign.example.com",
    daysAgo: 7,
    body: `Hi,

Just checking in on invoice #2291 (sent Feb 3, $2,400). It's now 30 days past the
agreed net-15 terms and I haven't seen payment come through.

Could you check with accounts payable?

Priya`,
    bucket: "follow_up",
    expected: [
      {
        key: "invoice-2291",
        category: "payment",
        match: ["invoice", "payment", "2291"],
        dueDate: null,
        dueDateBasis: "none",
        evidenceHint: "30 days past the agreed net-15 terms",
      },
    ],
    rationale:
      "Overdue payment chase. Already overdue, no future date given — dueAt null is correct; inventing one is an error.",
  },
  {
    id: "fu-03",
    threadId: "th-fu-03",
    subject: "Re: reference check for Amara",
    fromName: "Talent Team",
    fromEmail: "recruiting@northstar.example.com",
    daysAgo: 5,
    body: `Hello,

Amara listed you as a reference. We sent the reference form on Feb 20 and haven't
received it yet.

We're holding her offer until references clear, so any time you can give it this
week would help her a lot.`,
    bucket: "follow_up",
    expected: [
      {
        key: "reference-form",
        category: "form",
        match: ["reference", "form", "amara"],
        dueDate: null,
        dueDateBasis: "none",
        evidenceHint: "haven't received it yet",
      },
    ],
    rationale: "Real outstanding form. 'This week' is vague enough that no date is safest.",
  },
  {
    id: "fu-04",
    threadId: "th-fu-04",
    subject: "Second request: signed W-9",
    fromName: "Vendor Onboarding",
    fromEmail: "vendors@meridiancorp.example.com",
    daysAgo: 11,
    body: `This is our second request for a completed W-9.

We cannot process any payments to you until we have it on file. Your first invoice
is currently on hold.

Please return the attached form.`,
    bucket: "follow_up",
    expected: [
      {
        key: "w9",
        category: "form",
        match: ["w-9", "w9", "form"],
        dueDate: null,
        dueDateBasis: "none",
        evidenceHint: "second request for a completed W-9",
      },
    ],
    rationale: "Clear outstanding form blocking payment. No date stated.",
  },
  {
    id: "fu-05",
    threadId: "th-fu-05",
    subject: "Re: your notes on the draft?",
    fromName: "Elena Duarte",
    fromEmail: "elena@pressfold.example.com",
    daysAgo: 3,
    body: `Hi again — did you get a chance to look at chapter 3? No pressure if not, but the
copyeditor starts on the 16th and anything after that gets expensive to change.

Elena`,
    bucket: "follow_up",
    expected: [
      {
        key: "chapter-3-notes",
        category: "follow_up",
        match: ["chapter", "notes", "draft", "review"],
        dueDate: "2026-03-16",
        dueDateBasis: "inferred",
        evidenceHint: "copyeditor starts on the 16th",
      },
    ],
    rationale:
      "Soft ask with a real practical cutoff. The 16th of the current month = Mar 16. Inferred since it's a constraint, not a stated due date.",
  },
  {
    id: "fu-06",
    threadId: "th-fu-06",
    subject: "Still need your availability",
    fromName: "Jordan Blake",
    fromEmail: "jordan.blake@example.com",
    daysAgo: 6,
    body: `Hey, I've asked a couple of times now — can you send me three windows that work for
the panel? I'm trying to lock the room.

Thanks!`,
    bucket: "follow_up",
    expected: [
      {
        key: "panel-availability",
        category: "follow_up",
        match: ["availability", "window", "panel"],
        dueDate: null,
        dueDateBasis: "none",
        evidenceHint: "send me three windows",
      },
    ],
    rationale: "Repeated small request, genuinely outstanding, no date.",
  },
  {
    id: "fu-07",
    threadId: "th-fu-07",
    subject: "Re: insurance claim #CL-88120",
    fromName: "Claims Department",
    fromEmail: "claims@harborview.example.com",
    daysAgo: 8,
    body: `We are still missing the repair estimate for claim CL-88120.

Claims with outstanding documentation for more than 45 days from the date of loss
(January 22, 2026) are closed automatically and must be refiled.`,
    bucket: "follow_up",
    expected: [
      {
        key: "claim-estimate",
        category: "form",
        match: ["claim", "estimate", "repair"],
        dueDate: "2026-03-08",
        dueDateBasis: "inferred",
        evidenceHint: "more than 45 days from the date of loss",
      },
    ],
    rationale: "Jan 22 + 45 days = Mar 8. Computable, therefore inferred.",
  },
  {
    id: "fu-08",
    threadId: "th-fu-08",
    subject: "Checking in — did this get lost?",
    fromName: "Wei Chen",
    fromEmail: "wei.chen@example.com",
    daysAgo: 2,
    body: `Hi! Circling back on the intro to your colleague at Belmont. Totally fine if it's
not a fit — just let me know either way so I can stop wondering.`,
    bucket: "follow_up",
    expected: [
      {
        key: "belmont-intro",
        category: "follow_up",
        match: ["intro", "belmont", "reply"],
        dueDate: null,
        dueDateBasis: "none",
        evidenceHint: "let me know either way",
      },
    ],
    rationale:
      "Low-stakes but genuinely awaiting a reply from the user. Correct to surface at low priority.",
  },
  {
    id: "fu-09",
    threadId: "th-fu-09",
    subject: "Re: quote request",
    fromName: "Sales",
    fromEmail: "sales@atlasworks.example.com",
    daysAgo: 4,
    body: `Thanks for your interest! I've attached the quote you asked for.

Let me know if you have questions — happy to jump on a call.`,
    bucket: "follow_up",
    expected: [],
    rationale:
      "The sender owes nothing and asks for nothing concrete. 'Let me know if you have questions' is not an obligation. Expected: no loop.",
  },

  // ------------------------------------------------------------- commitments
  {
    id: "cm-01",
    threadId: "th-cm-01",
    subject: "Re: conference panel",
    fromName: "You",
    fromEmail: "you@example.com",
    daysAgo: 6,
    body: `Happy to do it — I'll send you a 200-word bio and a headshot by the end of the week.

Looking forward to it.`,
    bucket: "commitment",
    expected: [
      {
        key: "bio-headshot",
        category: "commitment",
        match: ["bio", "headshot", "send"],
        dueDate: "2026-03-01",
        dueDateBasis: "inferred",
        evidenceHint: "by the end of the week",
      },
    ],
    rationale:
      "The user promised something. Sent Feb 23, 'end of the week' = Feb 27-Mar 1. Any date in that range is defensible; inferred.",
  },
  {
    id: "cm-02",
    threadId: "th-cm-02",
    subject: "Re: neighbourhood association",
    fromName: "You",
    fromEmail: "you@example.com",
    daysAgo: 10,
    body: `I can take the minutes for the March meeting and circulate them afterwards.

Put me down for it.`,
    bucket: "commitment",
    expected: [
      {
        key: "take-minutes",
        category: "commitment",
        match: ["minutes", "meeting", "circulate"],
        dueDate: null,
        dueDateBasis: "none",
        evidenceHint: "take the minutes for the March meeting",
      },
    ],
    rationale: "A real commitment with no specific date attached.",
  },
  {
    id: "cm-03",
    threadId: "th-cm-03",
    subject: "Re: moving day",
    fromName: "You",
    fromEmail: "you@example.com",
    daysAgo: 3,
    body: `Yes — I'll book the van for the 21st and send you the confirmation.`,
    bucket: "commitment",
    expected: [
      {
        key: "book-van",
        category: "commitment",
        match: ["van", "book", "confirmation"],
        dueDate: null,
        dueDateBasis: "none",
        evidenceHint: "I'll book the van for the 21st",
      },
    ],
    rationale:
      "The 21st is the van date, NOT the deadline to book. Setting dueAt = Mar 21 is a subtle but real date error.",
  },
  {
    id: "cm-04",
    threadId: "th-cm-04",
    subject: "Re: grant application",
    fromName: "You",
    fromEmail: "you@example.com",
    daysAgo: 5,
    body: `I'll write the methods section. Give me until the 12th and you'll have a draft.`,
    bucket: "commitment",
    expected: [
      {
        key: "methods-draft",
        category: "commitment",
        match: ["methods", "draft", "write"],
        dueDate: "2026-03-12",
        dueDateBasis: "explicit",
        evidenceHint: "Give me until the 12th",
      },
    ],
    rationale: "Self-imposed but stated date. 'The 12th' = Mar 12.",
  },
  {
    id: "cm-05",
    threadId: "th-cm-05",
    subject: "Re: can you review this PR?",
    fromName: "You",
    fromEmail: "you@example.com",
    daysAgo: 2,
    body: `Sure, I'll get to it today or tomorrow.`,
    bucket: "commitment",
    expected: [
      {
        key: "review-pr",
        category: "commitment",
        match: ["review", "pr", "pull request"],
        dueDate: null,
        dueDateBasis: "none",
        evidenceHint: "I'll get to it today or tomorrow",
      },
    ],
    rationale:
      "Genuine commitment. 'Today or tomorrow' relative to Feb 27 is arguably Feb 28, but it is already past — no date is the safe answer.",
  },
  {
    id: "cm-06",
    threadId: "th-cm-06",
    subject: "Re: book club",
    fromName: "You",
    fromEmail: "you@example.com",
    daysAgo: 8,
    body: `I'd love to host in April. I'll pick a date once I check with everyone.`,
    bucket: "commitment",
    expected: [
      {
        key: "host-book-club",
        category: "commitment",
        match: ["host", "book club", "date"],
        dueDate: null,
        dueDateBasis: "none",
        evidenceHint: "I'll pick a date",
      },
    ],
    rationale: "Vague but real commitment. Low consequence; should surface low, not be invented into a deadline.",
  },
  {
    id: "cm-07",
    threadId: "th-cm-07",
    subject: "Re: thanks for the intro",
    fromName: "You",
    fromEmail: "you@example.com",
    daysAgo: 4,
    body: `No problem at all. Glad it was useful!`,
    bucket: "commitment",
    expected: [],
    rationale: "A pleasantry with no commitment. Extracting anything here is a false positive.",
  },
  {
    id: "cm-08",
    threadId: "th-cm-08",
    subject: "Re: donation",
    fromName: "You",
    fromEmail: "you@example.com",
    daysAgo: 9,
    body: `Count me in for the usual amount — I'll set up the transfer before the campaign closes
on the 15th.`,
    bucket: "commitment",
    expected: [
      {
        key: "donation-transfer",
        category: "commitment",
        match: ["transfer", "donation", "campaign"],
        dueDate: "2026-03-15",
        dueDateBasis: "explicit",
        evidenceHint: "before the campaign closes",
      },
    ],
    rationale: "User-stated commitment tied to a stated date.",
  },

  // ------------------------------------------------------------ appointments
  {
    id: "ap-01",
    subject: "Your appointment: Thursday March 12, 10:30am",
    fromName: "Northgate Dermatology",
    fromEmail: "reception@northgatederm.example.com",
    daysAgo: 5,
    body: `This confirms your appointment with Dr. Reyes on Thursday, March 12 at 10:30 AM.

New patients must complete the intake form and insurance verification at least 24
hours before the visit or the appointment will be released.

Intake: https://northgatederm.example.com/intake`,
    bucket: "appointment",
    expected: [
      {
        key: "derm-intake",
        category: "appointment_prep",
        match: ["intake", "form", "appointment"],
        dueDate: "2026-03-11",
        dueDateBasis: "inferred",
        evidenceHint: "at least 24 hours before the visit",
      },
    ],
    rationale:
      "The appointment itself is not a loop — the unfinished intake form is. Deadline is visit minus 24h.",
  },
  {
    id: "ap-02",
    subject: "Reminder: annual physical on March 18",
    fromName: "Lakeside Family Practice",
    fromEmail: "reminders@lakesidefp.example.com",
    daysAgo: 3,
    body: `You have an appointment on March 18, 2026 at 2:00 PM.

Please fast for 12 hours before your blood draw and bring a current list of
medications.

Reply STOP to opt out of reminders.`,
    bucket: "appointment",
    expected: [
      {
        key: "physical-prep",
        category: "appointment_prep",
        match: ["physical", "fast", "medication", "appointment"],
        dueDate: "2026-03-18",
        dueDateBasis: "explicit",
        evidenceHint: "fast for 12 hours before your blood draw",
      },
    ],
    rationale: "Preparation required before a dated appointment.",
  },
  {
    id: "ap-03",
    subject: "Confirmed: haircut Saturday 11am",
    fromName: "Fold Salon",
    fromEmail: "bookings@foldsalon.example.com",
    daysAgo: 2,
    body: `You're booked with Sam on Saturday at 11:00 AM. See you then!

Cancellations within 24 hours are charged 50%.`,
    bucket: "appointment",
    expected: [],
    rationale:
      "A confirmed appointment with no preparation and nothing outstanding. Expected: no loop. Extracting 'attend haircut' is a false positive.",
  },
  {
    id: "ap-04",
    subject: "Vehicle inspection due before registration renewal",
    fromName: "State DMV",
    fromEmail: "noreply@dmv.example.gov",
    daysAgo: 7,
    body: `Registration for plate 7KQL882 expires March 31, 2026.

A passing safety inspection completed within 90 days of renewal is required before
you can renew. Our records show no inspection on file.`,
    bucket: "appointment",
    expected: [
      {
        key: "vehicle-inspection",
        category: "appointment_prep",
        match: ["inspection", "vehicle", "safety"],
        dueDate: "2026-03-31",
        dueDateBasis: "inferred",
        evidenceHint: "required before you can renew",
      },
      {
        key: "registration-renewal",
        category: "renewal",
        match: ["registration", "renew"],
        dueDate: "2026-03-31",
        dueDateBasis: "explicit",
        evidenceHint: "expires March 31, 2026",
      },
    ],
    rationale:
      "Two obligations: book the inspection, and renew the registration. A system that returns only one is a partial miss.",
  },
  {
    id: "ap-05",
    subject: "Your interview is confirmed for March 9",
    fromName: "People Ops",
    fromEmail: "peopleops@brightwater.example.com",
    daysAgo: 4,
    body: `Confirmed: panel interview Monday March 9 at 1:00 PM, remote.

Ahead of the session please send a 10-minute portfolio walkthrough to the panel and
confirm you can present in this format.`,
    bucket: "appointment",
    expected: [
      {
        key: "portfolio-walkthrough",
        category: "appointment_prep",
        match: ["portfolio", "walkthrough", "interview"],
        dueDate: "2026-03-09",
        dueDateBasis: "inferred",
        evidenceHint: "Ahead of the session please send",
      },
    ],
    rationale: "Real prep obligation before a dated event.",
  },
  {
    id: "ap-06",
    subject: "School parent-teacher conference sign-up",
    fromName: "Maple Grove Elementary",
    fromEmail: "office@maplegrove.example.edu",
    daysAgo: 6,
    body: `Conference week is March 23-27. Sign-up closes March 13 and unclaimed slots are
assigned automatically.

Sign up: https://maplegrove.example.edu/conferences`,
    bucket: "appointment",
    expected: [
      {
        key: "conference-signup",
        category: "reservation",
        match: ["conference", "sign up", "slot", "signup"],
        dueDate: "2026-03-13",
        dueDateBasis: "explicit",
        evidenceHint: "Sign-up closes March 13",
      },
    ],
    rationale: "Booking action with a stated cutoff.",
  },
  {
    id: "ap-07",
    subject: "Rescheduled: your service window",
    fromName: "Kestrel Utilities",
    fromEmail: "service@kestrelutilities.example.com",
    daysAgo: 1,
    body: `Your technician visit has been moved to March 6 between 8am and 12pm.

Someone over 18 must be present. Reply RESCHEDULE if that window doesn't work.`,
    bucket: "appointment",
    expected: [
      {
        key: "service-window",
        category: "appointment_prep",
        match: ["technician", "service", "present", "window"],
        dueDate: "2026-03-06",
        dueDateBasis: "explicit",
        evidenceHint: "Someone over 18 must be present",
      },
    ],
    rationale:
      "Borderline but defensible: the user must arrange presence. Marked expected so a miss is visible; a reasonable system could also skip it.",
  },
  {
    id: "ap-08",
    subject: "Thanks for coming in",
    fromName: "Northgate Dermatology",
    fromEmail: "reception@northgatederm.example.com",
    daysAgo: 15,
    body: `Thanks for visiting us. Your results will be posted to the patient portal within
7-10 business days. No action is needed from you.

If you have questions, call the office.`,
    bucket: "appointment",
    expected: [],
    rationale: "Explicitly says no action needed. Expected: no loop.",
  },

  // -------------------------------------------------------------------- forms
  {
    id: "fm-01",
    subject: "Incomplete: your background check authorization",
    fromName: "Verified Screening",
    fromEmail: "noreply@verifiedscreening.example.com",
    daysAgo: 4,
    body: `Your background check cannot proceed. The authorization form is missing your
signature and date of birth.

Requests not completed within 14 days of initiation (February 24, 2026) are
cancelled and must be restarted by the employer.`,
    bucket: "form",
    expected: [
      {
        key: "background-auth",
        category: "form",
        match: ["background", "authorization", "form", "signature"],
        dueDate: "2026-03-10",
        dueDateBasis: "inferred",
        evidenceHint: "within 14 days of initiation",
      },
    ],
    rationale: "Feb 24 + 14 days = Mar 10. Computable, inferred.",
  },
  {
    id: "fm-02",
    subject: "FSA claim documentation required",
    fromName: "Benefit Administrators",
    fromEmail: "claims@benefitadmin.example.com",
    daysAgo: 9,
    body: `We need an itemized receipt for FSA claim #FSA-9921 ($240.00).

Unsubstantiated claims are offset against future reimbursements after 60 days.`,
    bucket: "form",
    expected: [
      {
        key: "fsa-receipt",
        category: "form",
        match: ["fsa", "receipt", "claim", "documentation"],
        dueDate: null,
        dueDateBasis: "none",
        evidenceHint: "We need an itemized receipt",
      },
    ],
    rationale:
      "60 days from an unstated start — not computable, so no date. Inventing one is an error.",
  },
  {
    id: "fm-03",
    subject: "Please complete your I-9 verification",
    fromName: "HR Onboarding",
    fromEmail: "onboarding@brightwater.example.com",
    daysAgo: 2,
    body: `Federal law requires Section 1 of Form I-9 to be completed no later than your first
day of employment, which is March 16, 2026.

You will also need to present original identity documents in person.`,
    bucket: "form",
    expected: [
      {
        key: "i9-section1",
        category: "form",
        match: ["i-9", "i9", "verification", "section 1"],
        dueDate: "2026-03-16",
        dueDateBasis: "explicit",
        evidenceHint: "no later than your first day of employment",
      },
    ],
    rationale: "Stated date tied to a stated event.",
  },
  {
    id: "fm-04",
    subject: "Annual security training overdue",
    fromName: "Compliance",
    fromEmail: "compliance@yourcompany.example.com",
    daysAgo: 13,
    body: `Your annual security awareness training was due February 15, 2026 and is now
overdue.

Accounts with training more than 30 days overdue lose VPN access automatically.`,
    bucket: "form",
    expected: [
      {
        key: "security-training",
        category: "deadline",
        match: ["security", "training", "complete"],
        dueDate: "2026-02-15",
        dueDateBasis: "explicit",
        evidenceHint: "due February 15, 2026",
      },
    ],
    rationale: "Already overdue. Correct behaviour is to keep the past date and rank it high.",
  },
  {
    id: "fm-05",
    subject: "Census of agriculture — response required by law",
    fromName: "Statistics Bureau",
    fromEmail: "noreply@statistics.example.gov",
    daysAgo: 11,
    body: `Your response to the 2026 Census of Agriculture is required by law.

Please complete the questionnaire online using code 88-2213 by March 25, 2026.`,
    bucket: "form",
    expected: [
      {
        key: "ag-census",
        category: "form",
        match: ["census", "questionnaire", "complete"],
        dueDate: "2026-03-25",
        dueDateBasis: "explicit",
        evidenceHint: "by March 25, 2026",
      },
    ],
    rationale: "Automated .gov sender with a genuine legal obligation — must survive the prefilter.",
  },
  {
    id: "fm-06",
    subject: "Direct deposit form on file is outdated",
    fromName: "Payroll",
    fromEmail: "payroll@yourcompany.example.com",
    daysAgo: 5,
    body: `The bank account on your direct deposit form was closed by the issuing bank.

Submit an updated form before the next payroll cut-off or your March 15 paycheck
will be issued as a physical cheque to your address on file.`,
    bucket: "form",
    expected: [
      {
        key: "direct-deposit",
        category: "form",
        match: ["direct deposit", "form", "bank", "update"],
        dueDate: null,
        dueDateBasis: "none",
        evidenceHint: "before the next payroll cut-off",
      },
    ],
    rationale:
      "The cut-off date is never stated; March 15 is the pay date, not the deadline. dueAt = 2026-03-15 is a date error.",
  },
  {
    id: "fm-07",
    subject: "Your prescription needs a new authorization",
    fromName: "Meadow Pharmacy",
    fromEmail: "rx@meadowpharmacy.example.com",
    daysAgo: 3,
    body: `Prescription #RX-40218 requires prior authorization from your insurer before it can
be filled. We have faxed the request to Dr. Alvarez.

You may want to call your insurer to check status — these often stall without a
patient nudge. Current supply typically runs out in about a week.`,
    bucket: "form",
    expected: [
      {
        key: "rx-prior-auth",
        category: "follow_up",
        match: ["prescription", "authorization", "insurer"],
        dueDate: null,
        dueDateBasis: "none",
        evidenceHint: "call your insurer to check status",
      },
    ],
    rationale:
      "Suggested rather than required action, but real and time-sensitive. 'About a week' is too vague for a date.",
  },
];
