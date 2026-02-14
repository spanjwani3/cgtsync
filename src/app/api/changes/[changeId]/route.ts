import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { OrgRole, EventAction } from "@/generated/prisma/client";
import { requireProgramAccess } from "@/lib/server/auth";
import { logEvent, getClientIp } from "@/lib/server/event-log";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ changeId: string }> }
) {
  try {
    const { changeId } = await params;
    const change = await prisma.change.findUnique({
      where: { id: changeId },
      include: { baseline: { select: { title: true, version: true } }, evidenceFile: true },
    });
    if (!change) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await requireProgramAccess(change.programId);
    return NextResponse.json(change);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ changeId: string }> }
) {
  try {
    const { changeId } = await params;
    const change = await prisma.change.findUnique({ where: { id: changeId } });
    if (!change) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const auth = await requireProgramAccess(change.programId, OrgRole.OPERATOR);
    const body = await req.json();
    const { status, evidenceFileId } = body;
    const data: Record<string, unknown> = {};
    if (evidenceFileId) data.evidenceFileId = evidenceFileId;

    if (status) {
      const transitions: Record<string, string[]> = {
        DRAFT: ["RELEASED"],
        RELEASED: ["CONFIRMED", "LOGGED"],
      };
      const allowed = transitions[change.status] ?? [];
      if (!allowed.includes(status)) {
        return NextResponse.json({ error: `Cannot transition from ${change.status} to ${status}` }, { status: 400 });
      }

      // One-Way Valve: auto-log below threshold
      if (status === "CONFIRMED" || status === "RELEASED") {
        const program = await prisma.program.findUnique({ where: { id: change.programId }, select: { changeThreshold: true } });
        if (
          status === "RELEASED" &&
          program?.changeThreshold &&
          change.estimatedImpact &&
          Number(change.estimatedImpact) < Number(program.changeThreshold)
        ) {
          // Auto-log: skip directly to LOGGED
          data.status = "LOGGED";
          data.releasedAt = new Date();
          data.confirmedAt = new Date();
          await logEvent({
            programId: change.programId, userId: auth.userId, action: EventAction.CHANGE_AUTO_LOGGED,
            entityType: "Change", entityId: changeId,
            metadata: { estimatedImpact: Number(change.estimatedImpact), threshold: Number(program.changeThreshold) },
            ipAddress: getClientIp(req.headers),
          });
        } else {
          data.status = status;
          if (status === "RELEASED") data.releasedAt = new Date();
          if (status === "CONFIRMED") data.confirmedAt = new Date();
        }
      } else {
        data.status = status;
      }
    }

    const updated = await prisma.change.update({ where: { id: changeId }, data });

    if (status && data.status !== "LOGGED") {
      const actionMap: Record<string, EventAction> = {
        RELEASED: EventAction.CHANGE_RELEASED,
        CONFIRMED: EventAction.CHANGE_CONFIRMED,
      };
      if (actionMap[status]) {
        await logEvent({
          programId: change.programId, userId: auth.userId, action: actionMap[status],
          entityType: "Change", entityId: changeId, ipAddress: getClientIp(req.headers),
        });
      }
    }

    return NextResponse.json(updated);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
