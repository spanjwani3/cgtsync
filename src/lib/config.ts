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
