import { NextRequest, NextResponse } from "next/server";
import { OrgRole, MagicLinkScope } from "@/generated/prisma/client";
import { requireAuth, getOrgMembership } from "@/lib/server/auth";
import { createMagicLink } from "@/lib/server/magic-link";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const body = await req.json();
    const { scope, entityId, ttlHours, singleUse } = body;
    if (!scope || !entityId) return NextResponse.json({ error: "scope and entityId required" }, { status: 400 });

    // Verify the user has access to the entity's program
    let programId: string | null = null;
    if (scope === "BASELINE_CONFIRM") {
      const baseline = await prisma.baseline.findUnique({ where: { id: entityId }, select: { programId: true } });
      programId = baseline?.programId ?? null;
    } else if (scope === "CHANGE_CONFIRM") {
      const change = await prisma.change.findUnique({ where: { id: entityId }, select: { programId: true } });
      programId = change?.programId ?? null;
    }
    if (!programId) return NextResponse.json({ error: "Entity not found" }, { status: 404 });

    const program = await prisma.program.findUnique({ where: { id: programId }, select: { orgId: true } });
    if (!program) return NextResponse.json({ error: "Program not found" }, { status: 404 });

    const membership = await getOrgMembership(auth.userId, program.orgId);
    if (!membership || membership.role === "READ_ONLY") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const link = await createMagicLink({
      scope: scope as MagicLinkScope,
      entityId,
      createdById: auth.userId,
      ttlHours,
      singleUse,
    });

    // Build URL on the org's tenant subdomain (not the apex which serves
    // the marketing site). Imported from tenant-url.ts (not tenant.ts)
    // so the helper's Prisma dep doesn't get traced into the Edge Runtime
    // middleware bundle.
    const { buildTenantUrlForOrg } = await import("@/lib/server/tenant-url");
    const url = await buildTenantUrlForOrg(
      program.orgId,
      `/confirm/${link.token}`,
    );

    return NextResponse.json({ ...link, url }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    console.error("[POST /api/gateway/magic-link] Unhandled error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
