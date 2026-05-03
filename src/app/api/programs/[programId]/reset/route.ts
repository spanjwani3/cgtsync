import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireProgramAccess } from "@/lib/server/auth";
import { OrgRole } from "@/generated/prisma/client";
import { generateRequestId, structuredError } from "@/lib/config";

/**
 * Reset a program — purges all child data (baselines, changes, invoices,
 * evidence, extraction jobs, etc.) but keeps the Program shell, IngestAddress,
 * and ProgramContact rows so configuration survives. Destructive and
 * irreversible. Gated by org ADMIN role; user must type the program name to
 * confirm. Note: Evidence is hard-deleted here (vs. soft-delete via
 * `deletedAt` at /api/gateway/evidence) — this is an admin-driven reset, not
 * user evidence revocation. TODO: emit PROGRAM_RESET event once enum migration
 * ships.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ programId: string }> },
) {
  const requestId = generateRequestId();
  const { programId } = await params;
  try {
    await requireProgramAccess(programId, OrgRole.ADMIN);

    const program = await prisma.program.findUnique({
      where: { id: programId },
      select: { id: true, name: true },
    });
    if (!program) {
      return NextResponse.json(
        { requestId, error: "Not found" },
        { status: 404 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const confirmName = typeof body.confirmName === "string" ? body.confirmName.trim() : "";
    if (confirmName !== program.name) {
      return NextResponse.json(
        { requestId, error: "Confirmation does not match program name" },
        { status: 400 },
      );
    }

    const counts = await prisma.$transaction(async (tx) => {
      // Top-level program children only — grandchildren (BaselineClause,
      // InvoiceLineItem, ScopeCandidate from ScopeAnalysis, etc.) cascade
      // via Postgres FKs.
      const [
        baselines,
        changes,
        invoices,
        evidence,
        extractionJobs,
        commitmentTerms,
        exportRows,
        emailLogs,
        reminderSchedules,
        scopeAnalyses,
        scopeAlerts,
        inboundEmails,
      ] = await Promise.all([
        tx.baseline.deleteMany({ where: { programId } }),
        tx.change.deleteMany({ where: { programId } }),
        tx.invoice.deleteMany({ where: { programId } }),
        tx.evidence.deleteMany({ where: { programId } }),
        tx.extractionJob.deleteMany({ where: { programId } }),
        tx.commitmentTerm.deleteMany({ where: { programId } }),
        tx.export.deleteMany({ where: { programId } }),
        tx.emailLog.deleteMany({ where: { programId } }),
        tx.reminderSchedule.deleteMany({ where: { programId } }),
        tx.scopeAnalysis.deleteMany({ where: { programId } }),
        tx.scopeAlert.deleteMany({ where: { programId } }),
        tx.inboundEmail.deleteMany({ where: { programId } }),
      ]);
      return {
        baselines: baselines.count,
        changes: changes.count,
        invoices: invoices.count,
        evidence: evidence.count,
        extractionJobs: extractionJobs.count,
        commitmentTerms: commitmentTerms.count,
        exports: exportRows.count,
        emailLogs: emailLogs.count,
        reminderSchedules: reminderSchedules.count,
        scopeAnalyses: scopeAnalyses.count,
        scopeAlerts: scopeAlerts.count,
        inboundEmails: inboundEmails.count,
      };
    });

    return NextResponse.json({ requestId, reset: true, counts });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    if (message === "UNAUTHORIZED") {
      return NextResponse.json(
        { requestId, error: "Unauthorized" },
        { status: 401 },
      );
    }
    if (message === "FORBIDDEN") {
      return NextResponse.json(
        { requestId, error: "Org admin access required" },
        { status: 403 },
      );
    }
    if (message === "NOT_FOUND") {
      return NextResponse.json(
        { requestId, error: "Not found" },
        { status: 404 },
      );
    }
    console.error(
      structuredError({
        requestId,
        route: "/api/programs/[programId]/reset",
        error: e,
      }),
    );
    return NextResponse.json(
      { requestId, error: "Internal server error" },
      { status: 500 },
    );
  }
}
