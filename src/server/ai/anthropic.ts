import Anthropic from "@anthropic-ai/sdk";
import { requireAnthropic } from "@/lib/env";
import { logger } from "@/lib/logger";

const log = logger("ai.client");

let cached: Anthropic | null = null;

export function anthropicClient(): Anthropic {
  if (!cached) {
    const { apiKey } = requireAnthropic();
    cached = new Anthropic({ apiKey });
  }
  return cached;
}

export type Effort = NonNullable<Anthropic.OutputConfig["effort"]>;

const EFFORT_LEVELS: readonly Effort[] = ["low", "medium", "high", "xhigh", "max"];

function resolveEffort(requested: string | undefined): Effort {
  const value = requested ?? process.env.LUMA_EFFORT ?? "high";
  return (EFFORT_LEVELS as readonly string[]).includes(value) ? (value as Effort) : "high";
}

export interface StructuredCallOptions {
  system: string;
  userPrompt: string;
  jsonSchema: Record<string, unknown>;
  maxTokens?: number;
  /** "low" | "medium" | "high" | "xhigh" | "max". Defaults to LUMA_EFFORT or "high". */
  effort?: string;
}

export interface StructuredCallResult {
  /** Raw JSON text from the model. Null when the model declined to answer. */
  text: string | null;
  stopReason: string | null;
  refusal: { category: string | null; explanation: string | null } | null;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
}

/**
 * One structured call to the model, with the numbers we need for observability.
 *
 * The model is constrained to `jsonSchema` via structured outputs, so the
 * response body is JSON by construction rather than by parsing prose — this is
 * what lets the rest of the app treat extraction as a typed function call.
 */
export async function callStructured(
  options: StructuredCallOptions,
): Promise<StructuredCallResult> {
  const { model } = requireAnthropic();
  const client = anthropicClient();
  const startedAt = Date.now();

  const response = await client.messages.create({
    model,
    // Generous headroom: thinking is on by default on this model and shares
    // the budget with the response body.
    max_tokens: options.maxTokens ?? 16_000,
    system: options.system,
    thinking: { type: "adaptive" },
    output_config: {
      effort: resolveEffort(options.effort),
      format: { type: "json_schema", schema: options.jsonSchema },
    },
    messages: [{ role: "user", content: options.userPrompt }],
  });

  const latencyMs = Date.now() - startedAt;

  // Always check stop_reason before reading content: a refusal returns HTTP 200
  // with empty or partial content.
  if (response.stop_reason === "refusal") {
    const details = response.stop_details;
    log.warn("model declined the request", { category: details?.category ?? null });
    return {
      text: null,
      stopReason: response.stop_reason,
      refusal: {
        category: details?.category ?? null,
        explanation: details?.explanation ?? null,
      },
      model: response.model,
      inputTokens: response.usage?.input_tokens ?? null,
      outputTokens: response.usage?.output_tokens ?? null,
      latencyMs,
    };
  }

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  if (response.stop_reason === "max_tokens") {
    log.warn("response hit max_tokens; output may be truncated", { latencyMs });
  }

  return {
    text: text.length > 0 ? text : null,
    stopReason: response.stop_reason ?? null,
    refusal: null,
    model: response.model,
    inputTokens: response.usage?.input_tokens ?? null,
    outputTokens: response.usage?.output_tokens ?? null,
    latencyMs,
  };
}
