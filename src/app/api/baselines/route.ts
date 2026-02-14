import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { OrgRole } from "@/generated/prisma/client";
import { requireAuth, requireProgramAccess } from "@/lib/server/auth";
import { logEvent, getClientIp } from "@/lib/server/event-log";

export async function GET(req: NextRequest) {
  try {
    const programId = req.nextUrl.searchParams.get("programId");
    if (!programId) return NextResponse.json({ error: "programId required" }, { status: 400 });
    await requireProgramAccess(programId);
    const baselines = await prisma.baseline.findMany({
      where: { programId },
      include: { _count: { select: { clauses: true } } },
      orderBy: { version: "desc" },
    });
    return NextResponse.json(baselines);
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
    const { programId, title } = body;
    if (!programId || !title) return NextResponse.json({ error: "programId and title required" }, { status: 400 });
    const auth = await requireProgramAccess(programId, OrgRole.OPERATOR);
    // Auto-increment version
    const maxVersion = await prisma.baseline.aggregate({ where: { programId }, _max: { version: true } });
    const version = (maxVersion._max.version ?? 0) + 1;
    const baseline = await prisma.baseline.create({ data: { programId, title, version } });
    await logEvent({
      programId, userId: auth.userId, action: "BASELINE_CREATED",
      entityType: "Baseline", entityId: baseline.id, ipAddress: getClientIp(req.headers),
    });
    return NextResponse.json(baseline, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (msg === "NOT_FOUND") return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
