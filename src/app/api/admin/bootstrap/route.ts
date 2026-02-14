import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/server/auth";
import { OrgRole } from "@/generated/prisma/client";
import { ensureBucketExists } from "@/lib/server/storage";
import { EVIDENCE_BUCKET } from "@/lib/config";

export async function POST() {
  try {
    // Require ADMIN role
    const auth = await requireAuth();
    const membership = await prisma.orgMember.findFirst({
      where: { userId: auth.userId },
      select: { role: true },
    });
    if (!membership || membership.role !== OrgRole.ADMIN) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        { error: "Missing SUPABASE_SERVICE_ROLE_KEY. Cannot bootstrap storage." },
        { status: 500 }
      );
    }

    const result = await ensureBucketExists();

    if (result.error) {
      return NextResponse.json(
        { error: `Failed to bootstrap bucket: ${result.error}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      bucket: EVIDENCE_BUCKET,
      created: result.created,
      message: result.created
        ? `Bucket "${EVIDENCE_BUCKET}" created (private, 50MB limit).`
        : `Bucket "${EVIDENCE_BUCKET}" already exists.`,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED")
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    console.error("Bootstrap error:", e);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
