import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/server/auth";

export async function GET() {
  try {
    const auth = await requireAuth();
    const membership = await prisma.orgMember.findFirst({
      where: { userId: auth.userId },
      select: { orgId: true, role: true },
    });
    if (!membership) {
      return NextResponse.json({ error: "No organization found" }, { status: 404 });
    }
    return NextResponse.json({
      userId: auth.userId,
      email: auth.email,
      orgId: membership.orgId,
      role: membership.role,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[GET /api/auth/me] Unhandled error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
