import { cookies } from "next/headers";
import { sign, verifySignature } from "./crypto";
import { isProduction } from "./env";

const COOKIE_NAME = "luma_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/**
 * Minimal signed-cookie session. Deliberately small: the cookie holds only a
 * user id, and everything else is read from the database.
 */
export function encodeSession(userId: string): string {
  return `${userId}.${sign(userId)}`;
}

export function decodeSession(raw: string | undefined): string | null {
  if (!raw) return null;
  const separator = raw.lastIndexOf(".");
  if (separator <= 0) return null;
  const userId = raw.slice(0, separator);
  const signature = raw.slice(separator + 1);
  if (!verifySignature(userId, signature)) return null;
  return userId;
}

export async function getSessionUserId(): Promise<string | null> {
  const store = await cookies();
  return decodeSession(store.get(COOKIE_NAME)?.value);
}

export async function setSessionCookie(userId: string): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, encodeSession(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
