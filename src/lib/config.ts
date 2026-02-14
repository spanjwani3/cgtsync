/**
 * Centralized configuration constants.
 * Bucket names, env var keys, and defaults used across the app.
 */

/** Supabase Storage bucket for evidence files. Override via SUPABASE_EVIDENCE_BUCKET env var. */
export const EVIDENCE_BUCKET =
  process.env.SUPABASE_EVIDENCE_BUCKET ?? "evidence";

/** All environment variables the app requires. Grouped by context. */
export const REQUIRED_ENV = {
  // Public (available client-side)
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  // Server-only
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  DATABASE_URL: process.env.DATABASE_URL,
} as const;

/** Optional but recommended env vars. */
export const OPTIONAL_ENV = {
  DIRECT_URL: process.env.DIRECT_URL,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
} as const;

/** Check which required env vars are present (booleans only, never values). */
export function checkRequiredEnv(): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const key of Object.keys(REQUIRED_ENV)) {
    result[key] = !!process.env[key];
  }
  return result;
}

/** Return list of missing required env var names. */
export function getMissingEnv(): string[] {
  return Object.keys(REQUIRED_ENV).filter((key) => !process.env[key]);
}
