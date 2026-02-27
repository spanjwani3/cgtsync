import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateMagicLink, recordMagicLinkView, confirmMagicLink } from "@/lib/server/magic-link";
import { logEvent, getClientIp } from "@/lib/server/event-log";
import { getChangeSelect, CHANGE_BASE_SELECT, hasChangeExtendedColumns } from "@/lib/server/change-compat";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const link = await validateMagicLink(token);
    if (!link) return NextResponse.json({ error: "Invalid or expired link" }, { status: 404 });

    // Record view in background — don't let it block or fail the response
    recordMagicLinkView(link.id, getClientIp(req.headers)).catch((e) =>
      console.error("recordMagicLinkView error (non-blocking):", e)
    );

    // Return the entity data based on scope
    let entity = null;
    if (link.scope === "BASELINE_CONFIRM") {
      entity = await prisma.baseline.findUnique({
        where: { id: link.entityId },
        select: {
          id: true, title: true, version: true, status: true, programId: true,
          releasedAt: true, confirmedAt: true,
          clauses: { orderBy: { sortOrder: "asc" } },
          program: { select: { name: true, cdmoName: true } },
        },
      });
    } else if (link.scope === "CHANGE_CONFIRM") {
      // Try detected select; fall back to base select if the query fails
      try {
        const changeSelect = await getChangeSelect(prisma);
        entity = await prisma.change.findUnique({
          where: { id: link.entityId },
          select: { ...changeSelect, program: { select: { name: true, cdmoName: true } } },
        });
      } catch (selectErr) {
        console.error("Change extended select failed, falling back to base:", selectErr);
        entity = await prisma.change.findUnique({
          where: { id: link.entityId },
          select: { ...CHANGE_BASE_SELECT, program: { select: { name: true, cdmoName: true } } },
        });
      }
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
    const migrationApplied = await hasChangeExtendedColumns(prisma);

    if (action === "counter") {
      // Counter requires COUNTERED enum + counterparty_note column (from migration)
      if (!migrationApplied) {
        return NextResponse.json(
          { error: "Counter is not available yet. Please run the latest database migration." },
          { status: 503 },
        );
      }

      // --- COUNTER flow: set status to COUNTERED and save note ---
      if (link.scope === "BASELINE_CONFIRM") {
        const baseline = await prisma.baseline.findUnique({ where: { id: link.entityId }, select: { id: true, programId: true, status: true } });
        if (baseline && baseline.status === "RELEASED") {
          await prisma.baseline.update({
            where: { id: link.entityId },
            data: { status: "COUNTERED", counterpartyNote: note },
            select: { id: true },
          });
          await logEvent({
            programId: baseline.programId, action: "BASELINE_COUNTERED",
            entityType: "Baseline", entityId: baseline.id,
            metadata: { counterpartyNote: note ?? "", viaMagicLink: true },
            ipAddress,
          });
        }
      } else if (link.scope === "CHANGE_CONFIRM") {
        const change = await prisma.change.findUnique({ where: { id: link.entityId }, select: { id: true, programId: true, status: true } });
        if (change && change.status === "RELEASED") {
          // Raw SQL to bypass Prisma model-aware SQL that references non-existent columns
          await prisma.$executeRawUnsafe(
            `UPDATE "changes" SET "status" = 'COUNTERED'::"ChangeStatus", "counterparty_note" = $1, "updated_at" = NOW() WHERE "id" = $2::uuid`,
            note, link.entityId
          );
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

    // Only include counterpartyNote in data if migration has been applied
    const noteData = (note && migrationApplied) ? { counterpartyNote: note } : {};

    if (confirmed.scope === "BASELINE_CONFIRM") {
      const baseline = await prisma.baseline.findUnique({ where: { id: confirmed.entityId }, select: { id: true, programId: true, status: true } });
      if (baseline && (baseline.status === "RELEASED" || baseline.status === "COUNTERED")) {
        await prisma.baseline.update({
          where: { id: confirmed.entityId },
          data: { status: "CONFIRMED", confirmedAt: new Date(), ...noteData },
          select: { id: true },
        });
        await logEvent({
          programId: baseline.programId, action: "BASELINE_CONFIRMED",
          entityType: "Baseline", entityId: baseline.id,
          metadata: { confirmedViaMagicLink: true, ...(note ? { counterpartyNote: note } : {}) },
          ipAddress,
        });
      }
    } else if (confirmed.scope === "CHANGE_CONFIRM") {
      const change = await prisma.change.findUnique({ where: { id: confirmed.entityId }, select: { id: true, programId: true, status: true } });
      if (change && (change.status === "RELEASED" || change.status === "COUNTERED")) {
        // Raw SQL to bypass Prisma model-aware SQL that references non-existent columns
        if (note && migrationApplied) {
          await prisma.$executeRawUnsafe(
            `UPDATE "changes" SET "status" = 'CONFIRMED'::"ChangeStatus", "confirmed_at" = NOW(), "counterparty_note" = $1, "updated_at" = NOW() WHERE "id" = $2::uuid AND "status" IN ('RELEASED', 'COUNTERED')`,
            note, confirmed.entityId
          );
        } else {
          await prisma.$executeRawUnsafe(
            `UPDATE "changes" SET "status" = 'CONFIRMED'::"ChangeStatus", "confirmed_at" = NOW(), "updated_at" = NOW() WHERE "id" = $1::uuid AND "status" IN ('RELEASED', 'COUNTERED')`,
            confirmed.entityId
          );
        }
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
