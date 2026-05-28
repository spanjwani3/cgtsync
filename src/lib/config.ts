/**
 * Centralized configuration constants.
 * Bucket names, env var keys, table map re-exports, and request helpers.
 */

import crypto from "crypto";

// Re-export build-time generated table map (no runtime fs access needed)
export {
  MODEL_TABLE_MAPPINGS,
  EXPECTED_TABLES,
  type ModelTableMapping,
} from "@/generated/table-map";

// ─── Storage ────────────────────────────────────────────────

/** Supabase Storage bucket for evidence files. Override via SUPABASE_EVIDENCE_BUCKET env var. */
export const EVIDENCE_BUCKET =
  process.env.SUPABASE_EVIDENCE_BUCKET ?? "evidence";

/**
 * Private Supabase Storage bucket holding gated demo videos. Separate from the
 * evidence bucket so it can have a larger file-size limit. Override via
 * SUPABASE_DEMO_BUCKET env var.
 */
export const DEMO_BUCKET = process.env.SUPABASE_DEMO_BUCKET ?? "demo";

// ─── Environment ────────────────────────────────────────────

/** All environment variables the app requires. */
export const REQUIRED_ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SITE_URL",
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

// ─── Supabase Project Consistency ────────────────────────────

/**
 * Extract a Supabase project ref from a URL or connection string.
 * Handles:
 *  - https://<ref>.supabase.co
 *  - postgresql://postgres.<ref>:...@...pooler.supabase.com:...
 *  - https://<ref>.supabase.co (SUPABASE_URL)
 * Returns null if not parseable.
 */
function extractProjectRef(value: string): string | null {
  // URL form: https://<ref>.supabase.co
  const urlMatch = value.match(
    /https?:\/\/([a-z0-9]+)\.supabase\.co/i
  );
  if (urlMatch) return urlMatch[1].toLowerCase();

  // Pooler form: postgres.<ref>:<password>@...pooler.supabase.com
  const poolerMatch = value.match(
    /postgres\.([a-z0-9]+):/i
  );
  if (poolerMatch) return poolerMatch[1].toLowerCase();

  return null;
}

export interface SupabaseConsistencyResult {
  ok: boolean;
  refs: Record<string, string | null>;
  mismatch: string | null;
}

/**
 * Compare project refs extracted from Supabase-related env vars.
 * Returns ok=true if all present refs match, or only one is set.
 */
export function checkSupabaseProjectConsistency(): SupabaseConsistencyResult {
  const vars = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_URL",
    "DATABASE_URL",
  ] as const;

  const refs: Record<string, string | null> = {};
  for (const key of vars) {
    const val = process.env[key] ?? "";
    refs[key] = val ? extractProjectRef(val) : null;
  }

  const uniqueRefs = new Set(
    Object.values(refs).filter((r): r is string => r !== null)
  );

  if (uniqueRefs.size <= 1) {
    return { ok: true, refs, mismatch: null };
  }

  const details = Object.entries(refs)
    .filter(([, v]) => v !== null)
    .map(([k, v]) => `${k} → ${v}`)
    .join(", ");

  return {
    ok: false,
    refs,
    mismatch: `Env vars point to different Supabase projects: ${details}. All should use the same project ref.`,
  };
}

// ─── Request ID ─────────────────────────────────────────────

/** Generate a unique request ID for correlation. */
export function generateRequestId(): string {
  return crypto.randomUUID();
}

/**
 * Build a structured error log object for server-side logging.
 * Stack is included for server-side diagnostics; never returned to client.
 */
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
