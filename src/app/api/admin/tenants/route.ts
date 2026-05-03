import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/server/auth";
import { onboardTenant, OnboardError } from "@/lib/server/onboard-tenant";
import { removeProjectDomain } from "@/lib/server/vercel";
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

export async function DELETE(req: NextRequest) {
  const requestId = generateRequestId();
  try {
    await requirePlatformAdmin();
    const slug = req.nextUrl.searchParams.get("slug")?.trim().toLowerCase();
    if (!slug) {
      return NextResponse.json(
        { requestId, error: "slug query param required" },
        { status: 400 },
      );
    }

    const org = await prisma.organization.findUnique({ where: { slug } });
    if (!org) {
      return NextResponse.json(
        { requestId, error: "Tenant not found" },
        { status: 404 },
      );
    }

    // Cascade-delete via Postgres (Program → all program children, OrgMember,
    // IngestAddress, EmailLog, etc. — all FKs onDelete: Cascade per schema).
    // Supabase auth.users entries are intentionally retained because they may
    // hold memberships in other orgs; can be pruned via maintenance script later.
    // TODO: emit TENANT_DELETED event once enum migration ships.
    await prisma.organization.delete({ where: { slug } });

    // Best-effort: detach Vercel domain so dead subdomains don't accumulate.
    const rootDomain = process.env.ROOT_DOMAIN ?? "cgtsync.ai";
    const vercelDomain = await removeProjectDomain(`${slug}.${rootDomain}`);

    return NextResponse.json({
      requestId,
      deleted: true,
      slug,
      vercelDomain,
    });
  } catch (e) {
    return errorResponse(requestId, e, "/api/admin/tenants DELETE");
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
  // This endpoint is platform-admin-gated, so it's safe (and useful) to
  // surface the underlying error to the caller. Prisma errors carry both a
  // `code` (e.g. P2003 for FK violation) and a `meta` object — include both
  // so the admin can diagnose without digging through Vercel function logs.
  const errObj = e as { code?: string; meta?: Record<string, unknown> };
  return NextResponse.json(
    {
      requestId,
      error: "Internal server error",
      details: message,
      prismaCode: errObj.code ?? null,
      prismaMeta: errObj.meta ?? null,
    },
    { status: 500 },
  );
}
