import { NextResponse } from "next/server";
import { getConfig } from "@/config";
import { clearSessionCookie } from "@/lib/session";

export async function POST() {
  await clearSessionCookie();
  return NextResponse.redirect(`${getConfig().appUrl}/`, { status: 303 });
}
