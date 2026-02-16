"use client";

import { useState, useCallback, useRef } from "react";

export type ExtractionTarget = "BASELINE" | "INVOICE" | "CHANGE_ORDER" | "TERMS";
export type EvidenceUploadType = "SOW_MSA" | "INVOICE" | "CHANGE_ORDER" | "OTHER";

export type PipelineStatus =
  | "idle"
  | "uploading"
  | "extracting"
  | "applying"
  | "done"
  | "error";

interface ExtractionPipelineOptions {
  programId: string;
  evidenceType: EvidenceUploadType;
  targetType: ExtractionTarget;
  /** Return the body for POST /api/gateway/extraction/[jobId]/apply */
  prepareApplyBody: (
    jobId: string,
    extractedData: Record<string, unknown>,
  ) => Promise<Record<string, string>>;
  /** Called after successful apply */
  onSuccess: (result: { createdCount: number; targetType: string }) => Promise<void>;
  /** Optional error callback */
  onError?: (error: string, step: string) => void;
}

export interface ExtractionPipelineState {
  status: PipelineStatus;
  progress: string;
  error: string | null;
  /** Kick off the full pipeline for a file */
  run: (file: File) => Promise<void>;
  /** Reset to idle state */
  reset: () => void;
}

export function useExtractionPipeline(
  opts: ExtractionPipelineOptions,
): ExtractionPipelineState {
  const [status, setStatus] = useState<PipelineStatus>("idle");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const doneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = useCallback(() => {
    setStatus("idle");
    setProgress("");
    setError(null);
    if (doneTimerRef.current) {
      clearTimeout(doneTimerRef.current);
      doneTimerRef.current = null;
    }
  }, []);

  const run = useCallback(
    async (file: File) => {
      reset();

      try {
        // --- Step 1: Upload evidence ---
        setStatus("uploading");
        setProgress("Uploading document...");

        const fd = new FormData();
        fd.append("file", file);
        fd.append("type", opts.evidenceType);
        fd.append("programId", opts.programId);

        const uploadRes = await fetch("/api/gateway/evidence", {
          method: "POST",
          body: fd,
        });
        if (!uploadRes.ok) {
          const d = await uploadRes.json().catch(() => ({}));
          throw { step: "uploading", message: d.error ?? "Upload failed" };
        }
        const evidence = await uploadRes.json();

        // --- Step 2: Create extraction job + run ---
        setStatus("extracting");
        setProgress("AI is reading your document...");

        const createRes = await fetch("/api/gateway/extraction", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            evidenceId: evidence.id,
            targetType: opts.targetType,
          }),
        });
        if (!createRes.ok) {
          const d = await createRes.json().catch(() => ({}));
          throw { step: "extracting", message: d.error ?? "Failed to create extraction job" };
        }
        const { job } = await createRes.json();

        const runRes = await fetch(`/api/gateway/extraction/${job.id}/run`, {
          method: "POST",
        });
        if (!runRes.ok) {
          const d = await runRes.json().catch(() => ({}));
          throw { step: "extracting", message: d.error ?? "Extraction failed" };
        }
        const runData = await runRes.json();

        // --- Step 3: Apply extracted data ---
        setStatus("applying");
        setProgress("Populating data...");

        const extractedData =
          (runData.job?.extractedData as Record<string, unknown>) ?? {};

        const applyBody = await opts.prepareApplyBody(job.id, extractedData);

        const applyRes = await fetch(
          `/api/gateway/extraction/${job.id}/apply`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(applyBody),
          },
        );
        if (!applyRes.ok) {
          const d = await applyRes.json().catch(() => ({}));
          throw { step: "applying", message: d.error ?? "Failed to apply extracted data" };
        }
        const applyResult = await applyRes.json();

        // --- Done ---
        setStatus("done");
        setProgress(
          `${applyResult.createdCount} item${applyResult.createdCount === 1 ? "" : "s"} extracted successfully`,
        );

        await opts.onSuccess({
          createdCount: applyResult.createdCount,
          targetType: applyResult.targetType,
        });

        doneTimerRef.current = setTimeout(() => {
          setStatus("idle");
          setProgress("");
        }, 4000);
      } catch (err: unknown) {
        const step =
          (err as { step?: string })?.step ?? "unknown";
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

  return { status, progress, error, run, reset };
}
