import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireProgramAccess } from "@/lib/server/auth";
import { generateRequestId, structuredError } from "@/lib/config";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/gateway/scope-analysis/[analysisId]
 * Get a scope analysis with all its alerts.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ analysisId: string }> },
) {
  const requestId = generateRequestId();
  try {
    const { analysisId } = await params;
    if (!UUID_RE.test(analysisId)) {
      return NextResponse.json(
        { requestId, error: "Invalid analysisId" },
        { status: 400 },
      );
    }

    const analysis = await prisma.scopeAnalysis.findUnique({
      where: { id: analysisId },
      include: {
        evidence: { select: { id: true, fileName: true, type: true } },
        baseline: { select: { id: true, version: true, title: true } },
        alerts: {
          include: {
            matchedClause: {
              select: { id: true, clauseRef: true, title: true, type: true, value: true, unit: true },
            },
            convertedChange: {
              select: { id: true, sequenceNum: true, title: true, status: true },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!analysis) {
      return NextResponse.json(
        { requestId, error: "Scope analysis not found" },
        { status: 404 },
      );
    }

    await requireProgramAccess(analysis.programId);

    return NextResponse.json({ requestId, analysis });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED")
      return NextResponse.json({ requestId, error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN")
      return NextResponse.json({ requestId, error: "Forbidden" }, { status: 403 });
    console.error(structuredError({ requestId, route: "GET /scope-analysis/[id]", error: e }));
    return NextResponse.json({ requestId, error: "Internal server error" }, { status: 500 });
  }
}
