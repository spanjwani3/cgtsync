import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { OrgRole, ExportType } from "@/generated/prisma/client";
import { requireProgramAccess } from "@/lib/server/auth";
import { logEvent, getClientIp } from "@/lib/server/event-log";
import { generatePdf } from "@/lib/server/pdf";
import { generateDisputePdf } from "@/lib/server/dispute-pdf";
import { uploadEvidence, getSignedUrl } from "@/lib/server/storage";
import { v4 as uuidv4 } from "uuid";
import { CHANGE_BASE_SELECT, CHANGE_INCLUDE_SELECT } from "@/lib/server/change-compat";

const VALID_EXPORT_TYPES = new Set(Object.values(ExportType));

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { programId, type } = body;
    if (!programId || !type) return NextResponse.json({ error: "programId and type required" }, { status: 400 });
    if (!VALID_EXPORT_TYPES.has(type)) {
      return NextResponse.json(
        { error: `type must be one of: ${Object.values(ExportType).join(", ")}` },
        { status: 400 }
      );
    }
    const auth = await requireProgramAccess(programId, OrgRole.OPERATOR);

    const program = await prisma.program.findUnique({ where: { id: programId } });
    if (!program) return NextResponse.json({ error: "Program not found" }, { status: 404 });

    const org = await prisma.organization.findUnique({
      where: { id: program.orgId },
      select: { name: true, logoUrl: true },
    });

    let logoBuffer: Buffer | undefined;
    if (org?.logoUrl) {
      try {
        const signedLogoUrl = await getSignedUrl(org.logoUrl);
        const logoRes = await fetch(signedLogoUrl);
        if (logoRes.ok) {
          logoBuffer = Buffer.from(await logoRes.arrayBuffer());
        }
      } catch {
        // proceed without logo
      }
    }

    let buffer: Buffer;
    let sha256Hash: string;

    if (type === "DISPUTE_PACKET") {
      // Use the rich forensic dispute PDF generator
      const invoice = await prisma.invoice.findFirst({
        where: { programId, lineItems: { some: { flag: { not: "NONE" } } } },
        include: {
          lineItems: {
            where: { flag: { not: "NONE" } },
            include: { clause: true, change: CHANGE_INCLUDE_SELECT },
            orderBy: { sortOrder: "asc" },
          },
          program: true,
        },
        orderBy: { createdAt: "desc" },
      });
      if (!invoice || invoice.lineItems.length === 0) {
        return NextResponse.json({ error: "No flagged line items found for dispute packet" }, { status: 400 });
      }
      const result = await generateDisputePdf({
        programName: program.name,
        cdmoName: program.cdmoName,
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.invoiceDate,
        vendorName: invoice.vendorName,
        currency: invoice.currency,
        totalAmount: invoice.totalAmount ? Number(invoice.totalAmount) : null,
        generatedBy: auth.email,
        orgName: org?.name,
        logoBuffer,
        flaggedItems: invoice.lineItems.map((li) => ({
          description: li.description,
          amount: Number(li.amount),
          flag: li.flag,
          flagNote: li.flagNote,
          clause: li.clause
            ? { clauseRef: li.clause.clauseRef, title: li.clause.title, type: li.clause.type, value: li.clause.value ? Number(li.clause.value) : null }
            : null,
          change: li.change
            ? { sequenceNum: li.change.sequenceNum, title: li.change.title, status: li.change.status, estimatedImpact: li.change.estimatedImpact ? Number(li.change.estimatedImpact) : null }
            : null,
        })),
      });
      buffer = result.buffer;
      sha256Hash = result.sha256Hash;
    } else {
      const sections = await buildExportSections(programId, type as ExportType);
      const result = await generatePdf({
        title: getExportTitle(type as ExportType),
        subtitle: `${program.name} — ${program.cdmoName}`,
        generatedBy: auth.email,
        sections,
        orgName: org?.name,
        logoBuffer,
      });
      buffer = result.buffer;
      sha256Hash = result.sha256Hash;
    }

    const fileName = `${type.toLowerCase()}_${Date.now()}.pdf`;
    const storagePath = `${programId}/exports/${uuidv4()}/${fileName}`;
    await uploadEvidence(buffer, storagePath, "application/pdf");

    const exp = await prisma.export.create({
      data: { programId, type: type as ExportType, fileName, storagePath: `evidence/${storagePath}`, sha256Hash },
    });

    await logEvent({
      programId, userId: auth.userId, action: "EXPORT_GENERATED",
      entityType: "Export", entityId: exp.id, metadata: { type, fileName },
      ipAddress: getClientIp(req.headers),
    });

    const signedUrl = await getSignedUrl(`evidence/${storagePath}`);
    return NextResponse.json({ ...exp, signedUrl }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (msg === "NOT_FOUND") return NextResponse.json({ error: "Program not found" }, { status: 404 });
    // Surface actionable infra errors (missing env vars, bucket issues)
    if (msg.startsWith("Missing ") || msg.includes("Bucket") || msg.includes("Storage")) {
      return NextResponse.json({ error: msg }, { status: 500 });
    }
    console.error("Export generation error:", e);
    return NextResponse.json({ error: msg || "Internal server error" }, { status: 500 });
  }
}

