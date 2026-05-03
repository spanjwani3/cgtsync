import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { OrgRole } from "@/generated/prisma/client";
import { requireTenantOrgAccess } from "@/lib/server/auth";
import { getSignedUrl } from "@/lib/server/storage";
import { isValidHex } from "@/lib/brand/shade";

async function withSignedLogo(logoUrl: string | null): Promise<string | null> {
  if (!logoUrl) return null;
  try {
    return await getSignedUrl(logoUrl, 3600);
  } catch (e) {
    console.warn("[/api/org/branding] failed to sign logoUrl:", e);
    return null;
  }
}

export async function GET(_req: NextRequest) {
  try {
    const auth = await requireTenantOrgAccess();
    const org = await prisma.organization.findUnique({
      where: { id: auth.orgId },
      select: { id: true, name: true, logoUrl: true, accentColor: true },
    });
    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }
    const logoSignedUrl = await withSignedLogo(org.logoUrl);
    return NextResponse.json({ org: { ...org, logoSignedUrl } });
  } catch (e) {
    return mapAuthError(e, "[GET /api/org/branding]");
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const auth = await requireTenantOrgAccess(OrgRole.ADMIN);
    const body = (await req.json().catch(() => null)) as { accentColor?: string | null } | null;

    if (!body || !("accentColor" in body)) {
      return NextResponse.json({ error: "accentColor is required" }, { status: 400 });
    }

    const next = body.accentColor;
    if (next !== null && (typeof next !== "string" || !isValidHex(next))) {
      return NextResponse.json(
        { error: "accentColor must be a 6-digit hex (e.g. #2563eb) or null" },
        { status: 400 },
      );
    }

    const org = await prisma.organization.update({
      where: { id: auth.orgId },
      data: { accentColor: next },
      select: { id: true, accentColor: true, logoUrl: true },
    });

    const logoSignedUrl = await withSignedLogo(org.logoUrl);
    return NextResponse.json({ org: { ...org, logoSignedUrl } });
  } catch (e) {
    return mapAuthError(e, "[PATCH /api/org/branding]");
  }
}

function mapAuthError(e: unknown, tag: string) {
  const message = e instanceof Error ? e.message : "Unknown error";
  if (message === "UNAUTHORIZED") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (message === "FORBIDDEN") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  console.error(`${tag} Unhandled error:`, e);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
