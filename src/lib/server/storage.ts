import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const BUCKET = "evidence";
const SIGNED_URL_TTL = 300; // 5 minutes

/**
 * Get a Supabase admin client (service role) for storage operations.
 * This bypasses RLS — use only in server-side gateway routes.
 */
function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, serviceKey);
}

/**
 * Compute SHA-256 hash of a buffer.
 */
export function computeSha256(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/**
 * Upload a file to Supabase Storage (private bucket) and return metadata.
 */
export async function uploadEvidence(
  file: Buffer,
  path: string,
  contentType: string
): Promise<{ storagePath: string; sha256Hash: string; fileSize: number }> {
  const admin = getAdminClient();
  const sha256Hash = computeSha256(file);

  const { error } = await admin.storage.from(BUCKET).upload(path, file, {
    contentType,
    upsert: false,
  });

  if (error) {
    throw new Error(`Storage upload failed: ${error.message}`);
  }

  return {
    storagePath: `${BUCKET}/${path}`,
    sha256Hash,
    fileSize: file.length,
  };
}

/**
 * Generate a signed URL for a private file.
 * Short TTL for security.
 */
export async function getSignedUrl(
  storagePath: string,
  ttl: number = SIGNED_URL_TTL
): Promise<string> {
  const admin = getAdminClient();
  // storagePath is "evidence/some/path.pdf" — strip bucket prefix
  const path = storagePath.replace(`${BUCKET}/`, "");

  const { data, error } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(path, ttl);

  if (error || !data?.signedUrl) {
    throw new Error(`Failed to generate signed URL: ${error?.message}`);
  }

  return data.signedUrl;
}

/**
 * Delete a file from storage.
 * Used by the retention cleanup job.
 */
export async function deleteStorageFile(storagePath: string): Promise<void> {
  const admin = getAdminClient();
  const path = storagePath.replace(`${BUCKET}/`, "");

  const { error } = await admin.storage.from(BUCKET).remove([path]);

  if (error) {
    throw new Error(`Storage delete failed: ${error.message}`);
  }
}
