"use client";

import { useState } from "react";
import type { ReconciliationResult } from "@/lib/server/baselineReconciliation";

function fmt(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function signedFmt(n: number): string {
  const sign = n >= 0 ? "+" : "−";
  return `${sign}$${fmt(Math.abs(n))}`;
}

/**
 * Renders the reconciliation banner above the baseline items list.
 *
 * The banner is driven by the PRIMARY stated total only — sub-tier
 * mismatches surface as a softer disclosure under the headline, not as a
 * competing color, so operators get one unambiguous green/amber signal.
 */
export default function ReconciliationBanner({
  reconciliation,
}: {
  reconciliation: ReconciliationResult | null;
}) {
  const [expanded, setExpanded] = useState(false);

  if (!reconciliation || !reconciliation.primary) return null;

  const { primary, secondary, hasMismatch, hasSecondaryMismatch } = reconciliation;
  const isMatch = !hasMismatch;

  if (isMatch) {
    return (
      <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4">
        <div className="flex items-start gap-3">
          <svg
            className="mt-0.5 h-5 w-5 flex-shrink-0 text-emerald-600"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-emerald-900">
              Reconciles to {primary.label}: ${fmt(primary.statedValue)}
            </p>
            <p className="mt-0.5 text-xs text-emerald-700">
              Computed total ${fmt(primary.computedValue)} matches the SOW&rsquo;s stated total.
            </p>
            {hasSecondaryMismatch && (
              <button
                onClick={() => setExpanded((e) => !e)}
                className="mt-2 text-xs font-medium text-emerald-800 underline-offset-2 hover:underline"
              >
                {expanded ? "Hide" : "View"} sub-tier breakdown ({secondary.length})
              </button>
            )}
            {expanded && hasSecondaryMismatch && (
              <SecondaryBreakdown lines={secondary} />
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
      <div className="flex items-start gap-3">
        <svg
          className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-amber-900">
            Baseline doesn&rsquo;t reconcile to {primary.label}
          </p>
          <div className="mt-1 grid grid-cols-3 gap-3 text-xs">
            <div>
              <p className="text-amber-700">Computed</p>
              <p className="font-semibold text-amber-900">${fmt(primary.computedValue)}</p>
            </div>
            <div>
              <p className="text-amber-700">SOW stated</p>
              <p className="font-semibold text-amber-900">${fmt(primary.statedValue)}</p>
            </div>
            <div>
              <p className="text-amber-700">Delta</p>
              <p className="font-semibold text-amber-900">{signedFmt(primary.delta)}</p>
            </div>
          </div>
          {primary.note && (
            <p className="mt-2 rounded-md bg-amber-100/70 p-2 text-xs text-amber-900">
              {primary.note}
            </p>
          )}
          {secondary.length > 0 && (
            <button
              onClick={() => setExpanded((e) => !e)}
              className="mt-2 text-xs font-medium text-amber-800 underline-offset-2 hover:underline"
            >
              {expanded ? "Hide" : "View"} sub-tier breakdown ({secondary.length})
            </button>
          )}
          {expanded && secondary.length > 0 && <SecondaryBreakdown lines={secondary} />}
        </div>
      </div>
    </div>
  );
}

function SecondaryBreakdown({ lines }: { lines: ReconciliationResult["secondary"] }) {
  return (
    <table className="mt-2 w-full text-xs">
      <thead>
        <tr className="text-left text-zinc-500">
          <th className="py-1 font-medium">Tier total</th>
          <th className="py-1 text-right font-medium">Computed</th>
          <th className="py-1 text-right font-medium">Stated</th>
          <th className="py-1 text-right font-medium">Delta</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l, i) => {
          const ok = l.status === "MATCH" || l.status === "MINOR_DRIFT";
          return (
            <tr key={i} className="border-t border-zinc-200/60">
              <td className="py-1 text-zinc-700">{l.label}</td>
              <td className="py-1 text-right font-mono text-zinc-700">
                ${fmt(l.computedValue)}
              </td>
              <td className="py-1 text-right font-mono text-zinc-700">
                ${fmt(l.statedValue)}
              </td>
              <td
                className={`py-1 text-right font-mono ${
                  ok ? "text-emerald-700" : "text-amber-700 font-semibold"
                }`}
              >
                {signedFmt(l.delta)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
