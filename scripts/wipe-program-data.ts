/**
 * Wipe all data for a program while preserving the program shell.
 *
 * Same logic as the admin UI button at /admin/tenants/[slug] →
 * "Reset data" on a program row. Use this CLI when you don't have a
 * browser or want to script the wipe.
 *
 * "Program shell" preserved: Program row, Organization, OrgMembers,
 * branding, IngestAddress(es). Wipes everything else.
 *
 * Usage:
 *   # Dry-run (default): prints counts, makes no changes.
 *   npx tsx scripts/wipe-program-data.ts \
 *     --slug cellipont \
 *     --program "ERNA-101 - EDP Production of Gene-Edited iPS Cells"
 *
 *   # Apply (destructive, single transaction):
 *   npx tsx scripts/wipe-program-data.ts \
 *     --slug cellipont \
 *     --program "ERNA-101 - EDP Production of Gene-Edited iPS Cells" \
 *     --apply
 *
 *   # By program id:
 *   npx tsx scripts/wipe-program-data.ts --program-id <uuid> [--apply]
 *
 * Requires DATABASE_URL pointing at the target environment.
 */

import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import {
  countProgramData,
  wipeProgramData,
} from "../src/lib/server/admin/wipeProgramData";

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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const program = await resolveProgram(args);

  const before = await countProgramData(program.id);
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
  await wipeProgramData(program.id, { keepEventLogs: args.keepEventLogs });

  const after = await countProgramData(program.id);
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
