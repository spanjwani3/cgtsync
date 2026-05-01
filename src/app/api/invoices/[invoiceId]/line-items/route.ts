import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { OrgRole, LineItemFlag } from "@/generated/prisma/client";
import { requireProgramAccess } from "@/lib/server/auth";
import { logEvent, getClientIp } from "@/lib/server/event-log";
import { CHANGE_INCLUDE_SELECT } from "@/lib/server/change-compat";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  try {
    const { invoiceId } = await params;
    const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { programId: true } });
    if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await requireProgramAccess(invoice.programId);
    const items = await prisma.invoiceLineItem.findMany({
      where: { invoiceId },
      include: { clause: true, change: CHANGE_INCLUDE_SELECT },
      orderBy: { sortOrder: "asc" },
    });
    return NextResponse.json(items);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    console.error("[GET /api/invoices/:id/line-items] Unhandled error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  try {
    const { invoiceId } = await params;
    const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { programId: true } });
    if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const auth = await requireProgramAccess(invoice.programId, OrgRole.OPERATOR);
    const body = await req.json();
    const { description, quantity, unitPrice, amount, clauseId, changeId } = body;
    if (!description || amount === undefined) return NextResponse.json({ error: "description and amount required" }, { status: 400 });

    // Auto-flag logic
    let flag = "NONE";
    let flagNote: string | null = null;

    if (clauseId) {
      const clause = await prisma.baselineClause.findUnique({ where: { id: clauseId }, select: { value: true, title: true } });
      if (clause?.value) {
        const diff = Math.abs(Number(amount) - Number(clause.value)) / Number(clause.value);
        if (diff > 0.05) {
          flag = "RATE_MISMATCH";
          flagNote = `Line amount ${amount} differs from clause value ${clause.value} by ${(diff * 100).toFixed(1)}%`;
        }
      }
    } else if (!changeId) {
      flag = "MISSING_BASELINE";
      flagNote = "No baseline clause or change order mapped to this line item";
    }

    const maxOrder = await prisma.invoiceLineItem.aggregate({ where: { invoiceId }, _max: { sortOrder: true } });
    const item = await prisma.invoiceLineItem.create({
      data: {
        invoiceId, description, quantity: quantity ?? null, unitPrice: unitPrice ?? null,
        amount, clauseId: clauseId ?? null, changeId: changeId ?? null,
        flag: flag as any, flagNote, sortOrder: (maxOrder._max.sortOrder ?? 0) + 1,
      },
    });

    if (flag !== "NONE") {
      await logEvent({
        programId: invoice.programId, userId: auth.userId, action: "LINE_ITEM_FLAGGED",
        entityType: "InvoiceLineItem", entityId: item.id,
        metadata: { flag, flagNote, invoiceId },
        ipAddress: getClientIp(req.headers),
      });
    }

    return NextResponse.json(item, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    console.error("[POST /api/invoices/:id/line-items] Unhandled error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * PATCH — manually flag/unflag a line item.
 * Body: { lineItemId, flag, flagNote? }
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  try {
    const { invoiceId } = await params;
    const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { programId: true } });
    if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const auth = await requireProgramAccess(invoice.programId, OrgRole.OPERATOR);
    const body = await req.json();
    const { lineItemId, flag, flagNote } = body;

    if (!lineItemId) return NextResponse.json({ error: "lineItemId required" }, { status: 400 });

    const validFlags = Object.values(LineItemFlag);
    if (!flag || !validFlags.includes(flag)) {
      return NextResponse.json({ error: `flag must be one of: ${validFlags.join(", ")}` }, { status: 400 });
    }

    const item = await prisma.invoiceLineItem.findUnique({ where: { id: lineItemId } });
    if (!item || item.invoiceId !== invoiceId) {
      return NextResponse.json({ error: "Line item not found on this invoice" }, { status: 404 });
    }

    const updated = await prisma.invoiceLineItem.update({
      where: { id: lineItemId },
      data: { flag: flag as LineItemFlag, flagNote: flagNote ?? null },
    });

    await logEvent({
      programId: invoice.programId,
      userId: auth.userId,
      action: "LINE_ITEM_FLAGGED",
      entityType: "InvoiceLineItem",
      entityId: lineItemId,
      metadata: { flag, flagNote: flagNote ?? null, invoiceId, manual: true },
      ipAddress: getClientIp(req.headers),
    });

    return NextResponse.json(updated);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    console.error("[PATCH /api/invoices/:id/line-items] Unhandled error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
