import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { OrgRole, TermType } from "@/generated/prisma/client";
import { requireProgramAccess } from "@/lib/server/auth";
import { logEvent, getClientIp } from "@/lib/server/event-log";
import { generateRequestId, structuredError } from "@/lib/config";

const VALID_TERM_TYPES = new Set(Object.values(TermType));

export async function GET(req: NextRequest) {
  const requestId = generateRequestId();
  try {
    const programId = req.nextUrl.searchParams.get("programId");
    if (!programId) {
      return NextResponse.json({ requestId, error: "programId required" }, { status: 400 });
    }
    await requireProgramAccess(programId);

    const terms = await prisma.commitmentTerm.findMany({
      where: { programId },
      include: { evidence: { select: { fileName: true } } },
      orderBy: [{ deadlineAt: "asc" }, { sortOrder: "asc" }],
    });

    return NextResponse.json({ requestId, terms });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED")
      return NextResponse.json({ requestId, error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN")
      return NextResponse.json({ requestId, error: "Forbidden" }, { status: 403 });
    console.error(structuredError({ requestId, route: "/api/commitment-terms", error: e }));
    return NextResponse.json({ requestId, error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const requestId = generateRequestId();
  let userId: string | undefined;
  let programId: string | undefined;
  try {
    const body = await req.json();
    programId = body.programId;
    if (!programId) {
      return NextResponse.json({ requestId, error: "programId required" }, { status: 400 });
    }
    if (!body.label) {
      return NextResponse.json({ requestId, error: "label required" }, { status: 400 });
    }

    const auth = await requireProgramAccess(programId, OrgRole.OPERATOR);
    userId = auth.userId;

    const termType = VALID_TERM_TYPES.has(body.termType as TermType)
      ? (body.termType as TermType)
      : "COMMITMENT_DATE";

    let deadlineAt: Date | null = null;
    if (body.dateOrOffset) {
      const parsed = Date.parse(body.dateOrOffset);
      if (!isNaN(parsed)) deadlineAt = new Date(parsed);
    }
    if (body.deadlineAt) {
      const parsed = Date.parse(body.deadlineAt);
      if (!isNaN(parsed)) deadlineAt = new Date(parsed);
    }

    const maxOrder = await prisma.commitmentTerm.aggregate({
      where: { programId },
      _max: { sortOrder: true },
    });
    const sortOrder = (maxOrder._max.sortOrder ?? 0) + 1;

    const term = await prisma.commitmentTerm.create({
      data: {
        programId,
        evidenceId: body.evidenceId ?? null,
        baselineId: body.baselineId ?? null,
        termType,
        label: body.label,
        dateOrOffset: body.dateOrOffset ?? null,
        deadlineAt,
        costOrPercent: body.costOrPercent ?? null,
        conditions: body.conditions ?? null,
        sortOrder,
      },
    });

    await logEvent({
      programId,
      userId,
      action: "TERM_CREATED",
      entityType: "CommitmentTerm",
      entityId: term.id,
      metadata: { termType, label: body.label },
      ipAddress: getClientIp(req.headers),
    });

    return NextResponse.json({ requestId, term }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED")
      return NextResponse.json({ requestId, error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN")
      return NextResponse.json({ requestId, error: "Forbidden" }, { status: 403 });
    console.error(
      structuredError({ requestId, route: "/api/commitment-terms", error: e, userId, programId })
    );
    return NextResponse.json({ requestId, error: "Internal server error" }, { status: 500 });
  }
}
