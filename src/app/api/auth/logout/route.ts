import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { clearSessionCookie } from "@/lib/session";

export async function POST() {
  await clearSessionCookie();
  return NextResponse.redirect(`${env.appUrl}/`, { status: 303 });
}
