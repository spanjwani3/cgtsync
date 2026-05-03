import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { OrgRole } from "@/generated/prisma/client";
import { requireTenantOrgAccess } from "@/lib/server/auth";
import { uploadEvidence, getSignedUrl } from "@/lib/server/storage";

export async function POST(req: NextRequest) {
  try {
    const auth = await requireTenantOrgAccess(OrgRole.ADMIN);

    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const path = `org-logos/${auth.orgId}/${file.name}`;

    await uploadEvidence(buffer, path, file.type);

    const org = await prisma.organization.update({
      where: { id: auth.orgId },
      data: { logoUrl: `evidence/${path}` },
      select: { logoUrl: true },
    });

    let logoSignedUrl: string | null = null;
    if (org.logoUrl) {
      try {
        logoSignedUrl = await getSignedUrl(org.logoUrl, 3600);
      } catch (err) {
        console.warn("[POST /api/org/logo] failed to sign URL:", err);
      }
    }

    return NextResponse.json({ logoUrl: org.logoUrl, logoSignedUrl });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    if (message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (message === "FORBIDDEN") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }
    console.error("[POST /api/org/logo] Unhandled error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET(_req: NextRequest) {
  try {
    const auth = await requireTenantOrgAccess();

    const org = await prisma.organization.findUnique({
      where: { id: auth.orgId },
      select: { id: true, name: true, slug: true, logoUrl: true },
    });

    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    return NextResponse.json({ org });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    if (message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (message === "FORBIDDEN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("[GET /api/org/logo] Unhandled error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
