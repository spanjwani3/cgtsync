import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantOrgAccess } from "@/lib/server/auth";
import { OrgRole } from "@/generated/prisma/client";
import { inviteMember, InviteError } from "@/lib/server/invite-member";
import { generateRequestId, structuredError } from "@/lib/config";

const VALID_ROLES = new Set<OrgRole>([
  OrgRole.ADMIN,
  OrgRole.OPERATOR,
  OrgRole.READ_ONLY,
]);

export async function GET(_req: NextRequest) {
  try {
    const auth = await requireTenantOrgAccess();

    const members = await prisma.orgMember.findMany({
      where: { orgId: auth.orgId },
      include: {
        user: { select: { id: true, fullName: true, email: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({
      members: members.map((m) => ({
        id: m.user.id,
        fullName: m.user.fullName,
        email: m.user.email,
        role: m.role,
      })),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    if (message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (message === "FORBIDDEN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("[GET /api/org/members] Unhandled error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/org/members — invite a new member to the current tenant.
 * Body: { email: string, role: OrgRole }
 * Tenant ADMIN required.
 */
export async function POST(req: NextRequest) {
  const requestId = generateRequestId();
  try {
    const auth = await requireTenantOrgAccess(OrgRole.ADMIN);
    const body = (await req.json().catch(() => null)) as
      | { email?: unknown; role?: unknown }
      | null;
    if (!body) {
      return NextResponse.json(
        { requestId, error: "Invalid JSON body" },
        { status: 400 },
      );
    }
    const email = typeof body.email === "string" ? body.email : "";
    const roleRaw = typeof body.role === "string" ? body.role : "";
    if (!email) {
      return NextResponse.json(
        { requestId, error: "Email required" },
        { status: 400 },
      );
    }
    if (!VALID_ROLES.has(roleRaw as OrgRole)) {
      return NextResponse.json(
        { requestId, error: "Invalid role" },
        { status: 400 },
      );
    }

    const result = await inviteMember(auth.orgId, email, roleRaw as OrgRole);
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
      structuredError({ requestId, route: "/api/org/members POST", error: e }),
    );
    return NextResponse.json(
      { requestId, error: "Internal server error" },
      { status: 500 },
    );
  }
}
