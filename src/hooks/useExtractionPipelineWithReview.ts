"use client";

import { useState, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import type { EvidenceUploadType, ExtractionTarget } from "./useExtractionPipeline";

export type ReviewPipelineStatus =
  | "idle"
  | "uploading"
  | "extracting"
  | "reviewing"
  | "applying"
  | "done"
  | "error";

interface ReviewPipelineOptions {
  programId: string;
  evidenceType: EvidenceUploadType;
  targetType: ExtractionTarget;
  onSuccess: (result: { createdCount: number; targetType: string }) => Promise<void>;
  onError?: (error: string, step: string) => void;
}

export interface ReviewPipelineState {
  status: ReviewPipelineStatus;
  progress: string;
  error: string | null;
  /** Extracted data exposed for the review UI */
  extractedData: Record<string, unknown> | null;
  /** Job ID exposed for the apply call */
  jobId: string | null;
  /** Start the upload + extraction pipeline */
  run: (file: File) => Promise<void>;
  /** After user reviews, apply selected candidates */
  applySelected: (selectedIndices: number[]) => Promise<void>;
  /** Reset to idle state */
  reset: () => void;
}

/** Translate raw API error messages into user-friendly text */
function friendlyError(raw: string): string {
  if (raw === "Unauthorized" || raw === "UNAUTHORIZED") {
    return "Your session has expired. Please refresh the page and sign in again.";
  }
  if (raw === "Forbidden" || raw === "FORBIDDEN") {
    return "You don't have permission to perform this action. An Operator or Admin role is required.";
  }
  return raw;
}

export function useExtractionPipelineWithReview(
  opts: ReviewPipelineOptions,
): ReviewPipelineState {
  const [status, setStatus] = useState<ReviewPipelineStatus>("idle");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [extractedData, setExtractedData] = useState<Record<string, unknown> | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const doneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = useCallback(() => {
    setStatus("idle");
    setProgress("");
    setError(null);
    setExtractedData(null);
    setJobId(null);
    if (doneTimerRef.current) {
      clearTimeout(doneTimerRef.current);
      doneTimerRef.current = null;
    }
  }, []);

  const run = useCallback(
    async (file: File) => {
      reset();

      try {
        // Pre-check: verify session is active
        const supabase = createClient();
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          throw { step: "auth", message: "Your session has expired. Please refresh the page and sign in again." };
        }

        // Step 1: Upload evidence
        setStatus("uploading");
        setProgress("Uploading document...");

        const fd = new FormData();
        fd.append("file", file);
        fd.append("type", opts.evidenceType);
        fd.append("programId", opts.programId);

        const uploadRes = await fetch("/api/gateway/evidence", {
          method: "POST",
          body: fd,
          credentials: "same-origin",
        });
        if (!uploadRes.ok) {
          const d = await uploadRes.json().catch(() => ({}));
          throw { step: "uploading", message: friendlyError(d.error ?? "Upload failed") };
        }
        const evidence = await uploadRes.json();

        // Step 2: Create extraction job + run
        setStatus("extracting");
        setProgress("AI is scanning for scope changes...");

        const createRes = await fetch("/api/gateway/extraction", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            evidenceId: evidence.id,
            targetType: opts.targetType,
          }),
          credentials: "same-origin",
        });
        if (!createRes.ok) {
          const d = await createRes.json().catch(() => ({}));
          throw { step: "extracting", message: friendlyError(d.error ?? "Failed to create extraction job") };
        }
        const { job } = await createRes.json();

        const runRes = await fetch(`/api/gateway/extraction/${job.id}/run`, {
          method: "POST",
          credentials: "same-origin",
        });
        if (!runRes.ok) {
          const d = await runRes.json().catch(() => ({}));
          throw { step: "extracting", message: friendlyError(d.error ?? "Extraction failed") };
        }
        const runData = await runRes.json();
        const extracted =
          (runData.job?.extractedData as Record<string, unknown>) ?? {};

        // Step 3: Pause at "reviewing" — expose data for the UI
        setExtractedData(extracted);
        setJobId(job.id);
        setStatus("reviewing");
        setProgress("Review extracted candidates below");
      } catch (err: unknown) {
        const step = (err as { step?: string })?.step ?? "unknown";
        const message =
          (err as { message?: string })?.message ??
          (err instanceof Error ? err.message : "An unexpected error occurred");

        setStatus("error");
        setError(message);
        setProgress("");
        opts.onError?.(message, step);
      }
    },
    [opts, reset],
  );

  const applySelected = useCallback(
    async (selectedIndices: number[]) => {
      if (!jobId) return;

      try {
        setStatus("applying");
        setProgress("Creating change records...");

        const applyRes = await fetch(
          `/api/gateway/extraction/${jobId}/apply`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ selectedIndices }),
            credentials: "same-origin",
          },
        );
        if (!applyRes.ok) {
          const d = await applyRes.json().catch(() => ({}));
          throw { step: "applying", message: friendlyError(d.error ?? "Failed to apply") };
        }
        const applyResult = await applyRes.json();

        setStatus("done");
        setProgress(
          `${applyResult.createdCount} change${applyResult.createdCount === 1 ? "" : "s"} logged successfully`,
        );

        await opts.onSuccess({
          createdCount: applyResult.createdCount,
          targetType: applyResult.targetType,
        });

        doneTimerRef.current = setTimeout(() => {
          reset();
        }, 4000);
      } catch (err: unknown) {
        const step = (err as { step?: string })?.step ?? "unknown";
        const message =
          (err as { message?: string })?.message ??
          (err instanceof Error ? err.message : "An unexpected error occurred");

        setStatus("error");
        setError(message);
        setProgress("");
        opts.onError?.(message, step);
      }
    },
    [jobId, opts, reset],
  );

  return { status, progress, error, extractedData, jobId, run, applySelected, reset };
}
