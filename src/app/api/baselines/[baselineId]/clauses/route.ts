import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { OrgRole } from "@/generated/prisma/client";
import { requireProgramAccess } from "@/lib/server/auth";
import { logEvent, getClientIp } from "@/lib/server/event-log";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ baselineId: string }> }
) {
  try {
    const { baselineId } = await params;
    const baseline = await prisma.baseline.findUnique({ where: { id: baselineId }, select: { programId: true } });
    if (!baseline) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await requireProgramAccess(baseline.programId);
    const clauses = await prisma.baselineClause.findMany({
      where: { baselineId },
      orderBy: { sortOrder: "asc" },
    });
    return NextResponse.json(clauses);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    console.error("[GET /api/baselines/:id/clauses] Unhandled error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ baselineId: string }> }
) {
  try {
    const { baselineId } = await params;
    const baseline = await prisma.baseline.findUnique({ where: { id: baselineId }, select: { programId: true, status: true } });
    if (!baseline) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (baseline.status !== "DRAFT") {
      return NextResponse.json({ error: "Can only add clauses to DRAFT baselines" }, { status: 400 });
    }
    const auth = await requireProgramAccess(baseline.programId, OrgRole.OPERATOR);
    const body = await req.json();
    const { clauseRef, type, title, description, value, unit } = body;
    if (!type || !title) return NextResponse.json({ error: "type and title required" }, { status: 400 });

    const maxOrder = await prisma.baselineClause.aggregate({ where: { baselineId }, _max: { sortOrder: true } });
    const clause = await prisma.baselineClause.create({
      data: {
        baselineId, clauseRef: clauseRef ?? null, type, title,
        description: description ?? null, value: value ?? null, unit: unit ?? null,
        sortOrder: (maxOrder._max.sortOrder ?? 0) + 1,
      },
    });
    await logEvent({
      programId: baseline.programId, userId: auth.userId, action: "CLAUSE_CREATED",
      entityType: "BaselineClause", entityId: clause.id, ipAddress: getClientIp(req.headers),
    });
    return NextResponse.json(clause, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    console.error("[POST /api/baselines/:id/clauses] Unhandled error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ baselineId: string }> }
) {
  try {
    const { baselineId } = await params;
    const baseline = await prisma.baseline.findUnique({ where: { id: baselineId }, select: { programId: true, status: true } });
    if (!baseline) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (baseline.status !== "DRAFT") {
      return NextResponse.json({ error: "Can only edit clauses in DRAFT baselines" }, { status: 400 });
    }
    const auth = await requireProgramAccess(baseline.programId, OrgRole.OPERATOR);
    const body = await req.json();
    const { clauseId, title, description, value, unit } = body;
    if (!clauseId) return NextResponse.json({ error: "clauseId required" }, { status: 400 });

    const data: Record<string, unknown> = {};
    if (title !== undefined) data.title = title;
    if (description !== undefined) data.description = description || null;
    if (value !== undefined) data.value = value != null ? value : null;
    if (unit !== undefined) data.unit = unit || null;

    const updated = await prisma.baselineClause.update({ where: { id: clauseId }, data });
    await logEvent({
      programId: baseline.programId, userId: auth.userId, action: "CLAUSE_UPDATED",
      entityType: "BaselineClause", entityId: clauseId, ipAddress: getClientIp(req.headers),
    });
    return NextResponse.json(updated);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    console.error("[PATCH /api/baselines/:id/clauses] Unhandled error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ baselineId: string }> }
) {
  try {
    const { baselineId } = await params;
    const baseline = await prisma.baseline.findUnique({ where: { id: baselineId }, select: { programId: true, status: true } });
    if (!baseline) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (baseline.status !== "DRAFT") {
      return NextResponse.json({ error: "Can only delete clauses from DRAFT baselines" }, { status: 400 });
    }
    const auth = await requireProgramAccess(baseline.programId, OrgRole.OPERATOR);
    const body = await req.json();
    const { clauseId } = body;
    if (!clauseId) return NextResponse.json({ error: "clauseId required" }, { status: 400 });

    await prisma.baselineClause.delete({ where: { id: clauseId } });
    await logEvent({
      programId: baseline.programId, userId: auth.userId, action: "CLAUSE_DELETED",
      entityType: "BaselineClause", entityId: clauseId, ipAddress: getClientIp(req.headers),
    });
    return NextResponse.json({ deleted: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    console.error("[DELETE /api/baselines/:id/clauses] Unhandled error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
