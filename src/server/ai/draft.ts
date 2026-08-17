import { z } from "zod";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { callStructured } from "./anthropic";

const log = logger("ai.draft");

/**
 * Writing a reply the user will review.
 *
 * This is the second and only other place Luma calls a model, and the contrast
 * with extraction is deliberate. Extraction produces application state, so its
 * output is verified line by line and mostly thrown away. A draft produces
 * words for a human to read, edit, and decide about — the user is the
 * verification step, which is exactly why nothing here is capable of sending.
 *
 * It runs only when someone has clicked to approve a draft, so cost is
 * bounded by explicit intent rather than by inbox size.
 */

export const DRAFT_PROMPT_VERSION = "draft-reply/v1";

const SYSTEM_PROMPT = `You write short email replies on behalf of a busy person.

You are given an obligation the person has not yet dealt with, and the message that created it. Write the reply they would send.

Rules:
- Write as the person replying, in first person. Never write as an assistant, and never mention that this was drafted for them.
- Be brief. Two to five sentences. A real person writing between meetings, not a formal letter.
- Match the register of the original message: warm with a colleague or friend, plainer with an institution.
- Only commit to what the source supports. If a date is not in the source, do not invent one — say you will follow up rather than name a day you cannot verify.
- Do not invent facts, attachments, order numbers, or names that are not in the source.
- If the obligation cannot honestly be answered without information you do not have, write a short reply that says so and asks for what is needed.
- No subject-line clichés ("Touching base", "Circling back"). No em-dash-heavy prose. No sign-off block; a first name is enough.`;

const draftSchema = z.object({
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(4000),
});

const draftJsonSchema = {
  type: "object",
  properties: {
    subject: { type: "string", description: "Reply subject line. Keep the original with Re: unless a fresh one reads better." },
    body: { type: "string", description: "The reply text. Two to five sentences." },
  },
  required: ["subject", "body"],
  additionalProperties: false,
} as const;

export interface DraftRequest {
  userId: string;
  loopTitle: string;
  loopSummary: string;
  recipientName: string | null;
  sourceSubject: string | null;
  sourceFrom: string | null;
  sourceBody: string | null;
}

export interface Draft {
  subject: string;
  body: string;
}

/** Keeps a very long thread from dominating the prompt. */
const MAX_SOURCE_CHARS = 4_000;

export async function draftReply(request: DraftRequest): Promise<Draft> {
  const lines = [
    `The person needs to: ${request.loopTitle}`,
    `Context: ${request.loopSummary}`,
    "",
  ];

  if (request.sourceBody) {
    lines.push(
      "They are replying to this message:",
      `From: ${request.sourceFrom ?? "unknown"}`,
      `Subject: ${request.sourceSubject ?? "(no subject)"}`,
      "",
      request.sourceBody.slice(0, MAX_SOURCE_CHARS),
    );
  } else {
    lines.push("No original message is available; write a short note that opens the topic.");
  }

  if (request.recipientName) {
    lines.push("", `Address them as ${request.recipientName}.`);
  }

  const started = Date.now();
  const result = await callStructured({
    system: SYSTEM_PROMPT,
    userPrompt: lines.join("\n"),
    jsonSchema: draftJsonSchema as unknown as Record<string, unknown>,
    maxTokens: 2_000,
  });

  await prisma.aiRun.create({
    data: {
      userId: request.userId,
      stage: "draft_reply",
      model: result.model,
      promptVersion: DRAFT_PROMPT_VERSION,
      status: result.text ? "ok" : "error",
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      latencyMs: Date.now() - started,
      candidatesProposed: result.text ? 1 : 0,
      error: result.text ? null : (result.refusal?.category ?? "no content returned"),
    },
  });

  if (!result.text) {
    throw new Error(
      result.refusal
        ? `the model declined to write this draft (${result.refusal.category ?? "unspecified"})`
        : "the model returned nothing",
    );
  }

  const parsed = draftSchema.safeParse(JSON.parse(result.text));
  if (!parsed.success) {
    log.warn("draft failed validation", { issues: parsed.error.issues.length });
    throw new Error("the draft came back in an unexpected shape");
  }

  return parsed.data;
}