function getExportTitle(type: ExportType): string {
  const titles: Record<ExportType, string> = {
    BASELINE_PACK: "Baseline Pack",
    CHANGE_LEDGER_PACK: "Change Ledger Pack",
    INVOICE_REVIEW_PACK: "Invoice Review Pack",
    DISPUTE_PACKET: "Dispute Packet",
    WEEKLY_GOVERNANCE_PACK: "Weekly Governance Pack",
  };
  return titles[type] ?? "Export";
}

async function buildExportSections(programId: string, type: ExportType) {
  switch (type) {
    case "BASELINE_PACK": {
      const baselines = await prisma.baseline.findMany({
        where: { programId },
        include: { clauses: { orderBy: { sortOrder: "asc" } } },
        orderBy: { version: "desc" },
      });
      return baselines.map((b) => ({
        title: `Baseline v${b.version}: ${b.title} [${b.status}]`,
        rows: [
          { label: "Status:", value: b.status },
          { label: "Created:", value: b.createdAt.toISOString() },
          ...(b.lockedAt ? [{ label: "Locked:", value: b.lockedAt.toISOString() }] : []),
          ...b.clauses.map((c) => ({
            label: `  ${c.clauseRef ?? ""} [${c.type}]`,
            value: `${c.title}${c.value ? ` — ${c.value} ${c.unit ?? ""}` : ""}`,
          })),
        ],
      }));
    }
    case "CHANGE_LEDGER_PACK": {
      const changes = await prisma.change.findMany({
        where: { programId },
        select: CHANGE_BASE_SELECT,
        orderBy: { sequenceNum: "asc" },
      });
      return [
        {
          title: "Change Ledger",
          rows: changes.map((c) => ({
            label: `#${c.sequenceNum} [${c.severity}/${c.status}]`,
            value: `${c.title}${c.estimatedImpact ? ` — Impact: ${c.estimatedImpact}` : ""}`,
          })),
        },
      ];
    }
    case "INVOICE_REVIEW_PACK": {
      const invoices = await prisma.invoice.findMany({
        where: { programId },
        include: { lineItems: { include: { clause: true }, orderBy: { sortOrder: "asc" } } },
        orderBy: { createdAt: "desc" },
      });
      return invoices.map((inv) => ({
        title: `Invoice: ${inv.invoiceNumber ?? "N/A"} [${inv.status}]`,
        rows: [
          { label: "Vendor:", value: inv.vendorName ?? "N/A" },
          { label: "Total:", value: `${inv.currency} ${inv.totalAmount ?? "N/A"}` },
          ...inv.lineItems.map((li) => ({
            label: `  ${li.flag !== "NONE" ? `⚠ [${li.flag}]` : "  "} `,
            value: `${li.description} — ${li.amount}`,
          })),
        ],
      }));
    }
    case "DISPUTE_PACKET": {
      const flaggedItems = await prisma.invoiceLineItem.findMany({
        where: { invoice: { programId }, flag: { not: "NONE" } },
        include: { invoice: true, clause: true, change: CHANGE_INCLUDE_SELECT },
        orderBy: { createdAt: "desc" },
      });
      return [
        {
          title: "Disputed Line Items",
          rows: flaggedItems.map((li) => ({
            label: `[${li.flag}] Invoice ${li.invoice.invoiceNumber ?? li.invoiceId}:`,
            value: `${li.description} — ${li.amount}${li.flagNote ? ` (${li.flagNote})` : ""}`,
          })),
        },
      ];
    }
    case "WEEKLY_GOVERNANCE_PACK": {
      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const recentChanges = await prisma.change.findMany({
        where: { programId, createdAt: { gte: oneWeekAgo } },
        select: CHANGE_BASE_SELECT,
        orderBy: { createdAt: "desc" },
      });
      const recentFlags = await prisma.invoiceLineItem.findMany({
        where: { invoice: { programId }, flag: { not: "NONE" }, createdAt: { gte: oneWeekAgo } },
        include: { invoice: true },
        orderBy: { createdAt: "desc" },
      });
      return [
        {
          title: "Recent Changes (7 days)",
          rows: recentChanges.length > 0
            ? recentChanges.map((c) => ({
                label: `#${c.sequenceNum} [${c.status}]`,
                value: c.title,
              }))
            : [{ label: "", value: "No changes in the last 7 days" }],
        },
        {
          title: "Recent Flags (7 days)",
          rows: recentFlags.length > 0
            ? recentFlags.map((li) => ({
                label: `[${li.flag}]`,
                value: `${li.description} — Invoice ${li.invoice.invoiceNumber ?? li.invoiceId}`,
              }))
            : [{ label: "", value: "No flags in the last 7 days" }],
        },
      ];
    }
    default:
      return [{ title: "Export", rows: [{ label: "", value: "No data available for this export type" }] }];
  }
}
