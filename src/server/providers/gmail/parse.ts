import type { gmail_v1 } from "googleapis";
import type { NormalizedMessage } from "../types";

/** Bodies are truncated at ingestion — we never need the whole newsletter. */
export const MAX_BODY_CHARS = 12_000;

export function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

/**
 * Strips tags from an HTML part. Deliberately simple: the goal is readable text
 * for the model, not faithful rendering.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<head[\s\S]*?<\/head>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Removes quoted reply chains so the model sees what *this* message said.
 * Keeping the quoted history invites the model to re-extract loops that were
 * already handled several replies ago.
 */
export function stripQuotedReplies(text: string): string {
  const lines = text.split("\n");
  const cutMarkers = [
    /^On .+ wrote:$/,
    /^-{2,}\s*Original Message\s*-{2,}$/i,
    /^_{5,}$/,
    /^From:\s.+/i,
  ];
  const kept: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (cutMarkers.some((marker) => marker.test(trimmed))) break;
    if (trimmed.startsWith(">")) continue;
    kept.push(line);
  }
  const result = kept.join("\n").trim();
  // If stripping removed effectively everything, the heuristic misfired.
  return result.length > 0 ? result : text.trim();
}

/** Walks the MIME tree, preferring text/plain over text/html. */
export function extractBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return "";
  const plain: string[] = [];
  const html: string[] = [];

  const walk = (part: gmail_v1.Schema$MessagePart) => {
    const mime = part.mimeType ?? "";
    const data = part.body?.data;
    if (data) {
      const decoded = decodeBase64Url(data);
      if (mime === "text/plain") plain.push(decoded);
      else if (mime === "text/html") html.push(decoded);
    }
    for (const child of part.parts ?? []) walk(child);
  };
  walk(payload);

  const raw = plain.length > 0 ? plain.join("\n") : htmlToText(html.join("\n"));
  return stripQuotedReplies(raw).slice(0, MAX_BODY_CHARS);
}

export function parseAddress(value: string | undefined): { name: string | null; email: string | null } {
  if (!value) return { name: null, email: null };
  const angled = value.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (angled) {
    const name = (angled[1] ?? "").trim();
    return { name: name.length > 0 ? name : null, email: (angled[2] ?? "").trim().toLowerCase() };
  }
  const trimmed = value.trim();
  return trimmed.includes("@")
    ? { name: null, email: trimmed.toLowerCase() }
    : { name: trimmed, email: null };
}

export function parseAddressList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => parseAddress(part).email)
    .filter((email): email is string => email !== null);
}

function headerMap(headers: gmail_v1.Schema$MessagePartHeader[] | undefined): Record<string, string> {
  const map: Record<string, string> = {};
  for (const header of headers ?? []) {
    if (header.name && header.value) map[header.name.toLowerCase()] = header.value;
  }
  return map;
}

/** Converts a Gmail API message into the provider-neutral shape. */
export function normalizeGmailMessage(message: gmail_v1.Schema$Message): NormalizedMessage | null {
  if (!message.id) return null;
  const headers = headerMap(message.payload?.headers);
  const from = parseAddress(headers["from"]);

  const sentAt = message.internalDate
    ? new Date(Number(message.internalDate))
    : headers["date"]
      ? new Date(headers["date"])
      : new Date();

  return {
    externalId: message.id,
    threadExternalId: message.threadId ?? null,
    subject: headers["subject"] ?? null,
    fromName: from.name,
    fromEmail: from.email,
    toEmails: parseAddressList(headers["to"]),
    sentAt: Number.isNaN(sentAt.getTime()) ? new Date() : sentAt,
    snippet: message.snippet ?? null,
    bodyText: extractBody(message.payload),
    headers,
    labels: message.labelIds ?? [],
  };
}
