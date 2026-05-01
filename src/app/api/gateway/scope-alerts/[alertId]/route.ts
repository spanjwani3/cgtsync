import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { OrgRole } from "@/generated/prisma/client";
import { requireProgramAccess } from "@/lib/server/auth";
import { generateRequestId, structuredError } from "@/lib/config";
import { resolveAlert } from "@/lib/server/scope-analysis";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/gateway/scope-alerts/[alertId]
 * Get a single scope alert with full context.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ alertId: string }> },
) {
  const requestId = generateRequestId();
  try {
    const { alertId } = await params;
    if (!UUID_RE.test(alertId)) {
      return NextResponse.json(
        { requestId, error: "Invalid alertId" },
        { status: 400 },
      );
    }

    const alert = await prisma.scopeAlert.findUnique({
      where: { id: alertId },
      include: {
        matchedClause: {
          select: { id: true, clauseRef: true, title: true, type: true, description: true, value: true, unit: true },
        },
        convertedChange: {
          select: { id: true, sequenceNum: true, title: true, status: true, estimatedImpact: true },
        },
        analysisJob: {
          select: { id: true, meetingTitle: true, meetingDate: true, source: true, summary: true },
        },
      },
    });

    if (!alert) {
      return NextResponse.json({ requestId, error: "Alert not found" }, { status: 404 });
    }

    await requireProgramAccess(alert.programId);

    return NextResponse.json({ requestId, alert });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED")
      return NextResponse.json({ requestId, error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN")
      return NextResponse.json({ requestId, error: "Forbidden" }, { status: 403 });
    console.error(structuredError({ requestId, route: "GET /scope-alerts/[id]", error: e }));
    return NextResponse.json({ requestId, error: "Internal server error" }, { status: 500 });
  }
}

/**
 * PATCH /api/gateway/scope-alerts/[alertId]
 * Resolve a scope alert.
 * Body: { action: "DISMISS" | "CONVERT_TO_CHANGE", resolvedNote? }
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ alertId: string }> },
) {
  const requestId = generateRequestId();
  let userId: string | undefined;
  try {
    const { alertId } = await params;
    if (!UUID_RE.test(alertId)) {
      return NextResponse.json(
        { requestId, error: "Invalid alertId" },
        { status: 400 },
      );
    }

    const body = await req.json();
    const action = body.action as string;
    if (action !== "DISMISS" && action !== "CONVERT_TO_CHANGE") {
      return NextResponse.json(
        { requestId, error: "action must be DISMISS or CONVERT_TO_CHANGE" },
        { status: 400 },
      );
    }

    // Look up alert to get programId for auth
    const existing = await prisma.scopeAlert.findUnique({
      where: { id: alertId },
      select: { programId: true },
    });
    if (!existing) {
      return NextResponse.json({ requestId, error: "Alert not found" }, { status: 404 });
    }

    const auth = await requireProgramAccess(existing.programId, OrgRole.OPERATOR);
    userId = auth.userId;

    const result = await resolveAlert(alertId, action, userId, body.resolvedNote);

    return NextResponse.json({ requestId, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED")
      return NextResponse.json({ requestId, error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN")
      return NextResponse.json({ requestId, error: "Forbidden" }, { status: 403 });
    if (msg === "ALERT_ALREADY_RESOLVED")
      return NextResponse.json(
        { requestId, error: "Alert has already been resolved" },
        { status: 400 },
      );
    console.error(structuredError({ requestId, route: "PATCH /scope-alerts/[id]", error: e, userId }));
    return NextResponse.json({ requestId, error: "Internal server error" }, { status: 500 });
  }
}
