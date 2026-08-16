import crypto from "node:crypto";
import { requireEncryptionKey, requireSessionSecret } from "./env";

const ALGORITHM = "aes-256-gcm";

function derivedKey(): Buffer {
  // The configured key is arbitrary-length text; hash it to a fixed 32 bytes.
  return crypto.createHash("sha256").update(requireEncryptionKey()).digest();
}

/**
 * Encrypts provider tokens before they touch the database. Format is
 * `v1.<iv>.<authTag>.<ciphertext>`, all base64url.
 */
export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, derivedKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    authTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptSecret(payload: string): string {
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("Malformed encrypted secret");
  }
  const [, ivPart, tagPart, dataPart] = parts as [string, string, string, string];
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    derivedKey(),
    Buffer.from(ivPart, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/** HMAC used to sign the session cookie. */
export function sign(value: string): string {
  return crypto.createHmac("sha256", requireSessionSecret()).update(value).digest("base64url");
}

export function verifySignature(value: string, signature: string): boolean {
  const expected = Buffer.from(sign(value));
  const provided = Buffer.from(signature);
  if (expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(expected, provided);
}

/** Stable content hash used for ingestion dedupe and change detection. */
export function contentHash(...parts: (string | null | undefined)[]): string {
  const hash = crypto.createHash("sha256");
  for (const part of parts) hash.update(part ?? "", "utf8");
  return hash.digest("hex").slice(0, 32);
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}
