import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { OrgRole } from "@/generated/prisma/client";
import { requireTenantOrgAccess } from "@/lib/server/auth";
import { generateRequestId, structuredError } from "@/lib/config";

export async function GET(_req: NextRequest) {
  const requestId = generateRequestId();
  try {
    const auth = await requireTenantOrgAccess(OrgRole.OPERATOR);

    const config = await prisma.orgEmailConfig.findUnique({
      where: { orgId: auth.orgId },
    });

    // Return empty defaults if no config exists yet
    if (!config) {
      return NextResponse.json({
        requestId,
        config: {
          orgId: auth.orgId,
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
    if (message === "FORBIDDEN") {
      return NextResponse.json({ requestId, error: "Forbidden" }, { status: 403 });
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
    const auth = await requireTenantOrgAccess(OrgRole.ADMIN);

    const body = await req.json();
    const allowedFields = ["sendingDomain", "defaultReplyTo"];
    const data: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (field in body) data[field] = body[field];
    }

    const config = await prisma.orgEmailConfig.upsert({
      where: { orgId: auth.orgId },
      update: data,
      create: {
        orgId: auth.orgId,
        ...data,
      },
    });

    return NextResponse.json({ requestId, config });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    if (message === "UNAUTHORIZED") {
      return NextResponse.json({ requestId, error: "Unauthorized" }, { status: 401 });
    }
    if (message === "FORBIDDEN") {
      return NextResponse.json({ requestId, error: "Admin role required" }, { status: 403 });
    }
    console.error(structuredError({
      requestId,
      route: "PATCH /api/org/email-config",
      error: e,
    }));
    return NextResponse.json({ requestId, error: "Internal server error" }, { status: 500 });
  }
}
