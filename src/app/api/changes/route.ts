import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { OrgRole } from "@/generated/prisma/client";
import { requireProgramAccess } from "@/lib/server/auth";
import { logEvent, getClientIp } from "@/lib/server/event-log";

export async function GET(req: NextRequest) {
  try {
    const programId = req.nextUrl.searchParams.get("programId");
    if (!programId) return NextResponse.json({ error: "programId required" }, { status: 400 });
    await requireProgramAccess(programId);
    const changes = await prisma.change.findMany({
      where: { programId },
      include: { baseline: { select: { title: true, version: true } } },
      orderBy: { sequenceNum: "asc" },
    });
    return NextResponse.json(changes);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (msg === "NOT_FOUND") return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { programId, baselineId, title, description, severity, estimatedImpact } = body;
    if (!programId || !title) return NextResponse.json({ error: "programId and title required" }, { status: 400 });
    const auth = await requireProgramAccess(programId, OrgRole.OPERATOR);
    const maxSeq = await prisma.change.aggregate({ where: { programId }, _max: { sequenceNum: true } });
    const sequenceNum = (maxSeq._max.sequenceNum ?? 0) + 1;
    const change = await prisma.change.create({
      data: {
        programId, baselineId: baselineId ?? null, sequenceNum, title,
        description: description ?? null, severity: severity ?? "MEDIUM",
        estimatedImpact: estimatedImpact ?? null,
      },
    });
    await logEvent({
      programId, userId: auth.userId, action: "CHANGE_DRAFTED",
      entityType: "Change", entityId: change.id, metadata: { sequenceNum, title },
      ipAddress: getClientIp(req.headers),
    });
    return NextResponse.json(change, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (msg === "NOT_FOUND") return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
