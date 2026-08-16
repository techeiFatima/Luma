import { z } from "zod";
import { LOOP_CATEGORIES } from "../loops/taxonomy";

/**
 * The contract between the model and the rest of the application.
 *
 * There are two representations of it and they must stay in sync:
 *  - `extractionJsonSchema` is sent to the API as a structured-output format,
 *    so the model is constrained to emit exactly this shape.
 *  - `extractionResultSchema` re-validates the response with Zod. Structured
 *    outputs make malformed JSON very unlikely, but the application state this
 *    feeds is important enough that we never trust the wire format blindly.
 */

const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] } as const;

export const extractionJsonSchema = {
  type: "object",
  properties: {
    loops: {
      type: "array",
      description:
        "Open Loops found in these messages. Return an empty array when there is nothing genuinely unfinished.",
      items: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description:
              "Short imperative label naming the specific thing left to do, e.g. 'Renew professional license'.",
          },
          summary: {
            type: "string",
            description:
              "One or two sentences on what is unfinished and what resolving it involves.",
          },
          category: { type: "string", enum: [...LOOP_CATEGORIES] },
          requires_user_action: {
            type: "boolean",
            description:
              "True only when the user themselves must do something. False for FYI, or when someone else owes the next step.",
          },
          confidence: {
            type: "number",
            description:
              "0.0-1.0 confidence that this is a real, still-open obligation for the user.",
          },
          consequence: {
            type: "string",
            enum: ["high", "medium", "low"],
            description: "How costly it would be for the user to miss this.",
          },
          due_date: {
            ...nullableString,
            description:
              "YYYY-MM-DD, or null when no date applies. Never guess a date to fill this in.",
          },
          due_date_basis: {
            type: "string",
            enum: ["explicit", "inferred", "none"],
            description:
              "'explicit' only when the source states the date. 'inferred' when you derived it. 'none' when there is no date.",
          },
          due_date_evidence: {
            ...nullableString,
            description:
              "Verbatim quote from the source stating the date. Required when due_date_basis is 'explicit'.",
          },
          counterparty_name: nullableString,
          counterparty_email: nullableString,
          amount_minor: {
            anyOf: [{ type: "integer" }, { type: "null" }],
            description: "Amount in minor units (cents) when money is involved, else null.",
          },
          amount_currency: {
            ...nullableString,
            description: "ISO 4217 code, e.g. 'USD'. Null when there is no amount.",
          },
          evidence: {
            type: "array",
            description:
              "At least one verbatim quote from the source supporting this loop. Quotes must be copied exactly.",
            items: {
              type: "object",
              properties: {
                source_id: {
                  type: "string",
                  description: "The [source_id] of the message the quote comes from.",
                },
                quote: {
                  type: "string",
                  description: "Exact substring of that message's text. Do not paraphrase.",
                },
              },
              required: ["source_id", "quote"],
              additionalProperties: false,
            },
          },
          inference_notes: {
            type: "string",
            description:
              "Plainly separate what the source states from what you inferred. Empty string if everything is stated.",
          },
        },
        required: [
          "title",
          "summary",
          "category",
          "requires_user_action",
          "confidence",
          "consequence",
          "due_date",
          "due_date_basis",
          "due_date_evidence",
          "counterparty_name",
          "counterparty_email",
          "amount_minor",
          "amount_currency",
          "evidence",
          "inference_notes",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["loops"],
  additionalProperties: false,
} as const;

export const evidenceSchema = z.object({
  source_id: z.string().min(1),
  quote: z.string().min(1),
});

export const candidateLoopSchema = z.object({
  title: z.string().min(1).max(160),
  summary: z.string().min(1).max(600),
  category: z.enum(LOOP_CATEGORIES),
  requires_user_action: z.boolean(),
  // The JSON schema cannot express numeric bounds, so clamp here instead of rejecting.
  confidence: z.number().transform((value) => Math.min(1, Math.max(0, value))),
  consequence: z.enum(["high", "medium", "low"]),
  due_date: z.string().nullable(),
  due_date_basis: z.enum(["explicit", "inferred", "none"]),
  due_date_evidence: z.string().nullable(),
  counterparty_name: z.string().nullable(),
  counterparty_email: z.string().nullable(),
  amount_minor: z.number().int().nullable(),
  amount_currency: z.string().nullable(),
  evidence: z.array(evidenceSchema),
  inference_notes: z.string(),
});

export const extractionResultSchema = z.object({
  loops: z.array(candidateLoopSchema),
});

export type CandidateLoop = z.infer<typeof candidateLoopSchema>;
export type ExtractionResult = z.infer<typeof extractionResultSchema>;
