import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { OrgRole } from "@/generated/prisma/client";
import { requireProgramAccess } from "@/lib/server/auth";
import { logEvent, getClientIp } from "@/lib/server/event-log";

export async function GET(req: NextRequest) {
  try {
    const programId = req.nextUrl.searchParams.get("programId");
    if (!programId) return NextResponse.json({ error: "programId required" }, { status: 400 });
    await requireProgramAccess(programId);
    const invoices = await prisma.invoice.findMany({
      where: { programId },
      include: { _count: { select: { lineItems: true } } },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(invoices);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (msg === "NOT_FOUND") return NextResponse.json({ error: "Not found" }, { status: 404 });
    console.error("[GET /api/invoices] Unhandled error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { programId, invoiceNumber, vendorName, invoiceDate, totalAmount, currency, evidenceFileId } = body;
    if (!programId) return NextResponse.json({ error: "programId required" }, { status: 400 });
    const auth = await requireProgramAccess(programId, OrgRole.OPERATOR);
    const invoice = await prisma.invoice.create({
      data: {
        programId, invoiceNumber: invoiceNumber ?? null, vendorName: vendorName ?? null,
        invoiceDate: invoiceDate ? new Date(invoiceDate) : null,
        totalAmount: totalAmount ?? null, currency: currency ?? "USD",
        evidenceFileId: evidenceFileId ?? null,
      },
    });
    await logEvent({
      programId, userId: auth.userId, action: "INVOICE_UPLOADED",
      entityType: "Invoice", entityId: invoice.id, metadata: { invoiceNumber },
      ipAddress: getClientIp(req.headers),
    });
    return NextResponse.json(invoice, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (msg === "NOT_FOUND") return NextResponse.json({ error: "Not found" }, { status: 404 });
    console.error("[POST /api/invoices] Unhandled error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
