import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { OrgRole, EventAction } from "@/generated/prisma/client";
import { requireProgramAccess } from "@/lib/server/auth";
import { logEvent, getClientIp } from "@/lib/server/event-log";
import { CHANGE_INCLUDE_SELECT } from "@/lib/server/change-compat";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  try {
    const { invoiceId } = await params;
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        lineItems: {
          include: { clause: true, change: CHANGE_INCLUDE_SELECT },
          orderBy: { sortOrder: "asc" },
        },
        evidenceFile: true,
      },
    });
    if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await requireProgramAccess(invoice.programId);
    return NextResponse.json(invoice);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    console.error("[GET /api/invoices/:id] Unhandled error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  try {
    const { invoiceId } = await params;
    const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const auth = await requireProgramAccess(invoice.programId, OrgRole.OPERATOR);
    const body = await req.json();
    const allowedFields = ["invoiceNumber", "vendorName", "invoiceDate", "totalAmount", "currency", "status"];
    const data: Record<string, unknown> = {};
    for (const f of allowedFields) {
      if (f in body) data[f] = f === "invoiceDate" ? new Date(body[f]) : body[f];
    }
    const updated = await prisma.invoice.update({ where: { id: invoiceId }, data });

    if (body.status) {
      const actionMap: Record<string, EventAction> = {
        MAPPED: EventAction.INVOICE_MAPPED,
        FLAGGED: EventAction.INVOICE_FLAGGED,
        APPROVED: EventAction.INVOICE_APPROVED,
        DISPUTED: EventAction.INVOICE_DISPUTED,
      };
      if (actionMap[body.status]) {
        await logEvent({
          programId: invoice.programId, userId: auth.userId, action: actionMap[body.status],
          entityType: "Invoice", entityId: invoiceId, ipAddress: getClientIp(req.headers),
        });
      }
    }

    return NextResponse.json(updated);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    console.error("[PATCH /api/invoices/:id] Unhandled error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
