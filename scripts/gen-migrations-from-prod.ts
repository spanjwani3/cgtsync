#!/usr/bin/env npx tsx
/**
 * Generate Prisma migration SQL by diffing against a live database.
 *
 * Usage:
 *   DIRECT_URL="postgresql://..." npx tsx scripts/gen-migrations-from-prod.ts
 *
 * What it does:
 *   1. baseline — `prisma migrate diff --from-empty --to-url $DIRECT_URL`
 *      → prisma/migrations/20260214_baseline_from_prod/migration.sql
 *
 *   2. additive — `prisma migrate diff --from-url $DIRECT_URL --to-schema-datamodel prisma/schema.prisma`
 *      → prisma/migrations/20260214_add_missing/migration.sql
 *
 *   3. Safety check — fails if the additive SQL contains DROP TABLE or DROP TYPE.
 *
 * Pre-requisites:
 *   - DIRECT_URL env var pointing to the direct Postgres connection (port 5432).
 *   - prisma CLI available (npx prisma).
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const migrationsDir = path.join(root, "prisma", "migrations");

const DIRECT_URL = process.env.DIRECT_URL;
if (!DIRECT_URL) {
  console.error("ERROR: DIRECT_URL env var is required (direct Postgres connection, port 5432).");
  console.error("  export DIRECT_URL=\"postgresql://postgres.<ref>:<pw>@db.<ref>.supabase.co:5432/postgres\"");
  process.exit(1);
}

function run(cmd: string): string {
  console.log(`\n$ ${cmd}\n`);
  return execSync(cmd, { encoding: "utf-8", cwd: root });
}

// ---------------------------------------------------------------------------
// Step 1: Baseline — snapshot of current prod schema
// ---------------------------------------------------------------------------
const baselineDir = path.join(migrationsDir, "20260214_baseline_from_prod");
fs.mkdirSync(baselineDir, { recursive: true });

const baselineSql = run(
  `npx prisma migrate diff --from-empty --to-url "${DIRECT_URL}" --script`
);
const baselinePath = path.join(baselineDir, "migration.sql");
fs.writeFileSync(baselinePath, baselineSql);
console.log(`Wrote baseline: ${path.relative(root, baselinePath)} (${baselineSql.length} bytes)`);

// ---------------------------------------------------------------------------
// Step 2: Additive — diff from prod → current schema.prisma
// ---------------------------------------------------------------------------
const additiveDir = path.join(migrationsDir, "20260214_add_missing");
fs.mkdirSync(additiveDir, { recursive: true });

const additiveSql = run(
  `npx prisma migrate diff --from-url "${DIRECT_URL}" --to-schema-datamodel prisma/schema.prisma --script`
);
const additivePath = path.join(additiveDir, "migration.sql");
fs.writeFileSync(additivePath, additiveSql);
console.log(`Wrote additive: ${path.relative(root, additivePath)} (${additiveSql.length} bytes)`);

// ---------------------------------------------------------------------------
// Step 3: Safety check — no destructive operations in the additive migration
// ---------------------------------------------------------------------------
const DANGEROUS = [/DROP\s+TABLE/i, /DROP\s+TYPE/i];
const violations: string[] = [];

for (const pattern of DANGEROUS) {
  if (pattern.test(additiveSql)) {
    violations.push(pattern.source);
  }
}

if (violations.length > 0) {
  console.error("\nSAFETY CHECK FAILED — additive migration contains destructive operations:");
  for (const v of violations) {
    console.error(`  - matched: ${v}`);
  }
  console.error("\nReview the generated SQL and remove destructive statements before deploying.");
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Done
// ---------------------------------------------------------------------------
console.log("\nMigrations generated successfully.");
console.log("Next steps:");
console.log("  1. Review the generated SQL files");
console.log("  2. git add prisma/migrations && git commit");
console.log("  3. On prod: npx prisma migrate resolve --applied 20260214_baseline_from_prod");
console.log("  4. On prod: npx prisma migrate deploy");
