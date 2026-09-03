import { NextResponse } from "next/server";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  buildSessionCookieOptions,
  createSessionToken,
  isSecureRequest,
} from "@/lib/auth/session";
import { getUserByEmail, normalizeEmail } from "@/lib/auth/users";

// A dummy hash is verified when the email is unknown so response times do not
// reveal whether an account exists.
let dummyHashPromise: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = hashPassword("meshexplorer-timing-equalizer");
  }
  return dummyHashPromise;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const email = normalizeEmail(body?.email);
    const password = typeof body?.password === "string" ? body.password : "";

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required", code: "VALIDATION_ERROR" }, { status: 400 });
    }

    const user = await getUserByEmail(email);
    const storedHash = user ? user.password_hash : await getDummyHash();
    const passwordValid = await verifyPassword(password, storedHash);

    if (!user || !passwordValid) {
      return NextResponse.json({ error: "Invalid email or password", code: "INVALID_CREDENTIALS" }, { status: 401 });
    }

    if (user.status === "pending") {
      return NextResponse.json(
        { error: "Your account is awaiting approval by a moderator", code: "ACCOUNT_PENDING" },
        { status: 403 }
      );
    }
    if (user.status === "rejected") {
      return NextResponse.json(
        { error: "Your registration was declined", code: "ACCOUNT_REJECTED" },
        { status: 403 }
      );
    }

    const token = await createSessionToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS,
    });

    const response = NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        status: user.status,
        role: user.role,
      },
    });
    response.cookies.set(SESSION_COOKIE_NAME, token, buildSessionCookieOptions(isSecureRequest(req)));
    return response;
  } catch (error) {
    console.error("Login failed:", error);
    return NextResponse.json({ error: "Login failed", code: "INTERNAL_ERROR" }, { status: 500 });
  }
}