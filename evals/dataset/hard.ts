import type { EvalEmail } from "../types";

/**
 * The cases that decide whether the product is actually good.
 *
 * Buckets:
 *  - ambiguous:           a reasonable person could argue either way
 *  - multi_obligation:    one email, several distinct loops
 *  - hallucination_bait:  urgency, dates, or numbers that must NOT become a
 *                         deadline, an amount, or an obligation
 *
 * The bait cases matter most. It is easy to build an extractor that finds
 * every real deadline; the hard part is one that does not invent them.
 */
export const HARD_EMAILS: EvalEmail[] = [
  // --------------------------------------------------------------- ambiguous
  {
    id: "am-01",
    threadId: "th-am-01",
    subject: "Re: coffee sometime?",
    fromName: "Priya Raman",
    fromEmail: "priya@northwind.example.com",
    daysAgo: 4,
    body: `Would be lovely to catch up properly. I'm around most of March — shout if a week
works better than another and I'll find a slot.`,
    bucket: "ambiguous",
    expected: [],
    rationale:
      "A social maybe. The ask ('shout if a week works') is real but trivial and open-ended; surfacing it dilutes the list. Expected: no loop.",
  },
  {
    id: "am-02",
    threadId: "th-am-02",
    subject: "Thoughts on the proposal?",
    fromName: "Hannah Weiss",
    fromEmail: "hannah@vector.example.com",
    daysAgo: 6,
    body: `Sent the revised proposal over last week. Curious what you think whenever you get
to it — we're not moving on anything until we hear back from you.`,
    bucket: "ambiguous",
    expected: [
      {
        key: "proposal-response",
        category: "unanswered_email",
        match: ["proposal", "respond", "reply", "feedback"],
        dueDate: null,
        dueDateBasis: "none",
        evidenceHint: "not moving on anything until we hear back",
      },
    ],
    rationale:
      "'Whenever you get to it' softens it, but the sender is explicitly blocked on the user. That makes it a real loop.",
  },
  {
    id: "am-03",
    subject: "Your table is confirmed — Friday 8pm",
    fromName: "Fern & Oak",
    fromEmail: "reservations@fernandoak.example.com",
    daysAgo: 3,
    body: `Table for 4, Friday March 6 at 8:00 PM, under Whitfield.

We hold tables for 15 minutes. If your party size changes, let us know 24 hours
ahead.`,
    bucket: "ambiguous",
    expected: [],
    rationale:
      "Confirmed booking with only a conditional action ('if your party size changes'). Conditional on something that hasn't happened is not an open loop.",
  },
  {
    id: "am-04",
    threadId: "th-am-04",
    subject: "Re: are you still interested in the role?",
    fromName: "Talent Partner",
    fromEmail: "recruiting@lattice.example.com",
    daysAgo: 5,
    body: `Following up on my note from two weeks ago. Completely fine either way — just let
me know if you'd like to keep talking or if I should close out your file.`,
    bucket: "ambiguous",
    expected: [
      {
        key: "recruiter-reply",
        category: "unanswered_email",
        match: ["recruiter", "role", "reply", "respond"],
        dueDate: null,
        dueDateBasis: "none",
        evidenceHint: "let me know if you'd like to keep talking",
      },
    ],
    rationale:
      "A direct binary question, twice asked, with a consequence (file closed). Real, low-stakes loop.",
  },
  {
    id: "am-05",
    subject: "Reminder: you have unused vacation days",
    fromName: "People Ops",
    fromEmail: "peopleops@yourcompany.example.com",
    daysAgo: 7,
    body: `Our records show 9 unused vacation days.

Up to 5 days carry over into the next year; the rest expire on December 31.`,
    bucket: "ambiguous",
    expected: [],
    rationale:
      "Ten months out, no action requested, no near-term consequence. Surfacing it now is noise even though it is technically time-bound.",
  },
  {
    id: "am-06",
    threadId: "th-am-06",
    subject: "Re: can you look at this when you have a sec",
    fromName: "Marcus Bell",
    fromEmail: "marcus@bellcapital.example.com",
    daysAgo: 11,
    body: `No rush on my end at all — send it over whenever it's ready and I'll give you notes.`,
    bucket: "ambiguous",
    expected: [],
    rationale:
      "The sender is waiting on the user, but the user has made no commitment and there is no ask with substance. Genuinely arguable; marked negative.",
  },
  {
    id: "am-07",
    subject: "Survey: how did we do?",
    fromName: "Support",
    fromEmail: "feedback@toolstack.example.com",
    daysAgo: 4,
    body: `You recently contacted support about billing. How did we do?

The survey takes 2 minutes and closes March 20.`,
    bucket: "ambiguous",
    expected: [],
    rationale: "Optional feedback survey. No consequence to ignoring it.",
  },
  {
    id: "am-08",
    threadId: "th-am-08",
    subject: "Re: are we still on for the 12th?",
    fromName: "Ines Vogel",
    fromEmail: "ines.vogel@brightpath.example.com",
    daysAgo: 2,
    body: `Just want to confirm before I book travel — are we still on for the 12th?

I need to book flights by Friday to get a sensible fare.`,
    bucket: "ambiguous",
    expected: [
      {
        key: "confirm-12th",
        category: "unanswered_email",
        match: ["confirm", "12th", "reply", "travel"],
        dueDate: "2026-03-06",
        dueDateBasis: "inferred",
        evidenceHint: "need to book flights by Friday",
      },
    ],
    rationale:
      "Direct question with a real cost to delay. Friday after Feb 27 = Mar 6. Inferred.",
  },

  // -------------------------------------------------------- multi-obligation
  {
    id: "mo-01",
    subject: "New tenancy — three things before move-in",
    fromName: "Brookline Property Management",
    fromEmail: "lettings@brooklinepm.example.com",
    daysAgo: 4,
    body: `Congratulations on the flat. Before we can hand over keys on March 28 we need:

  1. The signed tenancy agreement returned (attached) — by March 10.
  2. First month's rent and deposit, $4,410 total, cleared by March 21.
  3. Proof of contents insurance naming the landlord as an interested party.

Any of these outstanding on the 28th will delay handover.`,
    bucket: "multi_obligation",
    expected: [
      {
        key: "sign-tenancy",
        category: "form",
        match: ["tenancy", "agreement", "sign", "return"],
        dueDate: "2026-03-10",
        dueDateBasis: "explicit",
        evidenceHint: "by March 10",
      },
      {
        key: "rent-deposit",
        category: "payment",
        match: ["rent", "deposit", "pay"],
        dueDate: "2026-03-21",
        dueDateBasis: "explicit",
        evidenceHint: "cleared by March 21",
      },
      {
        key: "contents-insurance",
        category: "form",
        match: ["insurance", "contents", "proof"],
        dueDate: "2026-03-28",
        dueDateBasis: "inferred",
        evidenceHint: "Proof of contents insurance",
      },
    ],
    rationale:
      "Three genuinely separate obligations with different dates. Collapsing them into one loop loses two deadlines.",
  },
  {
    id: "mo-02",
    subject: "Onboarding checklist — week one",
    fromName: "HR Onboarding",
    fromEmail: "onboarding@brightwater.example.com",
    daysAgo: 3,
    body: `Welcome! Before your start date on March 16 please:

  - Complete the I-9 (Section 1) — required by law on or before day one
  - Enrol in benefits — you have 30 days from your start date
  - Return the signed equipment agreement

The equipment agreement is the one people forget; we can't ship your laptop
without it.`,
    bucket: "multi_obligation",
    expected: [
      {
        key: "i9",
        category: "form",
        match: ["i-9", "i9", "section 1"],
        dueDate: "2026-03-16",
        dueDateBasis: "explicit",
        evidenceHint: "on or before day one",
      },
      {
        key: "equipment-agreement",
        category: "form",
        match: ["equipment", "agreement", "sign"],
        dueDate: "2026-03-16",
        dueDateBasis: "inferred",
        evidenceHint: "Return the signed equipment agreement",
      },
      {
        key: "benefits-enrol",
        category: "form",
        match: ["benefit", "enrol", "enroll"],
        dueDate: "2026-04-15",
        dueDateBasis: "inferred",
        evidenceHint: "30 days from your start date",
      },
    ],
    rationale:
      "Three tasks with three different effective dates. Benefits = Mar 16 + 30d = Apr 15.",
  },
  {
    id: "mo-03",
    subject: "Audit findings — two items need your response",
    fromName: "Internal Audit",
    fromEmail: "audit@yourcompany.example.com",
    daysAgo: 5,
    body: `The Q1 access review raised two findings assigned to you:

  A-114: 3 dormant service accounts require attestation or removal. Due March 13.
  A-118: The quarterly access matrix has not been signed off since November.
         Due at quarter end.

Findings not closed by the due date are escalated to the risk committee.`,
    bucket: "multi_obligation",
    expected: [
      {
        key: "dormant-accounts",
        category: "deadline",
        match: ["dormant", "service account", "attestation", "a-114"],
        dueDate: "2026-03-13",
        dueDateBasis: "explicit",
        evidenceHint: "Due March 13",
      },
      {
        key: "access-matrix",
        category: "deadline",
        match: ["access matrix", "sign", "a-118"],
        dueDate: "2026-03-31",
        dueDateBasis: "inferred",
        evidenceHint: "Due at quarter end",
      },
    ],
    rationale: "Two findings, two dates, one explicit and one derived ('quarter end' = Mar 31).",
  },
  {
    id: "mo-04",
    subject: "Trip logistics: passport, insurance, and the deposit",
    fromName: "Nadia Farouk",
    fromEmail: "nadia.farouk@example.com",
    daysAgo: 6,
    body: `Quick round-up before Patagonia:

The tour company needs the balance (£840 each) by April 4. They also want passport
numbers for the permits — I've sent mine, still need yours.

And you said you'd sort travel insurance for the group. Still happening?`,
    bucket: "multi_obligation",
    expected: [
      {
        key: "tour-balance",
        category: "payment",
        match: ["balance", "tour", "pay"],
        dueDate: "2026-04-04",
        dueDateBasis: "explicit",
        evidenceHint: "by April 4",
      },
      {
        key: "passport-number",
        category: "follow_up",
        match: ["passport", "number", "send"],
        dueDate: null,
        dueDateBasis: "none",
        evidenceHint: "still need yours",
      },
      {
        key: "travel-insurance",
        category: "commitment",
        match: ["insurance", "travel", "group"],
        dueDate: null,
        dueDateBasis: "none",
        evidenceHint: "you said you'd sort travel insurance",
      },
    ],
    rationale:
      "Three obligations of three different kinds in one casual email, including a commitment the user made earlier.",
  },
  {
    id: "mo-05",
    subject: "Conference: two deadlines approaching",
    fromName: "Program Committee",
    fromEmail: "program@sysconf.example.org",
    daysAgo: 2,
    body: `As an accepted speaker:

  - Camera-ready paper is due March 18 (hard deadline, no extensions)
  - Speaker registration must be completed by March 25 or your slot is released

Slides are not needed until the week of the event.`,
    bucket: "multi_obligation",
    expected: [
      {
        key: "camera-ready",
        category: "deadline",
        match: ["camera-ready", "paper", "submit"],
        dueDate: "2026-03-18",
        dueDateBasis: "explicit",
        evidenceHint: "due March 18",
      },
      {
        key: "speaker-registration",
        category: "deadline",
        match: ["registration", "register", "speaker"],
        dueDate: "2026-03-25",
        dueDateBasis: "explicit",
        evidenceHint: "by March 25",
      },
    ],
    rationale:
      "Two hard deadlines. The slides sentence is a distractor and must NOT become a third loop.",
  },
  {
    id: "mo-06",
    subject: "Re: house sale — solicitor needs these",
    fromName: "Grantham & Co Solicitors",
    fromEmail: "conveyancing@granthamco.example.com",
    daysAgo: 7,
    body: `To keep exchange on track for the end of March we still need from you:

  - The completed property information form (TA6)
  - ID verification — in person or via the app
  - Confirmation of your mortgage offer (the lender should have sent it)

The first two are with you. The third we can chase if you'd prefer.`,
    bucket: "multi_obligation",
    expected: [
      {
        key: "ta6-form",
        category: "form",
        match: ["ta6", "property information", "form"],
        dueDate: "2026-03-31",
        dueDateBasis: "inferred",
        evidenceHint: "completed property information form",
      },
      {
        key: "id-verification",
        category: "form",
        match: ["id", "verification", "verify"],
        dueDate: "2026-03-31",
        dueDateBasis: "inferred",
        evidenceHint: "ID verification",
      },
    ],
    rationale:
      "Two items are explicitly the user's; the third is offered to be handled by the sender. Extracting the mortgage confirmation as a user loop is a false positive.",
  },

  // ------------------------------------------------------ hallucination bait
  {
    id: "hb-01",
    threadId: "th-hb-01",
    subject: "Re: quarterly planning",
    fromName: "Ravi Menon",
    fromEmail: "ravi@yourcompany.example.com",
    daysAgo: 3,
    body: `Good discussion today. To recap what we agreed:

Design is going to own the research synthesis and will circulate it by the 20th.
Ops will handle vendor renewal in April. Finance is locking the model on the 9th.

Nothing needed from you before the next session.`,
    bucket: "hallucination_bait",
    expected: [],
    rationale:
      "Dense with dates and commitments — all belonging to OTHER people, and it says so explicitly. Any loop here is a false positive.",
  },
  {
    id: "hb-02",
    subject: "Historical: your 2024 filing was accepted",
    fromName: "Revenue Service",
    fromEmail: "noreply@revenue.example.gov",
    daysAgo: 5,
    body: `Your 2024 return was accepted on April 12, 2025. Refund of $1,204 was issued
May 3, 2025.

Retain this notice for your records. Returns must generally be filed by April 15
of the following year.`,
    bucket: "hallucination_bait",
    expected: [],
    rationale:
      "Contains 'April 15' as a general rule and two past dates. None is an obligation for this user now. A system that creates 'File taxes by April 15' has hallucinated.",
  },
  {
    id: "hb-03",
    threadId: "th-hb-03",
    subject: "Re: thanks — all sorted",
    fromName: "Priya Raman",
    fromEmail: "priya@northwind.example.com",
    daysAgo: 2,
    body: `Ignore my last email — I found the comments in the shared folder. Section 4 and 7
look good, no changes needed.

Closing this out, thanks!`,
    bucket: "hallucination_bait",
    expected: [],
    rationale:
      "Explicitly resolves a prior request. Extracting 'send comments on sections 4 and 7' would be surfacing a closed loop.",
  },
  {
    id: "hb-04",
    subject: "Terms of service update",
    fromName: "Toolstack Legal",
    fromEmail: "legal@toolstack.example.com",
    daysAgo: 6,
    body: `We're updating our Terms of Service effective April 1, 2026.

Continued use of the service after that date constitutes acceptance. No action is
required from you.

Summary of changes | Full terms`,
    bucket: "hallucination_bait",
    expected: [],
    rationale:
      "A date plus legal language plus explicit 'no action required'. Classic bait for a fabricated deadline.",
  },
  {
    id: "hb-05",
    threadId: "th-hb-05",
    subject: "Re: I'll get that over to you",
    fromName: "Elena Duarte",
    fromEmail: "elena@pressfold.example.com",
    daysAgo: 4,
    body: `I'll send the marked-up manuscript by Friday and the contract early next week.

Sorry for the delay — travel week.`,
    bucket: "hallucination_bait",
    expected: [],
    rationale:
      "Two commitments with dates, both made by the SENDER. The user owes nothing. Attributing these to the user is the single most likely model error in this set.",
  },
  {
    id: "hb-06",
    subject: "Your flight itinerary",
    fromName: "Skyward Airlines",
    fromEmail: "itinerary@skyward.example.com",
    daysAgo: 8,
    body: `Booking XR44PQ confirmed.

Outbound March 22, 2026, 14:05, seat 21C. Return March 29, 2026, 09:40.

Check-in opens 24 hours before departure. Baggage allowance: 1 x 23kg.`,
    bucket: "hallucination_bait",
    expected: [],
    rationale:
      "Full of dates and a future action ('check-in opens'), but nothing is outstanding now. Creating a 'check in for flight' loop 3 weeks early is noise.",
  },
  {
    id: "hb-07",
    threadId: "th-hb-07",
    subject: "Re: budget question",
    fromName: "Finance",
    fromEmail: "finance@yourcompany.example.com",
    daysAgo: 3,
    body: `To answer your question: the cut-off for Q1 accruals is March 31, and anything
submitted after that lands in Q2.

You don't have anything outstanding — I checked. Just flagging the date in case it
matters for your planning.`,
    bucket: "hallucination_bait",
    expected: [],
    rationale:
      "A real date, explicitly confirmed as not applying to this user. Tests whether the model reads the disclaimer.",
  },
  {
    id: "hb-08",
    subject: "Estimated delivery updated",
    fromName: "Havenware",
    fromEmail: "orders@havenware.example.com",
    daysAgo: 2,
    body: `Your order #H2288 is delayed. New estimated delivery: March 30, 2026 (was March 12).

We're sorry for the delay. If you'd rather cancel, you can do so at any time before
it ships — no deadline, no fee.`,
    bucket: "hallucination_bait",
    expected: [],
    rationale:
      "Dates, a delay, and an option to cancel with explicitly no deadline. Nothing is required.",
  },
  {
    id: "hb-09",
    threadId: "th-hb-09",
    subject: "Re: the numbers you asked for",
    fromName: "Tomas Lindqvist",
    fromEmail: "tomas@yourcompany.example.com",
    daysAgo: 1,
    body: `Got them, thanks — that's everything I needed for the deck.

I'll present Thursday and send round the outcome after.`,
    bucket: "hallucination_bait",
    expected: [],
    rationale:
      "Resolves fu-01 in the same dataset. If both fu-01 and this appear, a correct system should not keep the Q2 numbers loop open — tests thread-level reasoning.",
  },
];
