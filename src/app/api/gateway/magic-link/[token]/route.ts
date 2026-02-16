import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateMagicLink, recordMagicLinkView, confirmMagicLink } from "@/lib/server/magic-link";
import { logEvent, getClientIp } from "@/lib/server/event-log";
import { getChangeSelect, CHANGE_BASE_SELECT } from "@/lib/server/change-compat";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const link = await validateMagicLink(token);
    if (!link) return NextResponse.json({ error: "Invalid or expired link" }, { status: 404 });

    await recordMagicLinkView(link.id, getClientIp(req.headers));

    // Return the entity data based on scope
    let entity = null;
    if (link.scope === "BASELINE_CONFIRM") {
      entity = await prisma.baseline.findUnique({
        where: { id: link.entityId },
        include: { clauses: { orderBy: { sortOrder: "asc" } }, program: { select: { name: true, cdmoName: true } } },
      });
    } else if (link.scope === "CHANGE_CONFIRM") {
      const changeSelect = await getChangeSelect(prisma);
      entity = await prisma.change.findUnique({
        where: { id: link.entityId },
        select: { ...changeSelect, program: { select: { name: true, cdmoName: true } } },
      });
    }

    return NextResponse.json({ link: { id: link.id, scope: link.scope, expiresAt: link.expiresAt, singleUse: link.singleUse, confirmedAt: link.confirmedAt }, entity });
  } catch (e) {
    console.error("Magic link view error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const link = await validateMagicLink(token);
    if (!link) return NextResponse.json({ error: "Invalid or expired link" }, { status: 404 });
    if (link.confirmedAt) return NextResponse.json({ error: "Already confirmed" }, { status: 400 });

    const confirmed = await confirmMagicLink(link.id, getClientIp(req.headers));

    // Trigger state transition based on scope
    if (confirmed.scope === "BASELINE_CONFIRM") {
      const baseline = await prisma.baseline.findUnique({ where: { id: confirmed.entityId } });
      if (baseline && baseline.status === "RELEASED") {
        await prisma.baseline.update({ where: { id: confirmed.entityId }, data: { status: "CONFIRMED", confirmedAt: new Date() } });
        await logEvent({
          programId: baseline.programId, action: "BASELINE_CONFIRMED",
          entityType: "Baseline", entityId: baseline.id,
          metadata: { confirmedViaMagicLink: true },
          ipAddress: getClientIp(req.headers),
        });
      }
    } else if (confirmed.scope === "CHANGE_CONFIRM") {
      const change = await prisma.change.findUnique({ where: { id: confirmed.entityId }, select: CHANGE_BASE_SELECT });
      if (change && change.status === "RELEASED") {
        await prisma.change.update({ where: { id: confirmed.entityId }, data: { status: "CONFIRMED", confirmedAt: new Date() } });
        await logEvent({
          programId: change.programId, action: "CHANGE_CONFIRMED",
          entityType: "Change", entityId: change.id,
          metadata: { confirmedViaMagicLink: true },
          ipAddress: getClientIp(req.headers),
        });
      }
    }

    return NextResponse.json({ confirmed: true });
  } catch (e) {
    console.error("Magic link confirm error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
