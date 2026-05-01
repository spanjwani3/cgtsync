import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ImportTargetType } from "@/generated/prisma/client";
import { requireAuth } from "@/lib/server/auth";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const member = await prisma.orgMember.findFirst({
      where: { userId: auth.userId },
      select: { orgId: true },
    });
    if (!member) {
      return NextResponse.json({ error: "No organization found" }, { status: 403 });
    }

    const targetType = req.nextUrl.searchParams.get("targetType");
    const where: { orgId: string; targetType?: ImportTargetType } = { orgId: member.orgId };
    if (targetType && Object.values(ImportTargetType).includes(targetType as ImportTargetType)) {
      where.targetType = targetType as ImportTargetType;
    }

    const mappings = await prisma.importMapping.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(mappings);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    console.error("[GET /api/gateway/import/mappings] Error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const member = await prisma.orgMember.findFirst({
      where: { userId: auth.userId },
      select: { orgId: true },
    });
    if (!member) {
      return NextResponse.json({ error: "No organization found" }, { status: 403 });
    }

    const body = await req.json();
    const { name, targetType, columnMap } = body;

    if (!name || !targetType || !columnMap) {
      return NextResponse.json(
        { error: "name, targetType, and columnMap are required" },
        { status: 400 }
      );
    }

    if (!Object.values(ImportTargetType).includes(targetType)) {
      return NextResponse.json(
        { error: `targetType must be one of: ${Object.values(ImportTargetType).join(", ")}` },
        { status: 400 }
      );
    }

    const mapping = await prisma.importMapping.create({
      data: {
        orgId: member.orgId,
        name,
        targetType,
        columnMap,
      },
    });

    return NextResponse.json(mapping, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    console.error("[POST /api/gateway/import/mappings] Error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
