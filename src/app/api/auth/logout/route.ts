import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, buildSessionCookieOptions, isSecureRequest } from "@/lib/auth/session";

export async function POST(req: Request) {
  const response = NextResponse.json({ ok: true });
  // Clear the session cookie by expiring it immediately.
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    ...buildSessionCookieOptions(isSecureRequest(req)),
    maxAge: 0,
  });
  return response;
}