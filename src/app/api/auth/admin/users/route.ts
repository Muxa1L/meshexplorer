import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/session";
import { getUserByEmail, listUsers, normalizeEmail, setUserRole, setUserStatus, toPublicUser } from "@/lib/auth/users";
import type { AuthUser } from "@/types/auth";

/**
 * Resolve the requesting session to an approved admin user.
 * Returns `{ admin }` on success or `{ error }` with an HTTP response.
 */
async function requireAdmin(req: Request): Promise<{ admin: AuthUser | null; error?: NextResponse }> {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return { admin: null, error: NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 }) };
  }
  const admin = await getUserByEmail(session.email);
  if (!admin || admin.status !== "approved" || admin.role !== "admin") {
    return { admin: null, error: NextResponse.json({ error: "Admin access required", code: "FORBIDDEN" }, { status: 403 }) };
  }
  return { admin };
}

/** List all registered users (admin only). */
export async function GET(req: Request) {
  try {
    const { admin, error } = await requireAdmin(req);
    if (!admin) {
      return error;
    }
    return NextResponse.json({ users: await listUsers() });
  } catch (err) {
    console.error("Failed to list users:", err);
    return NextResponse.json({ error: "Failed to list users", code: "INTERNAL_ERROR" }, { status: 500 });
  }
}

/**
 * Moderate a user (admin only).
 * Body: { email, status?: "approved" | "rejected", role?: "user" | "admin" }
 */
export async function POST(req: Request) {
  try {
    const { admin, error } = await requireAdmin(req);
    if (!admin) {
      return error;
    }

    const body = await req.json().catch(() => null);
    const email = normalizeEmail(body?.email);
    const status = body?.status;
    const role = body?.role;

    if (!email) {
      return NextResponse.json({ error: "Email is required", code: "VALIDATION_ERROR" }, { status: 400 });
    }
    if (
      (status !== undefined && status !== "approved" && status !== "rejected") ||
      (role !== undefined && role !== "user" && role !== "admin")
    ) {
      return NextResponse.json({ error: "Invalid status or role", code: "VALIDATION_ERROR" }, { status: 400 });
    }
    if (email === admin.email) {
      return NextResponse.json(
        { error: "You cannot moderate your own account", code: "SELF_MODERATION" },
        { status: 400 }
      );
    }

    const target = await getUserByEmail(email);
    if (!target) {
      return NextResponse.json({ error: "User not found", code: "USER_NOT_FOUND" }, { status: 404 });
    }

    if (status === "approved" || status === "rejected") {
      await setUserStatus(email, status);
    }
    if (role === "user" || role === "admin") {
      await setUserRole(email, role);
    }

    const updated = await getUserByEmail(email);
    return NextResponse.json({ user: updated ? toPublicUser(updated) : null });
  } catch (err) {
    console.error("Failed to update user:", err);
    return NextResponse.json({ error: "Failed to update user", code: "INTERNAL_ERROR" }, { status: 500 });
  }
}