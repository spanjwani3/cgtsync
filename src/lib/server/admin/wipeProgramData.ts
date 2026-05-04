/**
 * Wipe all data for a program while preserving the program shell.
 * Shared between the admin UI button (POST /api/admin/programs/[id]/wipe-data)
 * and the ops CLI script (scripts/wipe-program-data.ts).
 *
 * "Program shell" preserved: Program row, Organization, OrgMembers, branding,
 * IngestAddress(es), EventLogs (DB-enforced append-only audit trail). Wipes
 * everything else child-of-program.
 */

import { prisma } from "@/lib/prisma";

export interface WipeCounts {
  baselines: number;
  baselineClauses: number;
  changes: number;
  invoices: number;
  invoiceLineItems: number;
  evidences: number;
  exports: number;
  extractionJobs: number;
  commitmentTerms: number;
  emailLogs: number;
  magicLinksFromEmailLogs: number;
  reminderSchedules: number;
  programContacts: number;
  scopeAnalyses: number;
  scopeAlerts: number;
  inboundEmails: number;
  eventLogs: number;
  ingestAddresses: number;
}

export async function countProgramData(programId: string): Promise<WipeCounts> {
  const [
    baselines,
    baselineClauses,
    changes,
    invoices,
    invoiceLineItems,
    evidences,
    exports_,
    extractionJobs,
    commitmentTerms,
    emailLogs,
    magicLinksFromEmailLogs,
    reminderSchedules,
    programContacts,
    scopeAnalyses,
    scopeAlerts,
    inboundEmails,
    eventLogs,
    ingestAddresses,
  ] = await Promise.all([
    prisma.baseline.count({ where: { programId } }),
    prisma.baselineClause.count({ where: { baseline: { programId } } }),
    prisma.change.count({ where: { programId } }),
    prisma.invoice.count({ where: { programId } }),
    prisma.invoiceLineItem.count({ where: { invoice: { programId } } }),
    prisma.evidence.count({ where: { programId } }),
    prisma.export.count({ where: { programId } }),
    prisma.extractionJob.count({ where: { programId } }),
    prisma.commitmentTerm.count({ where: { programId } }),
    prisma.emailLog.count({ where: { programId } }),
    prisma.magicLink.count({ where: { emailLog: { programId } } }),
    prisma.reminderSchedule.count({ where: { programId } }),
    prisma.programContact.count({ where: { programId } }),
    prisma.scopeAnalysis.count({ where: { programId } }),
    prisma.scopeAlert.count({ where: { programId } }),
    prisma.inboundEmail.count({ where: { programId } }),
    prisma.eventLog.count({ where: { programId } }),
    prisma.ingestAddress.count({ where: { programId } }),
  ]);

  return {
    baselines,
    baselineClauses,
    changes,
    invoices,
    invoiceLineItems,
    evidences,
    exports: exports_,
    extractionJobs,
    commitmentTerms,
    emailLogs,
    magicLinksFromEmailLogs,
    reminderSchedules,
    programContacts,
    scopeAnalyses,
    scopeAlerts,
    inboundEmails,
    eventLogs,
    ingestAddresses,
  };
}

/**
 * Delete every program-scoped row except the program itself, its members,
 * org, branding, and ingest addresses. Order matters because of cross-table
 * FKs that aren't fully cascaded. Runs in a single transaction so a
 * mid-flight failure rolls back.
 */
export async function wipeProgramData(programId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // Defense in depth: same bypass used by tenant deletion
    // (src/app/api/admin/tenants/route.ts). The append-only trigger on
    // event_logs raises on any UPDATE/DELETE; this SET LOCAL allows the
    // bypass-aware trigger function to skip enforcement for the current
    // transaction. We don't intentionally touch event_logs here, but any
    // future cascade (e.g. a new FK from event_logs) won't break the wipe.
    await tx.$executeRawUnsafe(`SET LOCAL app.bypass_event_log_lock = 'on'`);

    // 1. MagicLinks reference EmailLogs (nullable FK, no cascade).
    await tx.magicLink.deleteMany({ where: { emailLog: { programId } } });

    // 2. InboundEmails reference IngestAddress + Evidence; we keep ingest
    //    addresses, so wipe the inbound emails before evidence.
    await tx.inboundEmail.deleteMany({ where: { programId } });

    // 3. ExtractionJobs reference Evidence; wipe before evidence.
    await tx.extractionJob.deleteMany({ where: { programId } });

    // 4. ScopeAlerts reference baseline clauses + changes (nullable).
    await tx.scopeAlert.deleteMany({ where: { programId } });

    // 5. ScopeAnalyses reference baseline + evidence.
    await tx.scopeAnalysis.deleteMany({ where: { programId } });

    // 6. CommitmentTerms reference baseline + evidence.
    await tx.commitmentTerm.deleteMany({ where: { programId } });

    // 7. ReminderSchedules.
    await tx.reminderSchedule.deleteMany({ where: { programId } });

    // 8. EmailLogs (now safe — magic links gone).
    await tx.emailLog.deleteMany({ where: { programId } });

    // 9. Exports.
    await tx.export.deleteMany({ where: { programId } });

    // 10. InvoiceLineItems reference clauses + changes.
    await tx.invoiceLineItem.deleteMany({
      where: { invoice: { programId } },
    });

    // 11. Invoices reference evidence (nullable).
    await tx.invoice.deleteMany({ where: { programId } });

    // 12. Changes reference baselines + evidence (nullable).
    await tx.change.deleteMany({ where: { programId } });

    // 13. BaselineClauses (now safe — line items + scope alerts gone).
    await tx.baselineClause.deleteMany({ where: { baseline: { programId } } });

    // 14. Baselines reference evidence (nullable).
    await tx.baseline.deleteMany({ where: { programId } });

    // 15. Evidences (no remaining references at this point).
    await tx.evidence.deleteMany({ where: { programId } });

    // 16. ProgramContacts.
    await tx.programContact.deleteMany({ where: { programId } });

    // EventLogs are intentionally NOT deleted: the DB enforces an append-only
    // trigger on event_logs (any DELETE/UPDATE raises and rolls back the tx).
    // The audit trail is immutable by design.
  });
}
