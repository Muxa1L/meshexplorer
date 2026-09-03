import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/session";
import { getUserByEmail } from "@/lib/auth/users";

/** Returns the signed-in user, or 401 when there is no valid approved session. */
export async function GET(req: Request) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
    }

    // Re-read from the database so revoked/demoted accounts are caught.
    const user = await getUserByEmail(session.email);
    if (!user || user.status !== "approved") {
      return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
    }

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        status: user.status,
        role: user.role,
        createdAt: user.createdAt,
        approvedAt: user.approvedAt,
      },
    });
  } catch (error) {
    console.error("Failed to read session:", error);
    return NextResponse.json({ error: "Failed to read session", code: "INTERNAL_ERROR" }, { status: 500 });
  }
}