"use client";

import { useState } from "react";

interface Candidate {
  changeTitle: string;
  description?: string | null;
  severity?: string;
  estimatedImpact?: number | null;
  scheduleImpactDays?: number | null;
  speaker?: string | null;
  confidence: number;
}

export default function CandidateReviewTable({
  candidates,
  onApply,
  applying,
}: {
  candidates: Candidate[];
  onApply: (selectedIndices: number[]) => void;
  applying: boolean;
}) {
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(candidates.map((_, i) => i).filter((i) => candidates[i].confidence >= 0.5)),
  );

  function toggle(index: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === candidates.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(candidates.map((_, i) => i)));
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-muted">
          Found <span className="font-semibold text-zinc-900">{candidates.length}</span> potential scope changes.
          Select which ones to log.
        </p>
        <button onClick={toggleAll} className="text-xs font-medium text-accent hover:text-accent-text">
          {selected.size === candidates.length ? "Deselect All" : "Select All"}
        </button>
      </div>

      <div className="max-h-80 space-y-2 overflow-y-auto">
        {candidates.map((c, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => toggle(idx)}
            className={`w-full rounded-lg border p-3 text-left transition-all ${
              selected.has(idx)
                ? "border-accent bg-accent-light/20"
                : "border-card-border bg-card-bg opacity-60"
            }`}
          >
            <div className="flex items-start gap-3">
              <div className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                selected.has(idx) ? "border-accent bg-accent text-white" : "border-zinc-300"
              }`}>
                {selected.has(idx) && (
                  <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-zinc-900">{c.changeTitle}</span>
                  {c.speaker && (
                    <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500">{c.speaker}</span>
                  )}
                </div>
                {c.description && (
                  <p className="mt-0.5 text-xs text-muted line-clamp-2">{c.description}</p>
                )}
                <div className="mt-1.5 flex items-center gap-3">
                  {c.estimatedImpact != null && (
                    <span className="text-xs font-semibold text-red-600">+${Number(c.estimatedImpact).toLocaleString()}</span>
                  )}
                  {c.scheduleImpactDays != null && (
                    <span className="text-xs text-zinc-500">+{c.scheduleImpactDays} days</span>
                  )}
                  <div className="flex items-center gap-1">
                    <div className="h-1.5 w-12 rounded-full bg-zinc-200">
                      <div
                        className={`h-1.5 rounded-full ${c.confidence >= 0.7 ? "bg-green-500" : c.confidence >= 0.4 ? "bg-amber-500" : "bg-red-400"}`}
                        style={{ width: `${Math.round(c.confidence * 100)}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-zinc-400">{Math.round(c.confidence * 100)}%</span>
                  </div>
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>

      <div className="mt-4 flex justify-end">
        <button
          onClick={() => onApply(Array.from(selected))}
          disabled={selected.size === 0 || applying}
          className="btn-primary disabled:opacity-50"
        >
          {applying ? "Logging..." : `Log Selected (${selected.size})`}
        </button>
      </div>
    </div>
  );
}
