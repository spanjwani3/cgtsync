import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { OrgRole } from "@/generated/prisma/client";
import { requireProgramAccess } from "@/lib/server/auth";
import { logEvent, getClientIp } from "@/lib/server/event-log";
import { uploadEvidence, getSignedUrl } from "@/lib/server/storage";
import { v4 as uuidv4 } from "uuid";
import { CHANGE_INCLUDE_SELECT } from "@/lib/server/change-compat";
import { generateDisputePdf } from "@/lib/server/dispute-pdf";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { invoiceId } = body;
    if (!invoiceId) return NextResponse.json({ error: "invoiceId required" }, { status: 400 });

    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        lineItems: {
          where: { flag: { not: "NONE" } },
          include: { clause: true, change: CHANGE_INCLUDE_SELECT },
          orderBy: { sortOrder: "asc" },
        },
        program: true,
      },
    });
    if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    const auth = await requireProgramAccess(invoice.programId, OrgRole.OPERATOR);

    const { buffer, sha256Hash } = await generateDisputePdf({
      programName: invoice.program.name,
      cdmoName: invoice.program.cdmoName,
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.invoiceDate,
      vendorName: invoice.vendorName,
      currency: invoice.currency,
      totalAmount: invoice.totalAmount ? Number(invoice.totalAmount) : null,
      generatedBy: auth.email,
      flaggedItems: invoice.lineItems.map((li) => ({
        description: li.description,
        amount: Number(li.amount),
        flag: li.flag,
        flagNote: li.flagNote,
        clause: li.clause
          ? {
              clauseRef: li.clause.clauseRef,
              title: li.clause.title,
              type: li.clause.type,
              value: li.clause.value ? Number(li.clause.value) : null,
            }
          : null,
        change: li.change
          ? {
              sequenceNum: li.change.sequenceNum,
              title: li.change.title,
              status: li.change.status,
              estimatedImpact: li.change.estimatedImpact ? Number(li.change.estimatedImpact) : null,
            }
          : null,
      })),
    });

    const fileName = `dispute_${invoice.invoiceNumber ?? invoiceId}_${Date.now()}.pdf`;
    const storagePath = `${invoice.programId}/disputes/${uuidv4()}/${fileName}`;
    await uploadEvidence(buffer, storagePath, "application/pdf");

    // Create Evidence record so it appears in the evidence log
    await prisma.evidence.create({
      data: {
        programId: invoice.programId,
        type: "DISPUTE_PACKET",
        fileName,
        fileSize: buffer.length,
        mimeType: "application/pdf",
        storagePath: `evidence/${storagePath}`,
        sha256Hash,
      },
    });

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
