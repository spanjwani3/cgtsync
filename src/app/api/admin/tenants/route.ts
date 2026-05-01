import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/server/auth";
import { onboardTenant, OnboardError } from "@/lib/server/onboard-tenant";
import { generateRequestId, structuredError } from "@/lib/config";

export async function GET() {
  const requestId = generateRequestId();
  try {
    await requirePlatformAdmin();
    const orgs = await prisma.organization.findMany({
      select: {
        id: true,
        name: true,
        slug: true,
        createdAt: true,
        _count: { select: { programs: true, members: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ requestId, orgs });
  } catch (e) {
    return errorResponse(requestId, e, "/api/admin/tenants GET");
  }
}

export async function POST(req: NextRequest) {
  const requestId = generateRequestId();
  try {
    await requirePlatformAdmin();
    const body = await req.json();
    const result = await onboardTenant({
      slug: typeof body.slug === "string" ? body.slug : "",
      name: typeof body.name === "string" ? body.name : "",
      program: typeof body.program === "string" ? body.program : "",
      cdmo: typeof body.cdmo === "string" ? body.cdmo : undefined,
      admins: Array.isArray(body.admins)
        ? body.admins.filter((e: unknown): e is string => typeof e === "string")
        : [],
      inbound: typeof body.inbound === "string" ? body.inbound : null,
      allowDomains: Array.isArray(body.allowDomains)
        ? body.allowDomains.filter(
            (d: unknown): d is string => typeof d === "string",
          )
        : [],
    });
    return NextResponse.json({ requestId, ...result });
  } catch (e) {
    return errorResponse(requestId, e, "/api/admin/tenants POST");
  }
}

function errorResponse(requestId: string, e: unknown, route: string) {
  const message = e instanceof Error ? e.message : "Unknown error";
  if (message === "UNAUTHORIZED") {
    return NextResponse.json(
      { requestId, error: "Unauthorized" },
      { status: 401 },
    );
  }
  if (message === "FORBIDDEN") {
    return NextResponse.json(
      { requestId, error: "Platform admin access required" },
      { status: 403 },
    );
  }
  if (e instanceof OnboardError) {
    return NextResponse.json({ requestId, error: message }, { status: 400 });
  }
  console.error(structuredError({ requestId, route, error: e }));
  return NextResponse.json(
    { requestId, error: "Internal server error" },
    { status: 500 },
  );
}
