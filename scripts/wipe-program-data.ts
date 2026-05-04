/**
 * Wipe all data for a program while preserving the program shell.
 *
 * "Program shell" means: the Program row itself, its Organization, OrgMembers,
 * branding, and the IngestAddress(es) attached to the program — same baseline
 * an onboarded program would have right after `onboardTenant` finishes.
 *
 * Wiped (everything else): baselines, baseline clauses, changes, invoices,
 * line items, evidences, exports, extraction jobs, commitment terms,
 * email logs, magic links tied to those email logs, reminder schedules,
 * scope analyses, scope alerts, inbound emails, program contacts, and event
 * logs scoped to this program.
 *
 * Usage:
 *   # Dry-run (default): prints counts of what would be deleted, no changes.
 *   npx tsx scripts/wipe-program-data.ts \
 *     --slug cellipont \
 *     --program "ERNA-101 - EDP Production of Gene-Edited iPS Cells"
 *
 *   # Apply the wipe (destructive):
 *   npx tsx scripts/wipe-program-data.ts \
 *     --slug cellipont \
 *     --program "ERNA-101 - EDP Production of Gene-Edited iPS Cells" \
 *     --apply
 *
 *   # By program id (alternative):
 *   npx tsx scripts/wipe-program-data.ts --program-id <uuid> [--apply]
 *
 * Requires DATABASE_URL pointing at the target environment.
 */

import "dotenv/config";
import { prisma } from "../src/lib/prisma";

interface Args {
  programId?: string;
  slug?: string;
  programName?: string;
  apply: boolean;
  keepEventLogs: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = { apply: false, keepEventLogs: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") {
      out.apply = true;
      continue;
    }
    if (a === "--keep-event-logs") {
      out.keepEventLogs = true;
      continue;
    }
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) continue;
    if (key === "program-id") out.programId = next;
    else if (key === "slug") out.slug = next;
    else if (key === "program") out.programName = next;
    i++;
  }
  return {
    programId: out.programId,
    slug: out.slug,
    programName: out.programName,
    apply: out.apply ?? false,
    keepEventLogs: out.keepEventLogs ?? false,
  };
}

async function resolveProgram(args: Args) {
  if (args.programId) {
    const p = await prisma.program.findUnique({
      where: { id: args.programId },
      include: { org: { select: { slug: true, name: true } } },
    });
    if (!p) throw new Error(`Program not found: id=${args.programId}`);
    return p;
  }
  if (!args.slug || !args.programName) {
    throw new Error("Pass either --program-id, or --slug + --program");
  }
  const org = await prisma.organization.findUnique({
    where: { slug: args.slug },
    select: { id: true, name: true, slug: true },
  });
  if (!org) throw new Error(`Org not found: slug=${args.slug}`);
  const p = await prisma.program.findFirst({
    where: { orgId: org.id, name: args.programName },
    include: { org: { select: { slug: true, name: true } } },
  });
  if (!p) {
    throw new Error(
      `Program not found in org "${args.slug}" with name "${args.programName}"`,
    );
  }
  return p;
}

