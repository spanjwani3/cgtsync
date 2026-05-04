import { NextRequest, NextResponse } from "next/server";
import { requireTenantOrgAccess } from "@/lib/server/auth";
import { OrgRole } from "@/generated/prisma/client";
import { resendInvite, InviteError } from "@/lib/server/invite-member";
import { generateRequestId, structuredError } from "@/lib/config";

/**
 * POST /api/org/members/[userId]/resend-invite — regenerate temp password,
 * fresh magic link, and resend the welcome email for an existing member.
 * Tenant ADMIN required.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const requestId = generateRequestId();
  try {
    const auth = await requireTenantOrgAccess(OrgRole.ADMIN);
    const { userId } = await params;
    if (!userId) {
      return NextResponse.json(
        { requestId, error: "userId required" },
        { status: 400 },
      );
    }

    const result = await resendInvite(auth.orgId, userId);
    return NextResponse.json({ requestId, result });
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    if (message === "UNAUTHORIZED") {
      return NextResponse.json(
        { requestId, error: "Unauthorized" },
        { status: 401 },
      );
    }
    if (message === "FORBIDDEN") {
      return NextResponse.json(
        { requestId, error: "Admin role required" },
        { status: 403 },
      );
    }
    if (e instanceof InviteError) {
      return NextResponse.json(
        { requestId, error: e.message },
        { status: e.status },
      );
    }
    console.error(
      structuredError({
        requestId,
        route: "/api/org/members/[userId]/resend-invite POST",
        error: e,
      }),
    );
    return NextResponse.json(
      { requestId, error: "Internal server error" },
      { status: 500 },
    );
  }
}
