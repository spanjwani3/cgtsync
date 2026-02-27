/**
 * CGT-Sync Seed Script
 *
 * Creates a demo organization, user, program, baseline with clauses,
 * changes, an invoice with line items, and evidence records.
 *
 * Run: npx tsx prisma/seed.ts
 *
 * NOTE: You must have a Supabase user created first (via signup).
 * Set SEED_USER_ID and SEED_USER_EMAIL environment variables,
 * or this will create placeholder records.
 */

import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient();

async function main() {
  const userEmail = process.env.SEED_USER_EMAIL ?? "spanjwani3@gmail.com";

  // Resolve user ID: env var > existing DB user > real Supabase UID
  let userId = process.env.SEED_USER_ID;
  if (!userId) {
    const existing = await prisma.user.findUnique({ where: { email: userEmail } });
    userId = existing?.id ?? "bad8c2dd-3ca2-43e9-871d-1ea363574306";
  }

  // Idempotency guard: skip if demo data already exists
  const existingOrg = await prisma.organization.findUnique({ where: { slug: "acme-bio" } });
  if (existingOrg) {
    const existingProgram = await prisma.program.findFirst({
      where: { orgId: existingOrg.id, name: "CAR-T Manufacturing — Phase II" },
    });
    if (existingProgram) {
      console.log("Demo data already seeded, skipping.");
      return;
    }
  }

  console.log("Seeding CGT-Sync demo data...\n");

  // 1. User
  const user = await prisma.user.upsert({
    where: { id: userId },
    update: {},
    create: { id: userId, email: userEmail, fullName: "Samir Panjwani" },
  });
  console.log(`  User: ${user.email} (${user.id})`);

  // 2. Organization
  const org = await prisma.organization.upsert({
    where: { slug: "acme-bio" },
    update: {},
    create: { name: "Acme Biologics", slug: "acme-bio" },
  });
  console.log(`  Org: ${org.name} (${org.id})`);

  // 3. Membership
  await prisma.orgMember.upsert({
    where: { orgId_userId: { orgId: org.id, userId: user.id } },
    update: {},
    create: { orgId: org.id, userId: user.id, role: "ADMIN" },
  });
  console.log(`  Membership: ADMIN`);

  // 4. Program
  const program = await prisma.program.create({
    data: {
      orgId: org.id,
      name: "CAR-T Manufacturing — Phase II",
      cdmoName: "CellGenix GmbH",
      molecule: "CTX-401",
      modality: "CAR-T Cell Therapy",
      status: "ACTIVE",
      currency: "USD",
      changeThreshold: 50000,
      activatedAt: new Date(),
    },
  });
  console.log(`  Program: ${program.name} (${program.id})`);

  // 5. Baseline with clauses
  const baseline = await prisma.baseline.create({
    data: {
      programId: program.id,
      version: 1,
      title: "MSA v1.0 — Manufacturing Services Agreement",
      status: "LOCKED",
      releasedAt: new Date(Date.now() - 7 * 86400000),
      confirmedAt: new Date(Date.now() - 5 * 86400000),
      lockedAt: new Date(Date.now() - 3 * 86400000),
    },
  });
  console.log(`  Baseline: ${baseline.title} [${baseline.status}]`);

  const clauses = await Promise.all([
    prisma.baselineClause.create({
      data: {
        baselineId: baseline.id,
        clauseRef: "3.1",
        type: "PRICING",
        title: "Manufacturing batch cost",
        description: "Per-batch fee for GMP manufacturing",
        value: 285000,
        unit: "USD/batch",
        sortOrder: 1,
      },
    }),
    prisma.baselineClause.create({
      data: {
        baselineId: baseline.id,
        clauseRef: "3.2",
        type: "PRICING",
        title: "Quality control testing",
        description: "Release testing per batch",
        value: 45000,
        unit: "USD/batch",
        sortOrder: 2,
      },
    }),
    prisma.baselineClause.create({
      data: {
        baselineId: baseline.id,
        clauseRef: "4.1",
        type: "TIMELINE",
        title: "Manufacturing lead time",
        description: "Weeks from material receipt to batch release",
        value: 12,
        unit: "weeks",
        sortOrder: 3,
      },
    }),
    prisma.baselineClause.create({
      data: {
        baselineId: baseline.id,
        clauseRef: "5.1",
        type: "SCOPE",
        title: "Annual batch commitment",
        description: "Minimum annual batches",
        value: 6,
        unit: "batches/year",
        sortOrder: 4,
      },
    }),
    prisma.baselineClause.create({
      data: {
        baselineId: baseline.id,
        clauseRef: "7.1",
        type: "PAYMENT_TERMS",
        title: "Payment terms",
        description: "Net days from invoice date",
        value: 45,
        unit: "days",
        sortOrder: 5,
      },
    }),
  ]);
  console.log(`  Clauses: ${clauses.length} created`);

  // 6. Changes
  const changes = await Promise.all([
    prisma.change.create({
      data: {
        programId: program.id,
        baselineId: baseline.id,
        sequenceNum: 1,
        title: "Add viral vector testing panel",
        description: "CDMO requested additional safety testing for replication-competent lentivirus",
        severity: "MEDIUM",
        status: "CONFIRMED",
        estimatedImpact: 18000,
        releasedAt: new Date(Date.now() - 2 * 86400000),
        confirmedAt: new Date(Date.now() - 1 * 86400000),
      },
    }),
    prisma.change.create({
      data: {
        programId: program.id,
        baselineId: baseline.id,
        sequenceNum: 2,
        title: "Expedited batch processing surcharge",
        description: "Rush fee for accelerated timeline on batch 4",
        severity: "HIGH",
        status: "RELEASED",
        estimatedImpact: 75000,
        releasedAt: new Date(),
      },
    }),
    prisma.change.create({
      data: {
        programId: program.id,
        sequenceNum: 3,
        title: "Raw material cost adjustment (CPI)",
        description: "Annual CPI-linked adjustment per MSA clause 6.2",
        severity: "LOW",
        status: "LOGGED",
        estimatedImpact: 8500,
        releasedAt: new Date(Date.now() - 86400000),
        confirmedAt: new Date(Date.now() - 86400000),
      },
    }),
  ]);
  console.log(`  Changes: ${changes.length} created`);

  // 7. Invoice with line items
  const invoice = await prisma.invoice.create({
    data: {
      programId: program.id,
      invoiceNumber: "INV-2026-0042",
      vendorName: "CellGenix GmbH",
      invoiceDate: new Date(Date.now() - 14 * 86400000),
      totalAmount: 373500,
      currency: "USD",
      status: "FLAGGED",
    },
  });
  console.log(`  Invoice: ${invoice.invoiceNumber} (${invoice.status})`);

  await Promise.all([
    prisma.invoiceLineItem.create({
      data: {
        invoiceId: invoice.id,
        description: "Manufacturing batch cost — Batch 3",
        quantity: 1,
        unitPrice: 285000,
        amount: 285000,
        clauseId: clauses[0].id,
        flag: "NONE",
        sortOrder: 1,
      },
    }),
    prisma.invoiceLineItem.create({
      data: {
        invoiceId: invoice.id,
        description: "Quality control testing — Batch 3",
        quantity: 1,
        unitPrice: 52000,
        amount: 52000,
        clauseId: clauses[1].id,
        flag: "RATE_MISMATCH",
        flagNote: "Line amount 52000 differs from clause value 45000 by 15.6%",
        sortOrder: 2,
      },
    }),
    prisma.invoiceLineItem.create({
      data: {
        invoiceId: invoice.id,
        description: "Viral vector testing panel",
        quantity: 1,
        unitPrice: 18000,
        amount: 18000,
        changeId: changes[0].id,
        flag: "NONE",
        sortOrder: 3,
      },
    }),
    prisma.invoiceLineItem.create({
      data: {
        invoiceId: invoice.id,
        description: "Cold chain logistics supplement",
        quantity: 1,
        unitPrice: 18500,
        amount: 18500,
        flag: "MISSING_BASELINE",
        flagNote: "No baseline clause or change order mapped to this line item",
        sortOrder: 4,
      },
    }),
  ]);
  console.log(`  Line items: 4 created (2 flagged)`);

  // 8. Event log entries
  await Promise.all([
    prisma.eventLog.create({ data: { programId: program.id, userId: user.id, action: "PROGRAM_CREATED", entityType: "Program", entityId: program.id } }),
    prisma.eventLog.create({ data: { programId: program.id, userId: user.id, action: "BASELINE_CREATED", entityType: "Baseline", entityId: baseline.id } }),
    prisma.eventLog.create({ data: { programId: program.id, userId: user.id, action: "BASELINE_LOCKED", entityType: "Baseline", entityId: baseline.id } }),
    prisma.eventLog.create({ data: { programId: program.id, userId: user.id, action: "INVOICE_UPLOADED", entityType: "Invoice", entityId: invoice.id } }),
    prisma.eventLog.create({ data: { programId: program.id, userId: user.id, action: "LINE_ITEM_FLAGGED", entityType: "InvoiceLineItem", metadata: { flag: "RATE_MISMATCH" } } }),
  ]);
  console.log(`  Event log: 5 entries`);

  console.log("\nSeed complete!");
  console.log(`\nProgram ID: ${program.id}`);
  console.log(`View at: http://localhost:3000/programs/${program.id}/cockpit`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