async function countAll(programId: string) {
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
    prisma.baselineClause.count({
      where: { baseline: { programId } },
    }),
    prisma.change.count({ where: { programId } }),
    prisma.invoice.count({ where: { programId } }),
    prisma.invoiceLineItem.count({
      where: { invoice: { programId } },
    }),
    prisma.evidence.count({ where: { programId } }),
    prisma.export.count({ where: { programId } }),
    prisma.extractionJob.count({ where: { programId } }),
    prisma.commitmentTerm.count({ where: { programId } }),
    prisma.emailLog.count({ where: { programId } }),
    prisma.magicLink.count({
      where: { emailLog: { programId } },
    }),
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

async function applyWipe(programId: string, keepEventLogs: boolean) {
  // One transaction so a mid-flight failure doesn't leave the program in
  // a half-wiped state. Order matters because of cross-table FKs that
  // aren't fully cascaded.
  await prisma.$transaction(async (tx) => {
    // 1. MagicLinks reference EmailLogs (nullable FK, no cascade defined).
    //    Delete first so EmailLog deletes don't fail.
    await tx.magicLink.deleteMany({ where: { emailLog: { programId } } });

    // 2. InboundEmails reference IngestAddress + Evidence; we keep ingest
    //    addresses, so wipe the inbound emails before evidence.
    await tx.inboundEmail.deleteMany({ where: { programId } });

    // 3. ExtractionJobs reference Evidence; wipe before evidence.
    await tx.extractionJob.deleteMany({ where: { programId } });

    // 4. ScopeAlerts (cascade from analyses, but also direct FK to program).
    //    Reference baseline clauses + changes (nullable). Delete first.
    await tx.scopeAlert.deleteMany({ where: { programId } });

    // 5. ScopeAnalyses reference baseline + evidence.
    await tx.scopeAnalysis.deleteMany({ where: { programId } });

    // 6. CommitmentTerms reference baseline + evidence.
    await tx.commitmentTerm.deleteMany({ where: { programId } });

    // 7. ReminderSchedules reference invoices (also program FK).
    await tx.reminderSchedule.deleteMany({ where: { programId } });

    // 8. EmailLogs.
    await tx.emailLog.deleteMany({ where: { programId } });

    // 9. Exports.
    await tx.export.deleteMany({ where: { programId } });

    // 10. InvoiceLineItems cascade with invoices but reference clauses + changes.
    //     Explicit delete keeps order obvious.
    await tx.invoiceLineItem.deleteMany({
      where: { invoice: { programId } },
    });

    // 11. Invoices reference evidence (nullable).
    await tx.invoice.deleteMany({ where: { programId } });

    // 12. Changes reference baselines + evidence (nullable).
    await tx.change.deleteMany({ where: { programId } });

    // 13. BaselineClauses cascade with baselines but referenced by line items
    //     and scope alerts (already deleted). Explicit delete for clarity.
    await tx.baselineClause.deleteMany({
      where: { baseline: { programId } },
    });

    // 14. Baselines reference evidence (nullable).
    await tx.baseline.deleteMany({ where: { programId } });

    // 15. Evidences (no remaining references at this point).
    await tx.evidence.deleteMany({ where: { programId } });

    // 16. ProgramContacts.
    await tx.programContact.deleteMany({ where: { programId } });

    // 17. EventLogs (programId is nullable, no cascade — must be explicit).
    if (!keepEventLogs) {
      await tx.eventLog.deleteMany({ where: { programId } });
    }
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const program = await resolveProgram(args);

  const before = await countAll(program.id);
  const total =
    before.baselines +
    before.baselineClauses +
    before.changes +
    before.invoices +
    before.invoiceLineItems +
    before.evidences +
    before.exports +
    before.extractionJobs +
    before.commitmentTerms +
    before.emailLogs +
    before.magicLinksFromEmailLogs +
    before.reminderSchedules +
    before.programContacts +
    before.scopeAnalyses +
    before.scopeAlerts +
    before.inboundEmails +
    (args.keepEventLogs ? 0 : before.eventLogs);

  console.log("");
  console.log(`Program: ${program.name}`);
  console.log(`  id    : ${program.id}`);
  console.log(`  org   : ${program.org.name} (${program.org.slug})`);
  console.log("");
  console.log("Will DELETE:");
  console.log(`  baselines              : ${before.baselines}`);
  console.log(`  baseline clauses       : ${before.baselineClauses}`);
  console.log(`  changes                : ${before.changes}`);
  console.log(`  invoices               : ${before.invoices}`);
  console.log(`  invoice line items     : ${before.invoiceLineItems}`);
  console.log(`  evidences              : ${before.evidences}`);
  console.log(`  exports                : ${before.exports}`);
  console.log(`  extraction jobs        : ${before.extractionJobs}`);
  console.log(`  commitment terms       : ${before.commitmentTerms}`);
  console.log(`  email logs             : ${before.emailLogs}`);
  console.log(`  magic links            : ${before.magicLinksFromEmailLogs}`);
  console.log(`  reminder schedules     : ${before.reminderSchedules}`);
  console.log(`  program contacts       : ${before.programContacts}`);
  console.log(`  scope analyses         : ${before.scopeAnalyses}`);
  console.log(`  scope alerts           : ${before.scopeAlerts}`);
  console.log(`  inbound emails         : ${before.inboundEmails}`);
  console.log(
    `  event logs             : ${args.keepEventLogs ? "(kept) " : ""}${before.eventLogs}`,
  );
  console.log(`  ── total rows          : ${total}`);
  console.log("");
  console.log("Will PRESERVE:");
  console.log(`  program row            : 1`);
  console.log(`  ingest addresses       : ${before.ingestAddresses}`);
  console.log(`  organization, members, branding`);
  console.log("");

  if (!args.apply) {
    console.log("DRY RUN — no changes made. Re-run with --apply to execute.");
    return;
  }

  console.log("APPLYING wipe…");
  await applyWipe(program.id, args.keepEventLogs);

  const after = await countAll(program.id);
  console.log("");
  console.log("After wipe (should all be 0 except ingest addresses):");
  console.log(`  baselines              : ${after.baselines}`);
  console.log(`  changes                : ${after.changes}`);
  console.log(`  invoices               : ${after.invoices}`);
  console.log(`  evidences              : ${after.evidences}`);
  console.log(`  scope alerts           : ${after.scopeAlerts}`);
  console.log(`  email logs             : ${after.emailLogs}`);
  console.log(`  inbound emails         : ${after.inboundEmails}`);
  console.log(`  event logs             : ${after.eventLogs}`);
  console.log(`  ingest addresses (kept): ${after.ingestAddresses}`);
  console.log("");
  console.log("Done.");
}

main()
  .catch((e) => {
    console.error("Wipe failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
