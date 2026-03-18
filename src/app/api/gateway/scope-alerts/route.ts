import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireProgramAccess } from "@/lib/server/auth";
import { generateRequestId, structuredError } from "@/lib/config";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_STATUSES = new Set(["OPEN", "RESOLVED", "CONVERTED", "DISMISSED"]);

/**
 * GET /api/gateway/scope-alerts?programId=...&status=OPEN
 * List scope alerts for a program.
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

    const status = req.nextUrl.searchParams.get("status");
    const where: Record<string, unknown> = { programId };
    if (status && VALID_STATUSES.has(status)) {
      where.status = status;
    }

    const alerts = await prisma.scopeAlert.findMany({
      where,
      include: {
        matchedClause: {
          select: { id: true, clauseRef: true, title: true, type: true, value: true, unit: true },
        },
        convertedChange: {
          select: { id: true, sequenceNum: true, title: true, status: true },
        },
        analysisJob: {
          select: { id: true, meetingTitle: true, meetingDate: true, source: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const stats = {
      total: alerts.length,
      open: alerts.filter((a) => a.status === "OPEN").length,
      converted: alerts.filter((a) => a.status === "CONVERTED").length,
      dismissed: alerts.filter((a) => a.status === "DISMISSED").length,
    };

    return NextResponse.json({ requestId, alerts, stats });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED")
      return NextResponse.json({ requestId, error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN")
      return NextResponse.json({ requestId, error: "Forbidden" }, { status: 403 });
    console.error(structuredError({ requestId, route: "GET /scope-alerts", error: e }));
    return NextResponse.json({ requestId, error: "Internal server error" }, { status: 500 });
  }
}
