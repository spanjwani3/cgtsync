import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/server/auth";
import { OrgRole } from "@/generated/prisma/client";
import { checkBucketExists } from "@/lib/server/storage";
import {
  checkRequiredEnv,
  EVIDENCE_BUCKET,
  getExpectedTables,
  getModelTableMappings,
  generateRequestId,
  structuredError,
} from "@/lib/config";

export async function GET() {
  const requestId = generateRequestId();
  try {
    // Require ADMIN role
    const auth = await requireAuth();
    const membership = await prisma.orgMember.findFirst({
      where: { userId: auth.userId },
      select: { role: true, orgId: true },
    });
    if (!membership || membership.role !== OrgRole.ADMIN) {
      return NextResponse.json(
        { requestId, error: "Admin access required" },
        { status: 403 }
      );
    }

    // 1. Database connectivity
    let db_ok = false;
    let db_error: string | null = null;
    try {
      await prisma.$queryRawUnsafe("SELECT 1");
      db_ok = true;
    } catch (e) {
      db_error = e instanceof Error ? e.message : "Unknown DB error";
    }

    // 2. Check tables exist — derived from prisma/schema.prisma, never hardcoded
    const expectedTables = getExpectedTables();
    const modelMappings = getModelTableMappings();
    let migrations_ok = false;
    const missing_tables: string[] = [];
    if (db_ok) {
      try {
        const rows = await prisma.$queryRawUnsafe<{ tablename: string }[]>(
          `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`
        );
        const existing = new Set(rows.map((r) => r.tablename));
        for (const t of expectedTables) {
          if (!existing.has(t)) missing_tables.push(t);
        }
        migrations_ok = missing_tables.length === 0;
      } catch (e) {
        db_error = e instanceof Error ? e.message : "Failed to query tables";
      }
    }

    // 3. Required env vars (booleans only)
    const required_env_present = checkRequiredEnv();

    // 4. Evidence bucket
    let evidence_bucket_exists = false;
    let bucket_error: string | null = null;
    try {
      const bucketCheck = await checkBucketExists();
      evidence_bucket_exists = bucketCheck.exists;
      bucket_error = bucketCheck.error ?? null;
    } catch (e) {
      bucket_error = e instanceof Error ? e.message : "Bucket check failed";
    }

    // 5. NEXT_PUBLIC_APP_URL
    const app_url_present = !!process.env.NEXT_PUBLIC_APP_URL;

    const all_ok =
      db_ok &&
      migrations_ok &&
      evidence_bucket_exists &&
      app_url_present &&
      Object.values(required_env_present).every(Boolean);

    return NextResponse.json({
      requestId,
      status: all_ok ? "healthy" : "unhealthy",
      checks: {
        db_ok,
        db_error,
        migrations_ok,
        expected_tables: modelMappings.map((m) => ({
          model: m.modelName,
          table: m.tableName,
        })),
        missing_tables,
        required_env_present,
        evidence_bucket_exists,
        evidence_bucket_name: EVIDENCE_BUCKET,
        bucket_error,
        app_url_present,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED")
      return NextResponse.json(
        { requestId, error: "Unauthorized" },
        { status: 401 }
      );
    console.error(
      "Health check error:",
      structuredError({ requestId, route: "/api/admin/health", error: e })
    );
    return NextResponse.json(
      { requestId, error: "Internal server error" },
      { status: 500 }
    );
  }
}
