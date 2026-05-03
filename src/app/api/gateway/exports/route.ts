import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { OrgRole, ExportType } from "@/generated/prisma/client";
import { requireProgramAccess } from "@/lib/server/auth";
import { logEvent, getClientIp } from "@/lib/server/event-log";
import { generatePdf } from "@/lib/server/pdf";
import { generateDisputePdf } from "@/lib/server/dispute-pdf";
import { getOrgBranding } from "@/lib/server/org-branding";
import { uploadEvidence, getSignedUrl } from "@/lib/server/storage";
import { v4 as uuidv4 } from "uuid";
import { CHANGE_BASE_SELECT, CHANGE_INCLUDE_SELECT } from "@/lib/server/change-compat";

const VALID_EXPORT_TYPES = new Set(Object.values(ExportType));

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const programId = searchParams.get("programId");
    const type = searchParams.get("type");

    if (!programId) {
      return NextResponse.json({ error: "programId is required" }, { status: 400 });
    }
    if (type && !VALID_EXPORT_TYPES.has(type as ExportType)) {
      return NextResponse.json(
        { error: `type must be one of: ${Object.values(ExportType).join(", ")}` },
        { status: 400 }
      );
    }

    await requireProgramAccess(programId, OrgRole.OPERATOR);

    const where: Record<string, unknown> = { programId };
    if (type) where.type = type;

    const exports = await prisma.export.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return NextResponse.json(exports);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (msg === "NOT_FOUND") return NextResponse.json({ error: "Program not found" }, { status: 404 });
    console.error("Export list error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

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
      select: { name: true, logoUrl: true, accentColor: true },
    });
    const branding = await getOrgBranding(program.orgId);

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
        accentColor: branding.accentColor,
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
        accentColor: branding.accentColor,
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

function fmtCurrency(n: unknown, currency: string): string {
  if (n == null) return "N/A";
  const num = Number(n);
  if (isNaN(num)) return "N/A";
  return `${currency} ${num.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "N/A";
  return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

const FLAG_LABELS: Record<string, string> = {
  RATE_MISMATCH: "Rate Mismatch",
  SCOPE_CREEP: "Scope Creep",
  UNAPPROVED_CHANGE: "Unapproved Change",
  DUPLICATE: "Duplicate",
  MISSING_BASELINE: "Missing Baseline",
  ASSUMPTION_VIOLATION: "Assumption Violation",
  OTHER: "Other",
  NONE: "",
};

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
          { label: "Created:", value: fmtDate(b.createdAt) },
          ...(b.lockedAt ? [{ label: "Locked:", value: fmtDate(b.lockedAt) }] : []),
        ],
        table: {
          headers: [
            { label: "Clause Ref", width: 70 },
            { label: "Type", width: 65 },
            { label: "Title", width: 200 },
            { label: "Value", width: 80, align: "right" as const },
            { label: "Unit", width: 80 },
          ],
          rows: b.clauses.map((c) => [
            c.clauseRef ?? "—",
            c.type ?? "—",
            c.title,
            c.value != null ? Number(c.value).toLocaleString() : "—",
            c.unit ?? "—",
          ]),
        },
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
          rows: [
            { label: "Total Changes:", value: String(changes.length) },
          ],
          table: {
            headers: [
              { label: "#", width: 35 },
              { label: "Title", width: 210 },
              { label: "Severity", width: 70 },
              { label: "Status", width: 80 },
              { label: "Est. Impact", width: 100, align: "right" as const },
            ],
            rows: changes.map((c) => [
              String(c.sequenceNum),
              c.title,
              c.severity,
              c.status,
              c.estimatedImpact != null ? Number(c.estimatedImpact).toLocaleString() : "—",
            ]),
          },
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
          { label: "Date:", value: fmtDate(inv.invoiceDate) },
          { label: "Total:", value: fmtCurrency(inv.totalAmount, inv.currency) },
        ],
        table: {
          headers: [
            { label: "Description", width: 195 },
            { label: "Amount", width: 80, align: "right" as const },
            { label: "Flag", width: 80 },
            { label: "Clause Ref", width: 140 },
          ],
          rows: inv.lineItems.map((li) => [
            li.description.length > 50 ? li.description.slice(0, 50) + "..." : li.description,
            fmtCurrency(li.amount, inv.currency),
            FLAG_LABELS[li.flag] ?? li.flag,
            li.clause?.clauseRef ?? li.clause?.title ?? "—",
          ]),
        },
      }));
    }
    case "DISPUTE_PACKET": {
      // This path is a fallback — the rich generateDisputePdf is used above
      const flaggedItems = await prisma.invoiceLineItem.findMany({
        where: { invoice: { programId }, flag: { not: "NONE" } },
        include: { invoice: true, clause: true, change: CHANGE_INCLUDE_SELECT },
        orderBy: { createdAt: "desc" },
      });
      return [
        {
          title: "Disputed Line Items",
          table: {
            headers: [
              { label: "Flag", width: 80 },
              { label: "Description", width: 195 },
              { label: "Amount", width: 80, align: "right" as const },
              { label: "Invoice #", width: 80 },
              { label: "Note", width: 60 },
            ],
            rows: flaggedItems.map((li) => [
              FLAG_LABELS[li.flag] ?? li.flag,
              li.description.length > 50 ? li.description.slice(0, 50) + "..." : li.description,
              Number(li.amount).toLocaleString(),
              li.invoice.invoiceNumber ?? "N/A",
              li.flagNote ?? "—",
            ]),
          },
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
          title: `Recent Changes (Last 7 Days)`,
          rows: recentChanges.length === 0 ? [{ label: "", value: "No changes in the last 7 days" }] : undefined,
          table: recentChanges.length > 0
            ? {
                headers: [
                  { label: "#", width: 35 },
                  { label: "Title", width: 280 },
                  { label: "Status", width: 80 },
                  { label: "Date", width: 100 },
                ],
                rows: recentChanges.map((c) => [
                  String(c.sequenceNum),
                  c.title,
                  c.status,
                  fmtDate(c.createdAt),
                ]),
              }
            : undefined,
        },
        {
          title: `Recent Flags (Last 7 Days)`,
          rows: recentFlags.length === 0 ? [{ label: "", value: "No flags in the last 7 days" }] : undefined,
          table: recentFlags.length > 0
            ? {
                headers: [
                  { label: "Flag", width: 80 },
                  { label: "Description", width: 215 },
                  { label: "Invoice #", width: 100 },
                  { label: "Date", width: 100 },
                ],
                rows: recentFlags.map((li) => [
                  FLAG_LABELS[li.flag] ?? li.flag,
                  li.description.length > 55 ? li.description.slice(0, 55) + "..." : li.description,
                  li.invoice.invoiceNumber ?? "N/A",
                  fmtDate(li.createdAt),
                ]),
              }
            : undefined,
        },
      ];
    }
    default:
      return [{ title: "Export", rows: [{ label: "", value: "No data available for this export type" }] }];
  }
}
