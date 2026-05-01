import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { OrgRole } from "@/generated/prisma/client";
import { requireAuth } from "@/lib/server/auth";
import { generateRequestId, structuredError } from "@/lib/config";

async function getOrgForUser(userId: string) {
  const membership = await prisma.orgMember.findFirst({
    where: { userId },
    select: { orgId: true, role: true },
  });
  return membership;
}

export async function GET(req: NextRequest) {
  const requestId = generateRequestId();
  try {
    const auth = await requireAuth();
    const membership = await getOrgForUser(auth.userId);
    if (!membership) {
      return NextResponse.json({ requestId, error: "No organization found" }, { status: 404 });
    }

    const roleHierarchy: Record<OrgRole, number> = {
      [OrgRole.READ_ONLY]: 0,
      [OrgRole.OPERATOR]: 1,
      [OrgRole.ADMIN]: 2,
    };
    if (roleHierarchy[membership.role] < roleHierarchy[OrgRole.OPERATOR]) {
      return NextResponse.json({ requestId, error: "Forbidden" }, { status: 403 });
    }

    let config = await prisma.orgEmailConfig.findUnique({
      where: { orgId: membership.orgId },
    });

    // Return empty defaults if no config exists yet
    if (!config) {
      return NextResponse.json({
        requestId,
        config: {
          orgId: membership.orgId,
          sendingDomain: null,
          domainVerified: false,
          defaultReplyTo: null,
          dkimConfigured: false,
          spfConfigured: false,
        },
      });
    }

    return NextResponse.json({ requestId, config });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    if (message === "UNAUTHORIZED") {
      return NextResponse.json({ requestId, error: "Unauthorized" }, { status: 401 });
    }
    console.error(structuredError({
      requestId,
      route: "GET /api/org/email-config",
      error: e,
    }));
    return NextResponse.json({ requestId, error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const requestId = generateRequestId();
  try {
    const auth = await requireAuth();
    const membership = await getOrgForUser(auth.userId);
    if (!membership) {
      return NextResponse.json({ requestId, error: "No organization found" }, { status: 404 });
    }
    if (membership.role !== OrgRole.ADMIN) {
      return NextResponse.json({ requestId, error: "Admin role required" }, { status: 403 });
    }

    const body = await req.json();
    const allowedFields = ["sendingDomain", "defaultReplyTo"];
    const data: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (field in body) data[field] = body[field];
    }

    const config = await prisma.orgEmailConfig.upsert({
      where: { orgId: membership.orgId },
      update: data,
      create: {
        orgId: membership.orgId,
        ...data,
      },
    });

    return NextResponse.json({ requestId, config });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    if (message === "UNAUTHORIZED") {
      return NextResponse.json({ requestId, error: "Unauthorized" }, { status: 401 });
    }
    console.error(structuredError({
      requestId,
      route: "PATCH /api/org/email-config",
      error: e,
    }));
    return NextResponse.json({ requestId, error: "Internal server error" }, { status: 500 });
  }
}
