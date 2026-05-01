import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { OrgRole } from "@/generated/prisma/client";
import { requireProgramAccess } from "@/lib/server/auth";
import { generateRequestId, structuredError } from "@/lib/config";
import { analyzeScopeFromText } from "@/lib/server/scope-analysis";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/gateway/scope-analysis?programId=...
 * List scope analyses for a program.
 */
export async function GET(req: NextRequest) {
  const requestId = generateRequestId();
  try {
    const programId = req.nextUrl.searchParams.get("programId");
    if (!programId || !UUID_RE.test(programId)) {
      return NextResponse.json(
        { requestId, error: "programId query parameter required (UUID)" },
        { status: 400 },
      );
    }
    await requireProgramAccess(programId);

    const analyses = await prisma.scopeAnalysis.findMany({
      where: { programId },
      include: {
        evidence: { select: { fileName: true, type: true } },
        _count: { select: { alerts: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ requestId, analyses });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED")
      return NextResponse.json({ requestId, error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN")
      return NextResponse.json({ requestId, error: "Forbidden" }, { status: 403 });
    console.error(structuredError({ requestId, route: "GET /scope-analysis", error: e }));
    return NextResponse.json({ requestId, error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/gateway/scope-analysis
 * Start a scope analysis.
 * Body: { programId, text?, evidenceId? }
 */
export async function POST(req: NextRequest) {
  const requestId = generateRequestId();
  let userId: string | undefined;
  let programId: string | undefined;
  try {
    const body = await req.json();
    programId = body.programId;
    if (!programId || !UUID_RE.test(programId)) {
      return NextResponse.json(
        { requestId, error: "programId required (UUID)" },
        { status: 400 },
      );
    }

    const auth = await requireProgramAccess(programId, OrgRole.OPERATOR);
    userId = auth.userId;

    const text = body.text as string | undefined;
    const evidenceId = body.evidenceId as string | undefined;

    if (!text && !evidenceId) {
      return NextResponse.json(
        { requestId, error: "Either text or evidenceId is required" },
        { status: 400 },
      );
    }

    let transcriptText = text;

    // If evidenceId provided, fetch the extraction data from a completed CHANGE_TRANSCRIPT job
    if (!transcriptText && evidenceId) {
      if (!UUID_RE.test(evidenceId)) {
        return NextResponse.json(
          { requestId, error: "evidenceId must be a valid UUID" },
          { status: 400 },
        );
      }
      // Look for extracted transcript text from an existing extraction job
      const job = await prisma.extractionJob.findFirst({
        where: { evidenceId, targetType: "CHANGE_TRANSCRIPT", status: "COMPLETED" },
        include: { evidence: true },
        orderBy: { completedAt: "desc" },
      });
      if (job?.evidence) {
        // Use the evidence text content for analysis — download and read
        const { getSignedUrl } = await import("@/lib/server/storage");
        const signedUrl = await getSignedUrl(job.evidence.storagePath, 120);
        const res = await fetch(signedUrl);
        if (res.ok) {
          transcriptText = await res.text();
        }
      }
      if (!transcriptText) {
        return NextResponse.json(
          { requestId, error: "Could not retrieve transcript text from evidence" },
          { status: 400 },
        );
      }
    }

    const result = await analyzeScopeFromText(
      programId,
      transcriptText!,
      evidenceId ? "UPLOAD" : "PASTE",
      evidenceId,
      userId,
    );

    return NextResponse.json({ requestId, ...result }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED")
      return NextResponse.json({ requestId, error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN")
      return NextResponse.json({ requestId, error: "Forbidden" }, { status: 403 });
    if (msg === "NO_LOCKED_BASELINE")
      return NextResponse.json(
        { requestId, error: "No locked or confirmed baseline found. Lock a baseline before running scope analysis." },
        { status: 400 },
      );
    console.error(structuredError({ requestId, route: "POST /scope-analysis", error: e, userId, programId }));
    return NextResponse.json({ requestId, error: "Internal server error" }, { status: 500 });
  }
}
