import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { OrgRole } from "@/generated/prisma/client";
import { requireTenantOrgAccess } from "@/lib/server/auth";
import { logEvent, getClientIp } from "@/lib/server/event-log";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireTenantOrgAccess();

    const assignedPmId = req.nextUrl.searchParams.get("assignedPmId");
    const where: Record<string, unknown> = { orgId: auth.orgId };
    if (assignedPmId) where.assignedPmId = assignedPmId;

    const programs = await prisma.program.findMany({
      where,
      include: {
        assignedPm: { select: { id: true, fullName: true, email: true } },
        _count: { select: { baselines: true, changes: true, invoices: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ programs });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    if (message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (message === "FORBIDDEN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("[GET /api/programs] Unhandled error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireTenantOrgAccess(OrgRole.OPERATOR);
    const body = await req.json();
    const { name, cdmoName, molecule, modality, description, currency, changeThreshold, assignedPmId } = body;

    if (!name || !cdmoName) {
      return NextResponse.json(
        { error: "name and cdmoName are required" },
        { status: 400 }
      );
    }

    const program = await prisma.program.create({
      data: {
        orgId: auth.orgId,
        name,
        cdmoName,
        molecule: molecule ?? null,
        modality: modality ?? null,
        description: description ?? null,
        currency: currency ?? "USD",
        changeThreshold: changeThreshold ?? null,
        assignedPmId: assignedPmId ?? null,
      },
    });

    await logEvent({
      programId: program.id,
      userId: auth.userId,
      action: "PROGRAM_CREATED",
      entityType: "Program",
      entityId: program.id,
      metadata: { name, cdmoName },
      ipAddress: getClientIp(req.headers),
    });

    return NextResponse.json({ program }, { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    if (message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (message === "FORBIDDEN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("[POST /api/programs] Unhandled error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
