import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/server/auth";
import { OrgRole } from "@/generated/prisma/client";
import { checkBucketExists } from "@/lib/server/storage";
import {
  checkRequiredEnv,
  EVIDENCE_BUCKET,
  EXPECTED_TABLES,
  MODEL_TABLE_MAPPINGS,
  generateRequestId,
  structuredError,
} from "@/lib/config";

export async function GET() {
  const requestId = generateRequestId();
  let userId: string | undefined;
  try {
    // Require ADMIN role
    const auth = await requireAuth();
    userId = auth.userId;
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

    // 2. Check tables exist — derived from build-time generated table map
    let migrations_ok = false;
    const missing_tables: string[] = [];
    if (db_ok) {
      try {
        const rows = await prisma.$queryRawUnsafe<{ tablename: string }[]>(
          `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`
        );
        const existing = new Set(rows.map((r) => r.tablename));
        for (const t of EXPECTED_TABLES) {
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

    // 5. NEXT_PUBLIC_SITE_URL — must be set and not localhost in production
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";
    const isVercel = !!process.env.VERCEL;
    const site_url_present = !!siteUrl;
    const site_url_is_localhost = siteUrl.includes("localhost") || siteUrl.includes("127.0.0.1");
    const site_url_ok = site_url_present && !(isVercel && site_url_is_localhost);

    // 6. Anthropic API key (optional — extraction feature)
    const anthropic_api_key_present = !!process.env.ANTHROPIC_API_KEY;

    const all_ok =
      db_ok &&
      migrations_ok &&
      evidence_bucket_exists &&
      site_url_ok &&
      Object.values(required_env_present).every(Boolean);

    return NextResponse.json({
      requestId,
      status: all_ok ? "healthy" : "unhealthy",
      checks: {
        db_ok,
        db_error,
        migrations_ok,
        expected_tables: MODEL_TABLE_MAPPINGS.map((m) => ({
          model: m.modelName,
          table: m.tableName,
        })),
        missing_tables,
        required_env_present,
        evidence_bucket_exists,
        evidence_bucket_name: EVIDENCE_BUCKET,
        bucket_error,
        site_url_ok,
        site_url_value: siteUrl || null,
        site_url_is_localhost,
        is_vercel: isVercel,
        anthropic_api_key_present,
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
      structuredError({ requestId, route: "/api/admin/health", error: e, userId })
    );
    return NextResponse.json(
      { requestId, error: "Internal server error" },
      { status: 500 }
    );
  }
}
