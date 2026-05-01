import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireProgramAccess } from "@/lib/server/auth";
import { generateRequestId } from "@/lib/config";

/**
 * GET /api/gateway/extraction/[jobId]
 * Get extraction job status and results.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const requestId = generateRequestId();
  try {
    const { jobId } = await params;
    const job = await prisma.extractionJob.findUnique({
      where: { id: jobId },
      include: { evidence: { select: { fileName: true, type: true, mimeType: true } } },
    });
    if (!job) {
      return NextResponse.json({ requestId, error: "Job not found" }, { status: 404 });
    }
    await requireProgramAccess(job.programId);
    return NextResponse.json({ requestId, job });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED")
      return NextResponse.json({ requestId, error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN")
      return NextResponse.json({ requestId, error: "Forbidden" }, { status: 403 });
    console.error("[GET /api/gateway/extraction/:jobId] Unhandled error:", e);
    return NextResponse.json(
      { requestId, error: "Internal server error" },
      { status: 500 }
    );
  }
}
