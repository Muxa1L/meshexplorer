import { NextResponse } from "next/server";
import { hashPassword } from "@/lib/auth/password";
import { createUser, getUserByEmail, getUserCount, normalizeEmail } from "@/lib/auth/users";
import type { UserRole, UserStatus } from "@/types/auth";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
const MAX_DISPLAY_NAME_LENGTH = 64;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);

    const email = normalizeEmail(body?.email);
    const password = typeof body?.password === "string" ? body.password : "";
    const displayName =
      typeof body?.displayName === "string" ? body.displayName.trim().slice(0, MAX_DISPLAY_NAME_LENGTH) : "";

    if (!EMAIL_PATTERN.test(email)) {
      return NextResponse.json({ error: "Invalid email address", code: "INVALID_EMAIL" }, { status: 400 });
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters", code: "PASSWORD_TOO_SHORT" },
        { status: 400 }
      );
    }
    if (displayName.length < 1) {
      return NextResponse.json({ error: "Display name is required", code: "INVALID_DISPLAY_NAME" }, { status: 400 });
    }

    const existing = await getUserByEmail(email);
    // Users with a declined registration may register again; anyone else may not.
    if (existing && existing.status !== "rejected") {
      return NextResponse.json({ error: "An account with this email already exists", code: "EMAIL_EXISTS" }, { status: 409 });
    }

    // Bootstrap: the very first user becomes an approved admin so the
    // instance is not locked out of moderation.
    const isFirstUser = (await getUserCount()) === 0;
    const status: UserStatus = isFirstUser ? "approved" : "pending";
    const role: UserRole = isFirstUser ? "admin" : "user";

    await createUser({
      id: crypto.randomUUID(),
      email,
      displayName,
      passwordHash: await hashPassword(password),
      status,
      role,
    });

    return NextResponse.json({ email, status, role, isFirstUser }, { status: 201 });
  } catch (error) {
    console.error("Registration failed:", error);
    return NextResponse.json({ error: "Registration failed", code: "INTERNAL_ERROR" }, { status: 500 });
  }
}