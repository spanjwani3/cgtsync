"use client";

import type { PipelineStatus } from "@/hooks/useExtractionPipeline";

const STEPS = ["Upload", "Extract", "Apply"] as const;

function stepIndex(status: PipelineStatus): number {
  switch (status) {
    case "uploading":
      return 0;
    case "extracting":
      return 1;
    case "applying":
      return 2;
    case "done":
      return 3;
    default:
      return -1;
  }
}

function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin text-teal-600"
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="h-3.5 w-3.5 text-white" viewBox="0 0 20 20" fill="currentColor">
      <path
        fillRule="evenodd"
        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export default function ExtractionProgress({
  status,
  progress,
  error,
  onDismissError,
}: {
  status: PipelineStatus;
  progress: string;
  error: string | null;
  onDismissError?: () => void;
}) {
  if (status === "idle") return null;

  // Error state
  if (status === "error") {
    return (
      <div className="mt-4 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
        <svg className="mt-0.5 h-5 w-5 shrink-0 text-red-500" viewBox="0 0 20 20" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
            clipRule="evenodd"
          />
        </svg>
        <div className="flex-1">
          <p className="text-sm font-medium text-red-800">Extraction failed</p>
          <p className="mt-0.5 text-sm text-red-700">{error}</p>
          <p className="mt-1 text-xs text-red-500">You can try again or add items manually.</p>
        </div>
        {onDismissError && (
          <button
            onClick={onDismissError}
            className="shrink-0 rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
          >
            Dismiss
          </button>
        )}
      </div>
    );
  }

  // Done state
  if (status === "done") {
    return (
      <div className="mt-4 flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 p-4">
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-green-500">
          <CheckIcon />
        </div>
        <p className="text-sm font-medium text-green-800">{progress}</p>
      </div>
    );
  }

  // Active states: uploading, extracting, applying
  const current = stepIndex(status);

  return (
    <div className="mt-4 rounded-lg border border-teal-200 bg-teal-50/50 p-4">
      <div className="flex items-center gap-3">
        <Spinner />
        <p className="text-sm font-medium text-teal-900">{progress}</p>
      </div>

      {/* Step indicators */}
      <div className="mt-3 flex items-center gap-2">
        {STEPS.map((label, i) => {
          const isDone = i < current;
          const isActive = i === current;
          return (
            <div key={label} className="flex items-center gap-2">
              {i > 0 && (
                <div
                  className={`h-px w-6 ${isDone ? "bg-teal-500" : "bg-zinc-300"}`}
                />
              )}
              <div className="flex items-center gap-1.5">
                <div
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                    isDone
                      ? "bg-teal-500 text-white"
                      : isActive
                        ? "bg-teal-600 text-white"
                        : "bg-zinc-200 text-zinc-500"
                  }`}
                >
                  {isDone ? (
                    <CheckIcon />
                  ) : (
                    <span>{i + 1}</span>
                  )}
                </div>
                <span
                  className={`text-xs ${
                    isDone || isActive
                      ? "font-medium text-teal-800"
                      : "text-zinc-400"
                  }`}
                >
                  {label}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
