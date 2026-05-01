import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { OrgRole, BaselineStatus } from "@/generated/prisma/client";
import { requireProgramAccess } from "@/lib/server/auth";
import { logEvent, getClientIp } from "@/lib/server/event-log";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ baselineId: string }> }
) {
  try {
    const { baselineId } = await params;
    const baseline = await prisma.baseline.findUnique({
      where: { id: baselineId },
      include: { clauses: { orderBy: { sortOrder: "asc" } }, sourceFile: true },
    });
    if (!baseline) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await requireProgramAccess(baseline.programId);
    return NextResponse.json(baseline);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (msg === "NOT_FOUND") return NextResponse.json({ error: "Not found" }, { status: 404 });
    console.error("[GET /api/baselines/:id] Unhandled error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ baselineId: string }> }
) {
  try {
    const { baselineId } = await params;
    const baseline = await prisma.baseline.findUnique({ where: { id: baselineId } });
    if (!baseline) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const auth = await requireProgramAccess(baseline.programId, OrgRole.OPERATOR);
    const body = await req.json();
    const { status, sourceFileId } = body;

    const data: Record<string, unknown> = {};
    if (sourceFileId) data.sourceFileId = sourceFileId;

    // Status transitions
    if (status) {
      const transitions: Record<string, string[]> = {
        DRAFT: ["RELEASED"],
        RELEASED: ["CONFIRMED", "COUNTERED"],
        COUNTERED: ["RELEASED"],
        CONFIRMED: ["LOCKED"],
        LOCKED: ["SUPERSEDED"],
      };
      const allowed = transitions[baseline.status] ?? [];
      if (!allowed.includes(status)) {
        return NextResponse.json({ error: `Cannot transition from ${baseline.status} to ${status}` }, { status: 400 });
      }
      data.status = status;
      if (status === "RELEASED") data.releasedAt = new Date();
      if (status === "CONFIRMED") data.confirmedAt = new Date();
      if (status === "LOCKED") data.lockedAt = new Date();
      if (status === "SUPERSEDED") data.supersededAt = new Date();
    }

    const updated = await prisma.baseline.update({ where: { id: baselineId }, data });

    const actionMap: Record<string, string> = {
      RELEASED: "BASELINE_RELEASED",
      CONFIRMED: "BASELINE_CONFIRMED",
      LOCKED: "BASELINE_LOCKED",
      SUPERSEDED: "BASELINE_SUPERSEDED",
    };
    if (status && actionMap[status]) {
      await logEvent({
        programId: baseline.programId, userId: auth.userId,
        action: actionMap[status] as import("@/generated/prisma/client").EventAction,
        entityType: "Baseline", entityId: baselineId, ipAddress: getClientIp(req.headers),
      });
    }

    return NextResponse.json(updated);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (msg === "NOT_FOUND") return NextResponse.json({ error: "Not found" }, { status: 404 });
    console.error("[PATCH /api/baselines/:id] Unhandled error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
