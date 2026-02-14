import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { OrgRole } from "@/generated/prisma/client";
import { requireProgramAccess } from "@/lib/server/auth";
import { logEvent, getClientIp } from "@/lib/server/event-log";
import { generatePdf } from "@/lib/server/pdf";
import { uploadEvidence, getSignedUrl } from "@/lib/server/storage";
import { v4 as uuidv4 } from "uuid";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { invoiceId } = body;
    if (!invoiceId) return NextResponse.json({ error: "invoiceId required" }, { status: 400 });

    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        lineItems: { where: { flag: { not: "NONE" } }, include: { clause: true, change: true }, orderBy: { sortOrder: "asc" } },
        program: true,
      },
    });
    if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    const auth = await requireProgramAccess(invoice.programId, OrgRole.OPERATOR);

    const { buffer, sha256Hash } = await generatePdf({
      title: "Dispute Packet",
      subtitle: `Invoice: ${invoice.invoiceNumber ?? invoiceId} — ${invoice.program.name}`,
      generatedBy: auth.email,
      sections: [
        {
          title: "Invoice Summary",
          rows: [
            { label: "Invoice #:", value: invoice.invoiceNumber ?? "N/A" },
            { label: "Vendor:", value: invoice.vendorName ?? "N/A" },
            { label: "Total:", value: `${invoice.currency} ${invoice.totalAmount ?? "N/A"}` },
            { label: "Status:", value: invoice.status },
          ],
        },
        {
          title: "Flagged Line Items",
          rows: invoice.lineItems.map((li) => ({
            label: `[${li.flag}]`,
            value: `${li.description} — ${li.amount}${li.flagNote ? ` (${li.flagNote})` : ""}`,
          })),
        },
      ],
      footer: "This document is generated for dispute purposes. All amounts subject to verification.",
    });

    const fileName = `dispute_${invoice.invoiceNumber ?? invoiceId}_${Date.now()}.pdf`;
    const storagePath = `${invoice.programId}/disputes/${uuidv4()}/${fileName}`;
    await uploadEvidence(buffer, storagePath, "application/pdf");

    // Mark invoice as disputed
    await prisma.invoice.update({ where: { id: invoiceId }, data: { status: "DISPUTED" } });

    await logEvent({
      programId: invoice.programId, userId: auth.userId, action: "INVOICE_DISPUTED",
      entityType: "Invoice", entityId: invoiceId,
      metadata: { flaggedItemCount: invoice.lineItems.length, fileName },
      ipAddress: getClientIp(req.headers),
    });

    const signedUrl = await getSignedUrl(`evidence/${storagePath}`);
    return NextResponse.json({ fileName, sha256Hash, signedUrl }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    console.error("Dispute packet error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
