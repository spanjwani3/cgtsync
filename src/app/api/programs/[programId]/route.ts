import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { OrgRole } from "@/generated/prisma/client";
import { requireProgramAccess } from "@/lib/server/auth";
import { logEvent, getClientIp } from "@/lib/server/event-log";
import { generateRequestId, structuredError } from "@/lib/config";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ programId: string }> }
) {
  const requestId = generateRequestId();
  let userId: string | undefined;
  let orgId: string | undefined;
  try {
    const { programId } = await params;
    const auth = await requireProgramAccess(programId);
    userId = auth.userId;
    orgId = auth.orgId;

    const program = await prisma.program.findUnique({
      where: { id: programId },
      include: {
        assignedPm: { select: { id: true, fullName: true, email: true } },
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
      console.error(
        structuredError({
          requestId,
          route: `GET /api/programs/${programId}`,
          error: new Error("NOT_FOUND"),
          userId,
          orgId,
          programId,
        })
      );
      return NextResponse.json({ requestId, error: "Program not found" }, { status: 404 });
    }

    return NextResponse.json({ program });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    if (message === "UNAUTHORIZED") {
      return NextResponse.json({ requestId, error: "Unauthorized" }, { status: 401 });
    }
    if (message === "FORBIDDEN") {
      console.error(
        structuredError({
          requestId,
          route: "GET /api/programs/[programId]",
          error: e,
          userId,
          orgId,
        })
      );
      return NextResponse.json({ requestId, error: "Forbidden" }, { status: 403 });
    }
    if (message === "NOT_FOUND") {
      console.error(
        structuredError({
          requestId,
          route: "GET /api/programs/[programId]",
          error: e,
          userId,
        })
      );
      return NextResponse.json({ requestId, error: "Not found" }, { status: 404 });
    }
    console.error(
      structuredError({
        requestId,
        route: "GET /api/programs/[programId]",
        error: e,
        userId,
        orgId,
      })
    );
    return NextResponse.json({ requestId, error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ programId: string }> }
) {
  const requestId = generateRequestId();
  let userId: string | undefined;
  try {
    const { programId } = await params;
    const auth = await requireProgramAccess(programId, OrgRole.OPERATOR);
    userId = auth.userId;

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
      "assignedPmId",
    ];

    const data: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (field in body) {
        data[field] = body[field];
      }
    }

    // RBAC for PM assignment: Operators can only assign themselves, Admins can assign anyone
    if ("assignedPmId" in body && body.assignedPmId) {
      if (auth.role === OrgRole.OPERATOR && body.assignedPmId !== auth.userId) {
        return NextResponse.json(
          { requestId, error: "Operators can only assign themselves as PM" },
          { status: 403 }
        );
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
      return NextResponse.json({ requestId, error: "Unauthorized" }, { status: 401 });
    }
    if (message === "FORBIDDEN") {
      return NextResponse.json({ requestId, error: "Forbidden" }, { status: 403 });
    }
    if (message === "NOT_FOUND") {
      return NextResponse.json({ requestId, error: "Not found" }, { status: 404 });
    }
    console.error(
      structuredError({
        requestId,
        route: "PATCH /api/programs/[programId]",
        error: e,
        userId,
      })
    );
    return NextResponse.json({ requestId, error: "Internal server error" }, { status: 500 });
  }
}
