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

    // Parse the action from the request body (defaults to "confirm" for backwards compat)
    let action: "confirm" | "counter" = "confirm";
    let note: string | undefined;
    try {
      const body = await req.json();
      if (body.action === "counter") action = "counter";
      if (typeof body.note === "string" && body.note.trim()) {
        note = body.note.trim().slice(0, 2000);
      }
    } catch {
      // No body or invalid JSON — default to confirm
    }

    // Counter requires a note
    if (action === "counter" && !note) {
      return NextResponse.json({ error: "A note is required when countering" }, { status: 400 });
    }

    const ipAddress = getClientIp(req.headers);

    if (action === "counter") {
      // --- COUNTER flow: set status to COUNTERED and save note ---
      if (link.scope === "BASELINE_CONFIRM") {
        const baseline = await prisma.baseline.findUnique({ where: { id: link.entityId } });
        if (baseline && baseline.status === "RELEASED") {
          await prisma.baseline.update({
            where: { id: link.entityId },
            data: { status: "COUNTERED", counterpartyNote: note },
          });
          await logEvent({
            programId: baseline.programId, action: "BASELINE_COUNTERED",
            entityType: "Baseline", entityId: baseline.id,
            metadata: { counterpartyNote: note ?? "", viaMagicLink: true },
            ipAddress,
          });
        }
      } else if (link.scope === "CHANGE_CONFIRM") {
        const change = await prisma.change.findUnique({ where: { id: link.entityId }, select: CHANGE_BASE_SELECT });
        if (change && change.status === "RELEASED") {
          await prisma.change.update({
            where: { id: link.entityId },
            data: { status: "COUNTERED", counterpartyNote: note },
          });
          await logEvent({
            programId: change.programId, action: "CHANGE_COUNTERED",
            entityType: "Change", entityId: change.id,
            metadata: { counterpartyNote: note ?? "", viaMagicLink: true },
            ipAddress,
          });
        }
      }

      // Mark the magic link as used (confirmed) so it can't be reused
      await confirmMagicLink(link.id, ipAddress);

      return NextResponse.json({ countered: true });
    }

    // --- CONFIRM flow (existing behavior) ---
    const confirmed = await confirmMagicLink(link.id, ipAddress);

    if (confirmed.scope === "BASELINE_CONFIRM") {
      const baseline = await prisma.baseline.findUnique({ where: { id: confirmed.entityId } });
      if (baseline && (baseline.status === "RELEASED" || baseline.status === "COUNTERED")) {
        await prisma.baseline.update({
          where: { id: confirmed.entityId },
          data: { status: "CONFIRMED", confirmedAt: new Date(), ...(note ? { counterpartyNote: note } : {}) },
        });
        await logEvent({
          programId: baseline.programId, action: "BASELINE_CONFIRMED",
          entityType: "Baseline", entityId: baseline.id,
          metadata: { confirmedViaMagicLink: true, ...(note ? { counterpartyNote: note } : {}) },
          ipAddress,
        });
      }
    } else if (confirmed.scope === "CHANGE_CONFIRM") {
      const change = await prisma.change.findUnique({ where: { id: confirmed.entityId }, select: CHANGE_BASE_SELECT });
      if (change && (change.status === "RELEASED" || change.status === "COUNTERED")) {
        await prisma.change.update({
          where: { id: confirmed.entityId },
          data: { status: "CONFIRMED", confirmedAt: new Date(), ...(note ? { counterpartyNote: note } : {}) },
        });
        await logEvent({
          programId: change.programId, action: "CHANGE_CONFIRMED",
          entityType: "Change", entityId: change.id,
          metadata: { confirmedViaMagicLink: true, ...(note ? { counterpartyNote: note } : {}) },
          ipAddress,
        });
      }
    }

    return NextResponse.json({ confirmed: true });
  } catch (e) {
    console.error("Magic link confirm error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
