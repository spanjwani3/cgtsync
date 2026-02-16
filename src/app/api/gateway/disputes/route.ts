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
        lineItems: {
          where: { flag: { not: "NONE" } },
          include: { clause: true, change: true },
          orderBy: { sortOrder: "asc" },
        },
        program: true,
      },
    });
    if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    const auth = await requireProgramAccess(invoice.programId, OrgRole.OPERATOR);

    // Build enhanced sections with SOW references and variance data
    const sections = [
      {
        title: "Invoice Summary",
        rows: [
          { label: "Invoice #:", value: invoice.invoiceNumber ?? "N/A" },
          { label: "Vendor:", value: invoice.vendorName ?? "N/A" },
          { label: "Date:", value: invoice.invoiceDate ? new Date(invoice.invoiceDate).toLocaleDateString() : "N/A" },
          { label: "Total:", value: `${invoice.currency} ${invoice.totalAmount ? Number(invoice.totalAmount).toLocaleString() : "N/A"}` },
          { label: "Status:", value: invoice.status },
          { label: "Flagged Items:", value: `${invoice.lineItems.length} of total line items` },
        ],
      },
    ];

    // Individual flagged item sections with full SOW context
    for (const li of invoice.lineItems) {
      const lineAmount = Number(li.amount);
      const flagLabel = li.flag.replace(/_/g, " ");
      const rows: { label: string; value: string }[] = [
        { label: "Description:", value: li.description },
        { label: "Invoice Amount:", value: `${invoice.currency} ${lineAmount.toLocaleString()}` },
        { label: "Flag:", value: flagLabel },
      ];

      if (li.flagNote) {
        rows.push({ label: "Note:", value: li.flagNote });
      }

      // SOW clause evidence
      if (li.clause) {
        const clauseValue = li.clause.value ? Number(li.clause.value) : null;
        rows.push({
          label: "SOW Clause:",
          value: `${li.clause.clauseRef ? `${li.clause.clauseRef} — ` : ""}${li.clause.title}`,
        });
        if (clauseValue != null) {
          rows.push({
            label: "Baseline Value:",
            value: `${invoice.currency} ${clauseValue.toLocaleString()}`,
          });
          const variance = lineAmount - clauseValue;
          const pctDiff = clauseValue !== 0 ? ((variance / Math.abs(clauseValue)) * 100).toFixed(1) : "N/A";
          rows.push({
            label: "Variance:",
            value: `${variance >= 0 ? "+" : ""}${invoice.currency} ${variance.toLocaleString()} (${variance >= 0 ? "+" : ""}${pctDiff}%)`,
          });
        }
        if (li.clause.type) {
          rows.push({ label: "Clause Type:", value: li.clause.type });
        }
      }

      // Change order evidence
      if (li.change) {
        rows.push({
          label: "Change Order:",
          value: `#${li.change.sequenceNum} — ${li.change.title}`,
        });
        if (li.change.estimatedImpact) {
          rows.push({
            label: "Estimated Impact:",
            value: `${invoice.currency} ${Number(li.change.estimatedImpact).toLocaleString()}`,
          });
        }
        rows.push({ label: "Change Status:", value: li.change.status });
      }

      // No mapping context
      if (!li.clause && !li.change) {
        rows.push({
          label: "SOW Reference:",
          value: "NONE — No matching baseline clause or confirmed change order found",
        });
      }

      sections.push({
        title: `Flagged: ${li.description.length > 50 ? li.description.slice(0, 50) + "..." : li.description}`,
        rows,
      });
    }

    const { buffer, sha256Hash } = await generatePdf({
      title: "Forensic Dispute Packet",
      subtitle: `Invoice: ${invoice.invoiceNumber ?? invoiceId} — ${invoice.program.name}`,
      generatedBy: auth.email,
      sections,
      footer: "This document is generated for dispute purposes. All amounts are referenced against the locked SOW baseline and confirmed change orders. Subject to verification.",
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
