import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/server/auth";
import { OrgRole } from "@/generated/prisma/client";
import {
  getExpectedTables,
  getModelTableMappings,
  generateRequestId,
  structuredError,
} from "@/lib/config";

export async function GET() {
  const requestId = generateRequestId();
  try {
    const auth = await requireAuth();
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

    const expectedTables = getExpectedTables();
    const modelMappings = getModelTableMappings();

    // Query actual tables in public schema
    const rows = await prisma.$queryRawUnsafe<{ tablename: string }[]>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
    );
    const existingTables = rows.map((r) => r.tablename);
    const existingSet = new Set(existingTables);

    const missing = expectedTables.filter((t) => !existingSet.has(t));
    const extra = existingTables.filter(
      (t) => !expectedTables.includes(t) && t !== "_prisma_migrations"
    );

    // Check _prisma_migrations table for migration history
    let migrations: { id: string; migration_name: string; finished_at: string | null }[] = [];
    const hasMigrationsTable = existingTables.includes("_prisma_migrations");
    if (hasMigrationsTable) {
      try {
        migrations = await prisma.$queryRawUnsafe<
          { id: string; migration_name: string; finished_at: string | null }[]
        >(
          `SELECT id, migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 20`
        );
      } catch {
        // Table might exist but be empty or have different columns
      }
    }

    return NextResponse.json({
      requestId,
      ok: missing.length === 0,
      expected: modelMappings.map((m) => ({
        model: m.modelName,
        table: m.tableName,
        exists: existingSet.has(m.tableName),
      })),
      missing,
      extra,
      migrations_table_exists: hasMigrationsTable,
      recent_migrations: migrations,
      fix: missing.length > 0
        ? "Run: npx prisma migrate deploy (requires DIRECT_URL pointing to port 5432)"
        : null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED")
      return NextResponse.json({ requestId, error: "Unauthorized" }, { status: 401 });
    console.error(
      structuredError({ requestId, route: "/api/admin/db-check", error: e })
    );
    return NextResponse.json(
      { requestId, error: "Internal server error" },
      { status: 500 }
    );
  }
}
