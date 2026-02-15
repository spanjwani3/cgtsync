import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { OrgRole, ExtractionTargetType } from "@/generated/prisma/client";
import { requireProgramAccess } from "@/lib/server/auth";
import { logEvent, getClientIp } from "@/lib/server/event-log";
import { generateRequestId, structuredError } from "@/lib/config";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/gateway/extraction?programId=...
 * List extraction jobs for a program.
 */
export async function GET(req: NextRequest) {
  const requestId = generateRequestId();
  try {
    const programId = req.nextUrl.searchParams.get("programId");
    if (!programId || !UUID_RE.test(programId)) {
      return NextResponse.json(
        { requestId, error: "programId query parameter required (UUID)" },
        { status: 400 }
      );
    }
    await requireProgramAccess(programId);

    const jobs = await prisma.extractionJob.findMany({
      where: { programId },
      include: { evidence: { select: { fileName: true, type: true } } },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ requestId, jobs });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED")
      return NextResponse.json({ requestId, error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN")
      return NextResponse.json({ requestId, error: "Forbidden" }, { status: 403 });
    return NextResponse.json(
      { requestId, error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/gateway/extraction
 * Create a PENDING extraction job. Returns immediately.
 * Call POST /api/gateway/extraction/[jobId]/run to execute.
 * Body: { evidenceId, targetType }
 */
export async function POST(req: NextRequest) {
  const requestId = generateRequestId();
  let userId: string | undefined;
  let programId: string | undefined;
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { requestId, error: "Missing ANTHROPIC_API_KEY. Configure it in environment variables." },
        { status: 500 }
      );
    }

    const body = await req.json();
    const { evidenceId, targetType } = body;

    if (!evidenceId || !UUID_RE.test(evidenceId)) {
      return NextResponse.json(
        { requestId, error: "evidenceId required (UUID)" },
        { status: 400 }
      );
    }

    const validTargets = Object.values(ExtractionTargetType);
    if (!targetType || !validTargets.includes(targetType)) {
      return NextResponse.json(
        { requestId, error: `targetType must be one of: ${validTargets.join(", ")}` },
        { status: 400 }
      );
    }

    const evidence = await prisma.evidence.findUnique({ where: { id: evidenceId } });
    if (!evidence) {
      return NextResponse.json({ requestId, error: "Evidence not found" }, { status: 404 });
    }

    programId = evidence.programId;
    const auth = await requireProgramAccess(programId, OrgRole.OPERATOR);
    userId = auth.userId;

    const job = await prisma.extractionJob.create({
      data: {
        evidenceId,
        programId,
        targetType: targetType as ExtractionTargetType,
        status: "PENDING",
      },
    });

    await logEvent({
      programId,
      userId,
      action: "EXTRACTION_JOB_CREATED",
      entityType: "ExtractionJob",
      entityId: job.id,
      metadata: { targetType, evidenceId, fileName: evidence.fileName },
      ipAddress: getClientIp(req.headers),
    });

    return NextResponse.json({ requestId, job }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED")
      return NextResponse.json({ requestId, error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN")
      return NextResponse.json({ requestId, error: "Forbidden" }, { status: 403 });
    console.error(
      structuredError({
        requestId,
        route: "/api/gateway/extraction",
        error: e,
        userId,
        programId,
      })
    );
    return NextResponse.json(
      { requestId, error: "Internal server error" },
      { status: 500 }
    );
  }
}
