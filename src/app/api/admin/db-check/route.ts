import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/server/auth";
import { OrgRole } from "@/generated/prisma/client";
import {
  EXPECTED_TABLES,
  MODEL_TABLE_MAPPINGS,
  generateRequestId,
  structuredError,
} from "@/lib/config";

export async function GET() {
  const requestId = generateRequestId();
  let userId: string | undefined;
  try {
    const auth = await requireAuth();
    userId = auth.userId;
    const membership = await prisma.orgMember.findFirst({
      where: { userId: auth.userId },
      select: { role: true },
    });
    if (!membership || membership.role !== OrgRole.ADMIN) {
      return NextResponse.json(
        { requestId, error: "Admin access required" },
        { status: 403 }
      );
    }

    // Query actual tables in public schema
    const rows = await prisma.$queryRawUnsafe<{ tablename: string }[]>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
    );
    const existingTables = rows.map((r) => r.tablename);
    const existingSet = new Set(existingTables);

    const missing = EXPECTED_TABLES.filter((t) => !existingSet.has(t));
    const expectedSet = new Set<string>(EXPECTED_TABLES);
    const extra = existingTables.filter(
      (t) => !expectedSet.has(t) && t !== "_prisma_migrations"
    );

    // Check _prisma_migrations table for migration history
    interface MigrationRow {
      id: string;
      migration_name: string;
      started_at: string | null;
      finished_at: string | null;
    }
    let migrations: MigrationRow[] = [];
    const hasMigrationsTable = existingTables.includes("_prisma_migrations");
    let failedMigrations = 0;

    if (hasMigrationsTable) {
      try {
        migrations = await prisma.$queryRawUnsafe<MigrationRow[]>(
          `SELECT id, migration_name, started_at, finished_at FROM _prisma_migrations ORDER BY started_at DESC LIMIT 20`
        );
        failedMigrations = migrations.filter((m) => m.finished_at === null).length;
      } catch {
        // Table might exist but have unexpected schema
      }
    }

    // Build latest_migration convenience field
    const latestApplied = migrations.find((m) => m.finished_at !== null) ?? null;

    return NextResponse.json({
      requestId,
      ok: missing.length === 0,
      expected: MODEL_TABLE_MAPPINGS.map((m) => ({
        model: m.modelName,
        table: m.tableName,
        exists: existingSet.has(m.tableName),
      })),
      missing,
      extra,
      migrations_table_exists: hasMigrationsTable,
      recent_migrations: migrations,
      failed_migrations: failedMigrations,
      latest_migration: latestApplied
        ? { name: latestApplied.migration_name, finished_at: latestApplied.finished_at }
        : null,
      fix: missing.length > 0
        ? "Run: npx prisma migrate deploy (requires DIRECT_URL pointing to port 5432)"
        : null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED")
      return NextResponse.json({ requestId, error: "Unauthorized" }, { status: 401 });
    console.error(
      structuredError({ requestId, route: "/api/admin/db-check", error: e, userId })
    );
    return NextResponse.json(
      { requestId, error: "Internal server error" },
      { status: 500 }
    );
  }
}
