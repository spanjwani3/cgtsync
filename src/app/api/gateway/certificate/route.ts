import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireProgramAccess } from "@/lib/server/auth";
import { generatePdf } from "@/lib/server/pdf";
import { logEvent, getClientIp } from "@/lib/server/event-log";
import { generateRequestId, structuredError } from "@/lib/config";

/**
 * POST /api/gateway/certificate
 * Generate a one-page "Certificate of Record" PDF for a change or invoice.
 * Body: { programId, entityType: "CHANGE" | "INVOICE", entityId }
 * Returns: application/pdf
 */
export async function POST(req: NextRequest) {
  const requestId = generateRequestId();
  let userId: string | undefined;
  let programId: string | undefined;
  try {
    const body = await req.json();
    const { entityType, entityId } = body;
    programId = body.programId;

    if (!programId || !entityType || !entityId) {
      return NextResponse.json({ requestId, error: "programId, entityType, and entityId required" }, { status: 400 });
    }
    if (!["CHANGE", "INVOICE"].includes(entityType)) {
      return NextResponse.json({ requestId, error: "entityType must be CHANGE or INVOICE" }, { status: 400 });
    }

    const auth = await requireProgramAccess(programId);
    userId = auth.userId;

    // Fetch org name
    const program = await prisma.program.findUnique({
      where: { id: programId },
      select: {
        name: true, cdmoName: true, currency: true,
        org: { select: { name: true } },
      },
    });
    if (!program) {
      return NextResponse.json({ requestId, error: "Program not found" }, { status: 404 });
    }

    const orgName = program.org.name;
    const currency = program.currency;

    // Fetch event log entries for the entity
    const events = await prisma.eventLog.findMany({
      where: { entityId, entityType: entityType === "CHANGE" ? "Change" : "Invoice" },
      orderBy: { createdAt: "asc" },
      select: {
        action: true, createdAt: true,
        user: { select: { email: true } },
        metadata: true,
      },
    });

    // Format the event trail
    const trailRows = events.map((e) => ({
      label: formatAction(e.action),
      value: `${e.user?.email ?? "System"} \u2014 ${e.createdAt.toISOString().replace("T", " ").slice(0, 19)} UTC`,
    }));

    if (entityType === "CHANGE") {
      const change = await prisma.change.findUnique({
        where: { id: entityId },
        select: {
          sequenceNum: true, title: true, description: true, severity: true, status: true,
          estimatedImpact: true, scheduleImpactDays: true, reasonCode: true,
          releasedAt: true, confirmedAt: true,
          evidenceFile: { select: { sha256Hash: true, fileName: true } },
        },
      });
      if (!change) {
        return NextResponse.json({ requestId, error: "Change not found" }, { status: 404 });
      }

      const detailRows: { label: string; value: string }[] = [
        { label: "Status", value: String(change.status) },
        { label: "Severity", value: String(change.severity) },
      ];
      if (change.estimatedImpact) {
        detailRows.push({ label: "Estimated Impact", value: `${currency} ${Number(change.estimatedImpact).toLocaleString()}` });
      }
      if (change.scheduleImpactDays != null) {
        detailRows.push({ label: "Schedule Impact", value: `${change.scheduleImpactDays} days` });
      }
      if (change.reasonCode) {
        detailRows.push({ label: "Reason Code", value: change.reasonCode.replace(/_/g, " ") });
      }
      if (change.releasedAt) {
        detailRows.push({ label: "Released", value: change.releasedAt.toISOString().split("T")[0] });
      }
      if (change.confirmedAt) {
        detailRows.push({ label: "Confirmed", value: change.confirmedAt.toISOString().split("T")[0] });
      }

      const sections = [
        { title: "Change Order Details", rows: detailRows },
      ];
      if (change.description) {
        sections.push({ title: "Description", rows: [{ label: "", value: change.description }] });
      }
      if (trailRows.length > 0) {
        sections.push({ title: "Evidence Trail", rows: trailRows });
      }
      if (change.evidenceFile) {
        sections.push({
          title: "Document Fingerprint",
          rows: [
            { label: "File", value: change.evidenceFile.fileName },
            { label: "SHA-256", value: change.evidenceFile.sha256Hash },
          ],
        });
      }

      const { buffer } = await generatePdf({
        title: `Certificate of Record \u2014 Change #${change.sequenceNum}`,
        subtitle: `${change.title}\nProgram: ${program.name} \u2014 ${program.cdmoName}`,
        orgName,
        generatedBy: auth.email,
        sections,
        footer: "This certificate is a system-generated proof of record from CGT Sync.",
      });

      await logEvent({
        programId, userId, action: "EXPORT_GENERATED",
        entityType: "Change", entityId,
        metadata: { type: "CERTIFICATE", sequenceNum: change.sequenceNum },
        ipAddress: getClientIp(req.headers),
      });

      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="certificate-change-${change.sequenceNum}.pdf"`,
        },
      });
    }

    // ──── INVOICE CERTIFICATE ────
    const invoice = await prisma.invoice.findUnique({
      where: { id: entityId },
      select: {
        invoiceNumber: true, vendorName: true, status: true,
        totalAmount: true, currency: true, invoiceDate: true, dueDate: true,
        evidenceFile: { select: { sha256Hash: true, fileName: true } },
      },
    });
    if (!invoice) {
      return NextResponse.json({ requestId, error: "Invoice not found" }, { status: 404 });
    }

    const invDetailRows = [
      { label: "Invoice Number", value: invoice.invoiceNumber ?? "N/A" },
      { label: "Vendor", value: invoice.vendorName ?? "N/A" },
      { label: "Status", value: invoice.status },
    ];
    if (invoice.totalAmount) {
      invDetailRows.push({ label: "Total Amount", value: `${invoice.currency} ${Number(invoice.totalAmount).toLocaleString()}` });
    }
    if (invoice.invoiceDate) {
      invDetailRows.push({ label: "Invoice Date", value: invoice.invoiceDate.toISOString().split("T")[0] });
    }
    if (invoice.dueDate) {
      invDetailRows.push({ label: "Due Date", value: invoice.dueDate.toISOString().split("T")[0] });
    }

    const invSections = [
      { title: "Invoice Details", rows: invDetailRows },
    ];
    if (trailRows.length > 0) {
      invSections.push({ title: "Evidence Trail", rows: trailRows });
    }
    if (invoice.evidenceFile) {
      invSections.push({
        title: "Document Fingerprint",
        rows: [
          { label: "File", value: invoice.evidenceFile.fileName },
          { label: "SHA-256", value: invoice.evidenceFile.sha256Hash },
        ],
      });
    }

    const { buffer: invBuffer } = await generatePdf({
      title: `Certificate of Record \u2014 Invoice ${invoice.invoiceNumber ?? entityId.slice(0, 8)}`,
      subtitle: `${invoice.vendorName ?? "Vendor"}\nProgram: ${program.name} \u2014 ${program.cdmoName}`,
      orgName,
      generatedBy: auth.email,
      sections: invSections,
      footer: "This certificate is a system-generated proof of record from CGT Sync.",
    });

    await logEvent({
      programId, userId, action: "EXPORT_GENERATED",
      entityType: "Invoice", entityId,
      metadata: { type: "CERTIFICATE", invoiceNumber: invoice.invoiceNumber },
      ipAddress: getClientIp(req.headers),
    });

    return new NextResponse(new Uint8Array(invBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="certificate-invoice-${invoice.invoiceNumber ?? entityId.slice(0, 8)}.pdf"`,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED") return NextResponse.json({ requestId, error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN") return NextResponse.json({ requestId, error: "Forbidden" }, { status: 403 });
    console.error(structuredError({ requestId, route: "/api/gateway/certificate", error: e, userId, programId }));
    return NextResponse.json({ requestId, error: "Internal server error" }, { status: 500 });
  }
}

function formatAction(action: string): string {
  const map: Record<string, string> = {
    CHANGE_DRAFTED: "Change drafted",
    CHANGE_RELEASED: "Change released",
    CHANGE_CONFIRMED: "Confirmed",
    CHANGE_COUNTERED: "Countered",
    CHANGE_AUTO_LOGGED: "Auto-logged (below threshold)",
    INVOICE_UPLOADED: "Invoice uploaded",
    INVOICE_MAPPED: "Invoice mapped",
    INVOICE_FLAGGED: "Invoice flagged",
    INVOICE_APPROVED: "Invoice approved",
    INVOICE_DISPUTED: "Invoice disputed",
    MAGIC_LINK_CREATED: "Confirmation link created",
    MAGIC_LINK_VIEWED: "Confirmation link viewed",
    MAGIC_LINK_CONFIRMED: "Confirmed via link",
    EVIDENCE_UPLOADED: "Evidence uploaded",
    EVIDENCE_FINALIZED: "Evidence finalized",
  };
  return map[action] ?? action.replace(/_/g, " ").toLowerCase();
}
