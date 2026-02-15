import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { OrgRole } from "@/generated/prisma/client";
import { requireProgramAccess } from "@/lib/server/auth";
import { logEvent, getClientIp } from "@/lib/server/event-log";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ programId: string }> }
) {
  try {
    const { programId } = await params;
    await requireProgramAccess(programId);

    const program = await prisma.program.findUnique({
      where: { id: programId },
      include: {
        _count: {
          select: {
            baselines: true,
            changes: true,
            invoices: true,
            commitmentTerms: true,
          },
        },
      },
    });

    if (!program) {
      return NextResponse.json({ error: "Program not found" }, { status: 404 });
    }

    return NextResponse.json({ program });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    if (message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (message === "FORBIDDEN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (message === "NOT_FOUND") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ programId: string }> }
) {
  try {
    const { programId } = await params;
    const auth = await requireProgramAccess(programId, OrgRole.OPERATOR);

    const body = await req.json();
    const allowedFields = [
      "name",
      "cdmoName",
      "molecule",
      "modality",
      "description",
      "status",
      "currency",
      "retentionDays",
      "changeThreshold",
    ];

    const data: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (field in body) {
        data[field] = body[field];
      }
    }

    // If activating, set activatedAt
    if (body.status === "ACTIVE") {
      data.activatedAt = new Date();
    }

    const program = await prisma.program.update({
      where: { id: programId },
      data,
    });

    await logEvent({
      programId: program.id,
      userId: auth.userId,
      action: "PROGRAM_UPDATED",
      entityType: "Program",
      entityId: program.id,
      metadata: { updatedFields: Object.keys(data).join(",") },
      ipAddress: getClientIp(req.headers),
    });

    return NextResponse.json({ program });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    if (message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (message === "FORBIDDEN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (message === "NOT_FOUND") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
