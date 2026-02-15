import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/admin/migrate-baseline
 *
 * One-shot endpoint: creates the _prisma_migrations table and records both
 * migrations as "already applied" so `prisma migrate deploy` stays in sync.
 *
 * All 15 tables already exist from `prisma db push` — this only adds the
 * migration bookkeeping that `prisma migrate resolve --applied` would create.
 *
 * Safe to call multiple times (idempotent).
 * DELETE THIS ROUTE after the first successful run.
 */
export async function POST() {
  try {
    // 1. Create _prisma_migrations if it doesn't exist
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
        "id"                    VARCHAR(36)  NOT NULL PRIMARY KEY,
        "checksum"              VARCHAR(64)  NOT NULL,
        "finished_at"           TIMESTAMPTZ,
        "migration_name"        VARCHAR(255) NOT NULL,
        "logs"                  TEXT,
        "rolled_back_at"        TIMESTAMPTZ,
        "started_at"            TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "applied_steps_count"   INTEGER      NOT NULL DEFAULT 0
      );
    `);

    // 2. Record baseline migration (idempotent — skip if already recorded)
    await prisma.$executeRawUnsafe(`
      INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, applied_steps_count)
      SELECT
        gen_random_uuid()::varchar,
        'baseline-resolve',
        now(),
        '20260214_baseline_from_prod',
        1
      WHERE NOT EXISTS (
        SELECT 1 FROM "_prisma_migrations"
        WHERE migration_name = '20260214_baseline_from_prod'
      );
    `);

    // 3. Record additive migration (idempotent — skip if already recorded)
    await prisma.$executeRawUnsafe(`
      INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, applied_steps_count)
      SELECT
        gen_random_uuid()::varchar,
        'additive-resolve',
        now(),
        '20260214_add_missing',
        1
      WHERE NOT EXISTS (
        SELECT 1 FROM "_prisma_migrations"
        WHERE migration_name = '20260214_add_missing'
      );
    `);

    // 4. Verify
    const rows = await prisma.$queryRawUnsafe<
      { migration_name: string; finished_at: string }[]
    >(`SELECT migration_name, finished_at FROM "_prisma_migrations" ORDER BY started_at`);

    return NextResponse.json({
      status: "ok",
      message: "_prisma_migrations table created and both migrations recorded.",
      migrations: rows,
      next_step: "DELETE this route (/api/admin/migrate-baseline) now that it has run.",
    });
  } catch (e) {
    console.error("migrate-baseline error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}
