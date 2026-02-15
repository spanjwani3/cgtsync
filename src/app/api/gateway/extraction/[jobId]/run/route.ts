import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { OrgRole, Prisma } from "@/generated/prisma/client";
import { requireProgramAccess } from "@/lib/server/auth";
import { logEvent, getClientIp } from "@/lib/server/event-log";
import { runExtraction } from "@/lib/server/extraction";
import { generateRequestId, structuredError } from "@/lib/config";

/**
 * POST /api/gateway/extraction/[jobId]/run
 * Execute the Claude extraction call for a PENDING job.
 * Updates job status to PROCESSING → COMPLETED or FAILED.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const requestId = generateRequestId();
  let userId: string | undefined;
  let programId: string | undefined;
  try {
    const { jobId } = await params;

    const job = await prisma.extractionJob.findUnique({
      where: { id: jobId },
      include: { evidence: true },
    });
    if (!job) {
      return NextResponse.json({ requestId, error: "Job not found" }, { status: 404 });
    }
    if (job.status !== "PENDING") {
      return NextResponse.json(
        { requestId, error: `Job is ${job.status}, not PENDING` },
        { status: 400 }
      );
    }

    programId = job.programId;
    const auth = await requireProgramAccess(programId, OrgRole.OPERATOR);
    userId = auth.userId;

    // Mark PROCESSING
    await prisma.extractionJob.update({
      where: { id: jobId },
      data: { status: "PROCESSING", startedAt: new Date() },
    });

    const startMs = Date.now();
    try {
      const result = await runExtraction(
        job.evidence.storagePath,
        job.evidence.mimeType,
        job.targetType,
        job.evidenceId,
      );

      const updated = await prisma.extractionJob.update({
        where: { id: jobId },
        data: {
          status: "COMPLETED",
          extractedData: result.extractedData as Prisma.InputJsonValue,
          confidence: result.confidence,
          tokensUsed: result.tokensUsed,
          modelUsed: result.modelUsed,
          processingTimeMs: Date.now() - startMs,
          completedAt: new Date(),
        },
      });

      await logEvent({
        programId,
        userId,
        action: "EXTRACTION_JOB_SUCCEEDED",
        entityType: "ExtractionJob",
        entityId: jobId,
        metadata: {
          targetType: job.targetType,
          confidence: result.confidence,
          tokensUsed: result.tokensUsed,
          processingTimeMs: Date.now() - startMs,
          retried: result.retried,
        },
        ipAddress: getClientIp(req.headers),
      });

      return NextResponse.json({ requestId, job: updated });
    } catch (extractionError) {
      const errMsg = extractionError instanceof Error ? extractionError.message : "Unknown extraction error";

      await prisma.extractionJob.update({
        where: { id: jobId },
        data: {
          status: "FAILED",
          errorMessage: errMsg,
          processingTimeMs: Date.now() - startMs,
          completedAt: new Date(),
        },
      });

      await logEvent({
        programId,
        userId,
        action: "EXTRACTION_JOB_FAILED",
        entityType: "ExtractionJob",
        entityId: jobId,
        metadata: { targetType: job.targetType, error: errMsg },
        ipAddress: getClientIp(req.headers),
      });

      return NextResponse.json(
        { requestId, error: `Extraction failed: ${errMsg}`, jobId },
        { status: 422 }
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED")
      return NextResponse.json({ requestId, error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN")
      return NextResponse.json({ requestId, error: "Forbidden" }, { status: 403 });
    console.error(
      structuredError({
        requestId,
        route: "/api/gateway/extraction/[jobId]/run",
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
