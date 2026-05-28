import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { EVIDENCE_BUCKET, DEMO_BUCKET } from "@/lib/config";

const SIGNED_URL_TTL = 300; // 5 minutes

/**
 * Get a Supabase admin client (service role) for storage operations.
 * This bypasses RLS — use only in server-side gateway routes.
 * Throws a descriptive error if env vars are missing.
 */
function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  }
  if (!serviceKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(url, serviceKey);
}

/**
 * Compute SHA-256 hash of a buffer.
 */
export function computeSha256(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/**
 * Verify that the evidence bucket exists. Returns { exists, error? }.
 */
export async function checkBucketExists(): Promise<{
  exists: boolean;
  error?: string;
}> {
  try {
    const admin = getAdminClient();
    const { data, error } = await admin.storage.getBucket(EVIDENCE_BUCKET);
    if (error || !data) {
      return {
        exists: false,
        error: `Bucket "${EVIDENCE_BUCKET}" not found. Create it in Supabase Storage.`,
      };
    }
    return { exists: true };
  } catch (e) {
    return {
      exists: false,
      error: e instanceof Error ? e.message : "Unknown error checking bucket",
    };
  }
}

/**
 * Create the evidence bucket if it doesn't exist (idempotent).
 * Bucket is private (no public access).
 */
export async function ensureBucketExists(): Promise<{
  created: boolean;
  error?: string;
}> {
  try {
    const admin = getAdminClient();
    const { data: existing } = await admin.storage.getBucket(EVIDENCE_BUCKET);
    if (existing) {
      return { created: false }; // already exists
    }

    const { error } = await admin.storage.createBucket(EVIDENCE_BUCKET, {
      public: false,
      fileSizeLimit: 50 * 1024 * 1024, // 50 MB
    });

    if (error) {
      // "already exists" race is not an error
      if (error.message?.includes("already exists")) {
        return { created: false };
      }
      return { created: false, error: error.message };
    }

    return { created: true };
  } catch (e) {
    return {
      created: false,
      error: e instanceof Error ? e.message : "Unknown error creating bucket",
    };
  }
}

/**
 * Upload a file to Supabase Storage (private bucket) and return metadata.
 * Validates bucket exists before upload.
 */
export async function uploadEvidence(
  file: Buffer,
  path: string,
  contentType: string
): Promise<{ storagePath: string; sha256Hash: string; fileSize: number }> {
  const admin = getAdminClient();
  const sha256Hash = computeSha256(file);

  // Verify bucket exists before attempting upload
  const { exists, error: bucketError } = await checkBucketExists();
  if (!exists) {
    throw new Error(
      bucketError ??
        `Bucket "${EVIDENCE_BUCKET}" not found. Create it in Supabase Storage.`
    );
  }

  const { error } = await admin.storage
    .from(EVIDENCE_BUCKET)
    .upload(path, file, {
      contentType,
      upsert: false,
    });

  if (error) {
    throw new Error(`Storage upload failed: ${error.message}`);
  }

  return {
    storagePath: `${EVIDENCE_BUCKET}/${path}`,
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
  const path = storagePath.replace(`${EVIDENCE_BUCKET}/`, "");

  const { data, error } = await admin.storage
    .from(EVIDENCE_BUCKET)
    .createSignedUrl(path, ttl);

  if (error || !data?.signedUrl) {
    throw new Error(`Failed to generate signed URL: ${error?.message}`);
  }

  return data.signedUrl;
}

/**
 * Generate a signed URL for a demo video in the private DEMO_BUCKET.
 * Default TTL is long enough to play a full demo (4h).
 */
export async function getDemoVideoSignedUrl(
  path: string,
  ttl: number = 4 * 60 * 60,
): Promise<string> {
  const admin = getAdminClient();

  const { data, error } = await admin.storage
    .from(DEMO_BUCKET)
    .createSignedUrl(path, ttl);

  if (error || !data?.signedUrl) {
    throw new Error(`Failed to generate demo signed URL: ${error?.message}`);
  }

  return data.signedUrl;
}

/**
 * Delete a file from storage.
 * Used by the retention cleanup job.
 */
export async function deleteStorageFile(storagePath: string): Promise<void> {
  const admin = getAdminClient();
  const path = storagePath.replace(`${EVIDENCE_BUCKET}/`, "");

  const { error } = await admin.storage
    .from(EVIDENCE_BUCKET)
    .remove([path]);

  if (error) {
    throw new Error(`Storage delete failed: ${error.message}`);
  }
}
