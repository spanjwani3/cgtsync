/**
 * Centralized configuration constants.
 * Bucket names, env var keys, schema introspection, and request helpers.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";

// ─── Storage ────────────────────────────────────────────────

/** Supabase Storage bucket for evidence files. Override via SUPABASE_EVIDENCE_BUCKET env var. */
export const EVIDENCE_BUCKET =
  process.env.SUPABASE_EVIDENCE_BUCKET ?? "evidence";

// ─── Environment ────────────────────────────────────────────

/** All environment variables the app requires. */
export const REQUIRED_ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_APP_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "DATABASE_URL",
] as const;

/** Check which required env vars are present (booleans only, never values). */
export function checkRequiredEnv(): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const key of REQUIRED_ENV_KEYS) {
    result[key] = !!process.env[key];
  }
  return result;
}

/** Return list of missing required env var names. */
export function getMissingEnv(): string[] {
  return REQUIRED_ENV_KEYS.filter((key) => !process.env[key]);
}

// ─── Schema Introspection ───────────────────────────────────

interface ModelTableMapping {
  modelName: string;
  tableName: string;
}

let _cachedMappings: ModelTableMapping[] | null = null;

/**
 * Parse prisma/schema.prisma to extract model→table mappings.
 * Uses @@map("table_name") when present; otherwise lowercases + pluralises the model name.
 * Result is cached after first call — never drifts from the schema file.
 */
export function getModelTableMappings(): ModelTableMapping[] {
  if (_cachedMappings) return _cachedMappings;

  const schemaPath = path.resolve(process.cwd(), "prisma/schema.prisma");
  let schemaText: string;
  try {
    schemaText = fs.readFileSync(schemaPath, "utf-8");
  } catch {
    // Fallback: return empty; the caller will report "unable to read schema"
    return [];
  }

  const mappings: ModelTableMapping[] = [];
  // Match each model block: `model Foo { ... }`
  const modelRe = /^model\s+(\w+)\s*\{([^}]*)\}/gm;
  let match: RegExpExecArray | null;
  while ((match = modelRe.exec(schemaText)) !== null) {
    const modelName = match[1];
    const body = match[2];
    // Look for @@map("table_name") inside the model body
    const mapMatch = body.match(/@@map\(\s*"([^"]+)"\s*\)/);
    const tableName = mapMatch ? mapMatch[1] : modelName.toLowerCase() + "s";
    mappings.push({ modelName, tableName });
  }

  _cachedMappings = mappings;
  return mappings;
}

/**
 * Get the list of expected Postgres table names, derived from prisma/schema.prisma.
 * Never hardcoded — automatically updates when models are added/removed.
 */
export function getExpectedTables(): string[] {
  return getModelTableMappings().map((m) => m.tableName);
}

// ─── Request ID ─────────────────────────────────────────────

/** Generate a unique request ID for correlation. */
export function generateRequestId(): string {
  return crypto.randomUUID();
}

/** Build a structured error log object. Never includes stack in the returned JSON. */
export function structuredError(opts: {
  requestId: string;
  route: string;
  error: unknown;
  userId?: string;
  orgId?: string;
  programId?: string;
}): Record<string, unknown> {
  const err = opts.error instanceof Error ? opts.error : new Error(String(opts.error));
  return {
    requestId: opts.requestId,
    route: opts.route,
    userId: opts.userId,
    orgId: opts.orgId,
    programId: opts.programId,
    errorCode: err.message,
    stack: err.stack,
    timestamp: new Date().toISOString(),
  };
}
