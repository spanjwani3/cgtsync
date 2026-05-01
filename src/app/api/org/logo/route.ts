import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/server/auth";
import { uploadEvidence } from "@/lib/server/storage";

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();

    const membership = await prisma.orgMember.findFirst({
      where: { userId: auth.userId },
      select: { orgId: true },
    });

    if (!membership) {
      return NextResponse.json({ error: "No organization found" }, { status: 404 });
    }

    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const path = `org-logos/${membership.orgId}/${file.name}`;

    await uploadEvidence(buffer, path, file.type);

    const org = await prisma.organization.update({
      where: { id: membership.orgId },
      data: { logoUrl: `evidence/${path}` },
      select: { logoUrl: true },
    });

    return NextResponse.json({ logoUrl: org.logoUrl });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    if (message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[POST /api/org/logo] Unhandled error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth();

    const membership = await prisma.orgMember.findFirst({
      where: { userId: auth.userId },
      select: { orgId: true },
    });

    if (!membership) {
      return NextResponse.json({ error: "No organization found" }, { status: 404 });
    }

    const org = await prisma.organization.findUnique({
      where: { id: membership.orgId },
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
    console.error("[GET /api/org/logo] Unhandled error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
