import type { EvalEmail } from "../types";

/**
 * Money and goods: renewals, payments, returns.
 *
 * This is where auto-renewal notices live, which are the trickiest of the
 * "positive" cases — a subscription that renews automatically may be no
 * obligation at all unless the user wants to stop it.
 */
export const TRANSACTION_EMAILS: EvalEmail[] = [
  // ---------------------------------------------------------------- renewals
  {
    id: "rn-01",
    subject: "Your domain expires in 14 days",
    fromName: "Registrar",
    fromEmail: "renewals@registrar.example.com",
    daysAgo: 4,
    body: `The domain yourproject.example expires on March 15, 2026.

Auto-renew is DISABLED for this domain. If it is not renewed by the expiry date it
enters a redemption period with a $180 restoration fee, and after 30 days it is
released publicly.`,
    bucket: "renewal",
    expected: [
      {
        key: "domain-renew",
        category: "renewal",
        match: ["domain", "renew", "expire"],
        dueDate: "2026-03-15",
        dueDateBasis: "explicit",
        evidenceHint: "expires on March 15, 2026",
      },
    ],
    rationale: "Auto-renew off + hard consequence = genuine obligation with a stated date.",
  },
  {
    id: "rn-02",
    subject: "Your subscription renews on March 20",
    fromName: "Atlas Analytics",
    fromEmail: "billing@atlasanalytics.example.com",
    daysAgo: 5,
    body: `Your Atlas Analytics Pro annual subscription renews automatically on March 20, 2026
and the card ending 4412 will be charged $240.00.

No action is required. You can change or cancel your plan from billing settings at
any time before the renewal date.`,
    bucket: "renewal",
    expected: [],
    rationale:
      "Auto-renewal that explicitly requires no action. This is the single most common false positive in this category — expected: no loop.",
  },
  {
    id: "rn-03",
    subject: "Professional licence renewal window is open",
    fromName: "State Licensing Board",
    fromEmail: "noreply@licensing.example.gov",
    daysAgo: 6,
    body: `Licence #PL-88213 expires March 31, 2026.

To remain in good standing you must complete 12 hours of continuing education and
submit the renewal form with the $180 fee before March 31, 2026. Licences not
renewed by that date are placed in inactive status.`,
    bucket: "renewal",
    expected: [
      {
        key: "licence-renew",
        category: "renewal",
        match: ["licence", "license", "renew"],
        dueDate: "2026-03-31",
        dueDateBasis: "explicit",
        evidenceHint: "before March 31, 2026",
      },
    ],
    rationale:
      "Automated .gov sender with a real obligation. Amount $180 = 18000 minor units. Must survive the prefilter.",
  },
  {
    id: "rn-04",
    subject: "Home insurance policy up for renewal",
    fromName: "Harborview Insurance",
    fromEmail: "policies@harborview.example.com",
    daysAgo: 10,
    body: `Policy HP-22190 renews on April 12, 2026 at $1,412/year, up from $1,140.

If you want to shop around or adjust coverage, changes must be requested at least
14 days before the renewal date. Otherwise the policy renews at the new rate.`,
    bucket: "renewal",
    expected: [
      {
        key: "insurance-review",
        category: "renewal",
        match: ["insurance", "policy", "renew", "coverage"],
        dueDate: "2026-03-29",
        dueDateBasis: "inferred",
        evidenceHint: "at least 14 days before the renewal date",
      },
    ],
    rationale:
      "Auto-renews, but a 23% increase plus a change window makes a review action genuine. Deadline = Apr 12 - 14d = Mar 29, inferred.",
  },
  {
    id: "rn-05",
    subject: "Membership expired",
    fromName: "Riverside Climbing",
    fromEmail: "members@riversideclimb.example.com",
    daysAgo: 14,
    body: `Your membership lapsed on February 15, 2026.

Lapsed members can reactivate at the old rate within 60 days; after that the current
rate applies and a $50 joining fee is reinstated.`,
    bucket: "renewal",
    expected: [
      {
        key: "gym-reactivate",
        category: "renewal",
        match: ["membership", "reactivate", "lapsed"],
        dueDate: "2026-04-16",
        dueDateBasis: "inferred",
        evidenceHint: "reactivate at the old rate within 60 days",
      },
    ],
    rationale:
      "Optional but real, with a computable cutoff (Feb 15 + 60d = Apr 16). Low consequence.",
  },
  {
    id: "rn-06",
    subject: "SSL certificate expiring",
    fromName: "Certificate Authority",
    fromEmail: "noreply@certauthority.example.com",
    daysAgo: 2,
    body: `The certificate for api.yourproject.example expires on March 11, 2026 at 23:59 UTC.

Automated renewal via ACME failed on the last three attempts (DNS challenge
timeout). Manual intervention is required.`,
    bucket: "renewal",
    expected: [
      {
        key: "ssl-cert",
        category: "renewal",
        match: ["certificate", "ssl", "renew", "expire"],
        dueDate: "2026-03-11",
        dueDateBasis: "explicit",
        evidenceHint: "expires on March 11, 2026",
      },
    ],
    rationale: "Automation failed, so a human must act. Stated date.",
  },
  {
    id: "rn-07",
    subject: "Your free trial ends in 3 days",
    fromName: "Northwind Tools",
    fromEmail: "hello@northwindtools.example.com",
    daysAgo: 1,
    body: `Your 14-day trial ends on March 3, 2026. After that your card will be charged
$49/month unless you cancel.

We'd love to have you stay!`,
    bucket: "renewal",
    expected: [
      {
        key: "trial-decision",
        category: "renewal",
        match: ["trial", "cancel", "charge"],
        dueDate: "2026-03-03",
        dueDateBasis: "explicit",
        evidenceHint: "ends on March 3, 2026",
      },
    ],
    rationale:
      "Trial-to-paid conversion needs a decision before a stated date — unlike rn-02, inaction has a cost.",
  },
  {
    id: "rn-08",
    subject: "Annual report filing due for your LLC",
    fromName: "Secretary of State",
    fromEmail: "noreply@sos.example.gov",
    daysAgo: 8,
    body: `Entity #LLC-772211 must file its annual report by April 1, 2026.

The filing fee is $75. Entities that fail to file are administratively dissolved
after 90 days.`,
    bucket: "renewal",
    expected: [
      {
        key: "llc-annual-report",
        category: "renewal",
        match: ["annual report", "file", "llc"],
        dueDate: "2026-04-01",
        dueDateBasis: "explicit",
        evidenceHint: "by April 1, 2026",
      },
    ],
    rationale: "Statutory filing with a stated date and a severe consequence.",
  },

  // ---------------------------------------------------------------- payments
  {
    id: "py-01",
    subject: "Invoice 4471 is overdue",
    fromName: "Cedar Contracting",
    fromEmail: "accounts@cedarcontracting.example.com",
    daysAgo: 6,
    body: `Invoice 4471 for $3,150.00 was due February 20, 2026 and remains unpaid.

Late fees of 1.5% per month begin accruing after 30 days past due.`,
    bucket: "payment",
    expected: [
      {
        key: "invoice-4471",
        category: "payment",
        match: ["invoice", "4471", "pay", "overdue"],
        dueDate: "2026-02-20",
        dueDateBasis: "explicit",
        evidenceHint: "due February 20, 2026",
      },
    ],
    rationale: "Overdue payment, stated original due date, amount $3,150.00 = 315000 minor units.",
  },
  {
    id: "py-02",
    subject: "Property tax second instalment",
    fromName: "County Treasurer",
    fromEmail: "noreply@treasurer.example.gov",
    daysAgo: 12,
    body: `The second instalment of your 2025-2026 property tax, $2,847.00, is due
April 10, 2026.

A 10% penalty plus $30 cost is added to instalments not received by the delinquency
date.`,
    bucket: "payment",
    expected: [
      {
        key: "property-tax",
        category: "payment",
        match: ["property tax", "instalment", "installment", "pay"],
        dueDate: "2026-04-10",
        dueDateBasis: "explicit",
        evidenceHint: "due April 10, 2026",
      },
    ],
    rationale: "Stated date, stated amount, real penalty.",
  },
  {
    id: "py-03",
    subject: "Payment failed — action needed",
    fromName: "Cloudscale",
    fromEmail: "billing@cloudscale.example.com",
    daysAgo: 2,
    body: `We could not charge your card for the February invoice ($318.40). The card was
declined (insufficient funds).

We will retry twice more. If payment is not received within 7 days, services are
suspended.`,
    bucket: "payment",
    expected: [
      {
        key: "cloudscale-payment",
        category: "payment",
        match: ["payment", "card", "failed", "declined"],
        dueDate: "2026-03-06",
        dueDateBasis: "inferred",
        evidenceHint: "within 7 days",
      },
    ],
    rationale: "Feb 27 + 7 days = Mar 6, computable from the send date. Inferred.",
  },
  {
    id: "py-04",
    subject: "Receipt for your payment — $42.30",
    fromName: "Corner Grocery",
    fromEmail: "receipts@cornergrocery.example.com",
    daysAgo: 2,
    body: `Thanks for shopping with us. Your card ending 4412 was charged $42.30 on
February 27, 2026.

No action needed. This is a receipt for your records.`,
    bucket: "payment",
    expected: [],
    rationale: "A completed transaction. Expected: no loop.",
  },
  {
    id: "py-05",
    subject: "Your statement is ready",
    fromName: "Meridian Card Services",
    fromEmail: "statements@meridiancard.example.com",
    daysAgo: 7,
    body: `Your February statement is available. Balance: $1,204.55. Minimum payment: $35.00.
Payment due date: March 22, 2026.

Autopay is ON for the statement balance. No action is needed.`,
    bucket: "payment",
    expected: [],
    rationale:
      "Autopay covers the full balance and the email says no action needed. A due date is present but there is no obligation — a classic trap.",
  },
  {
    id: "py-06",
    subject: "Rent increase effective April 1",
    fromName: "Brookline Property Management",
    fromEmail: "tenants@brooklinepm.example.com",
    daysAgo: 9,
    body: `Effective April 1, 2026, monthly rent for unit 4B increases from $2,100 to $2,205.

Please update any standing bank transfer before the April payment. Payments short of
the full amount are treated as partial and may incur a late fee.`,
    bucket: "payment",
    expected: [
      {
        key: "update-rent-transfer",
        category: "payment",
        match: ["rent", "transfer", "update", "standing"],
        dueDate: "2026-04-01",
        dueDateBasis: "inferred",
        evidenceHint: "update any standing bank transfer",
      },
    ],
    rationale: "Real user action (update the transfer) tied to the April 1 effective date.",
  },
  {
    id: "py-07",
    subject: "Final demand before collections",
    fromName: "Metro Medical Billing",
    fromEmail: "billing@metromedical.example.com",
    daysAgo: 4,
    body: `Account 99-4412 has an outstanding balance of $612.00 from a visit on
November 8, 2025.

This is a final demand. Balances not resolved within 15 days of this notice are
referred to a collections agency and may be reported to credit bureaus.`,
    bucket: "payment",
    expected: [
      {
        key: "medical-balance",
        category: "payment",
        match: ["balance", "medical", "pay", "collections"],
        dueDate: "2026-03-11",
        dueDateBasis: "inferred",
        evidenceHint: "within 15 days of this notice",
      },
    ],
    rationale: "Feb 25 + 15 days = Mar 11. High consequence (credit reporting).",
  },
  {
    id: "py-08",
    subject: "Split the ski trip costs?",
    fromName: "Nadia Farouk",
    fromEmail: "nadia.farouk@example.com",
    daysAgo: 5,
    body: `Hey! I fronted the cabin deposit — your share comes to $215.

No rush at all, whenever is fine. My details are the same as last time.`,
    bucket: "payment",
    expected: [
      {
        key: "ski-share",
        category: "payment",
        match: ["ski", "cabin", "share", "215"],
        dueDate: null,
        dueDateBasis: "none",
        evidenceHint: "your share comes to $215",
      },
    ],
    rationale: "Genuine personal debt, explicitly no deadline. dueAt must be null.",
  },

  // ----------------------------------------------------------------- returns
  {
    id: "rt-01",
    subject: "Your return window closes March 2",
    fromName: "Meridian Outfitters",
    fromEmail: "orders@meridian.example.com",
    daysAgo: 9,
    body: `You started a return for the Trailhead jacket (order #A7741) but the package hasn't
been dropped off.

Returns must be postmarked within 30 days of delivery. Your window closes on
March 2, 2026. After that we can't issue a refund.`,
    bucket: "return",
    expected: [
      {
        key: "jacket-return",
        category: "return",
        match: ["return", "jacket", "a7741", "ship"],
        dueDate: "2026-03-02",
        dueDateBasis: "explicit",
        evidenceHint: "window closes on March 2, 2026",
      },
    ],
    rationale: "Started but incomplete return with a stated cutoff.",
  },
  {
    id: "rt-02",
    subject: "Refund issued for order #B2201",
    fromName: "Lumen Home",
    fromEmail: "support@lumenhome.example.com",
    daysAgo: 3,
    body: `We've received your return and issued a refund of $84.99 to your original payment
method. It should appear within 5-7 business days.

Nothing further is needed.`,
    bucket: "return",
    expected: [],
    rationale: "Return complete. Expected: no loop.",
  },
  {
    id: "rt-03",
    subject: "Exchange requires action: size unavailable",
    fromName: "Fieldstone Apparel",
    fromEmail: "returns@fieldstone.example.com",
    daysAgo: 5,
    body: `The size you requested for exchange on order #C9910 is out of stock.

Choose a different size or accept a refund within 10 days or we will process a
refund automatically at the end of that period.`,
    bucket: "return",
    expected: [
      {
        key: "exchange-choice",
        category: "return",
        match: ["exchange", "size", "refund", "choose"],
        dueDate: "2026-03-06",
        dueDateBasis: "inferred",
        evidenceHint: "within 10 days",
      },
    ],
    rationale:
      "Borderline: inaction has a default outcome, but choosing is a real action. Feb 24 + 10 = Mar 6.",
  },
  {
    id: "rt-04",
    subject: "Faulty item — we need photos",
    fromName: "Havenware",
    fromEmail: "support@havenware.example.com",
    daysAgo: 6,
    body: `Thanks for reporting the damaged shelf unit.

To process a replacement under warranty we need photos of the damage and the batch
code printed inside the left panel. Claims are closed if we don't hear back in
21 days.`,
    bucket: "return",
    expected: [
      {
        key: "warranty-photos",
        category: "return",
        match: ["photo", "damage", "warranty", "replacement"],
        dueDate: "2026-03-16",
        dueDateBasis: "inferred",
        evidenceHint: "we need photos of the damage",
      },
    ],
    rationale: "Feb 23 + 21 days = Mar 16.",
  },
  {
    id: "rt-05",
    subject: "Your rental equipment is overdue",
    fromName: "Summit Gear Rental",
    fromEmail: "rentals@summitgear.example.com",
    daysAgo: 3,
    body: `The avalanche beacon and probe rented on February 14 were due back February 24.

Late fees accrue at $15/day. Please return them to any branch.`,
    bucket: "return",
    expected: [
      {
        key: "return-gear",
        category: "return",
        match: ["return", "beacon", "equipment", "rental"],
        dueDate: "2026-02-24",
        dueDateBasis: "explicit",
        evidenceHint: "due back February 24",
      },
    ],
    rationale: "Already overdue with an accruing cost.",
  },
  {
    id: "rt-06",
    subject: "Library items due soon",
    fromName: "City Library",
    fromEmail: "noreply@citylibrary.example.org",
    daysAgo: 2,
    body: `The following items are due March 7, 2026:

  - "The Overstory" (renewed once, cannot be renewed again)
  - "Pattern Recognition"

Items more than 30 days overdue are billed at replacement cost.`,
    bucket: "return",
    expected: [
      {
        key: "library-return",
        category: "return",
        match: ["library", "return", "due", "book"],
        dueDate: "2026-03-07",
        dueDateBasis: "explicit",
        evidenceHint: "due March 7, 2026",
      },
    ],
    rationale:
      "Automated noreply@ sender with a genuine obligation — another prefilter survival test.",
  },
];
