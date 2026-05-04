"use client";

import { useEffect, useState } from "react";
import { formatCompact } from "@/lib/format";

interface OverBudgetCategory {
  clauseId: string;
  label: string;
  baseline: number;
  spent: number;
}

interface EnvelopeData {
  currency: string;
  hasBaseline: boolean;
  baselineValue: number;
  approvedChanges: number;
  totalCommitted: number;
  spent: number;
  utilizationPct: number;
  overBudgetCategories: OverBudgetCategory[];
}

interface Props {
  programId: string;
}

function thresholdColors(pct: number) {
  // Static thresholds — schema doesn't carry program start/end dates today,
  // so we can't compute time-aware burn rate yet.
  if (pct >= 100) return { bar: "bg-red-500", text: "text-red-700", state: "Over committed" };
  if (pct >= 90) return { bar: "bg-red-500", text: "text-red-700", state: "Near cap" };
  if (pct >= 75) return { bar: "bg-amber-500", text: "text-amber-700", state: "Trending high" };
  if (pct > 0) return { bar: "bg-green-500", text: "text-green-700", state: "On track" };
  return { bar: "bg-zinc-300", text: "text-zinc-600", state: "Not yet started" };
}

export default function SpendVsEnvelope({ programId }: Props) {
  const [data, setData] = useState<EnvelopeData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch(`/api/gateway/scope-envelope?programId=${programId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive) {
          setData(d);
          setLoading(false);
        }
      })
      .catch(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [programId]);

  if (loading) {
    return (
      <div className="card">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">Spend vs SOW Envelope</p>
        <div className="mt-3 h-2 w-full animate-pulse rounded-full bg-zinc-100" />
      </div>
    );
  }

  if (!data) return null;

  if (!data.hasBaseline) {
    return (
      <div className="card">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">Spend vs SOW Envelope</p>
        <p className="mt-3 text-sm text-muted">
          Lock a baseline to see your envelope. Once locked, this card will show what has been spent against what was committed — including any approved change orders.
        </p>
      </div>
    );
  }

  if (data.totalCommitted === 0) {
    return (
      <div className="card">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">Spend vs SOW Envelope</p>
        <p className="mt-3 text-sm text-muted">
          Baseline is locked but contains no monetary clauses (PRICING / PAYMENT_TERMS). Add pricing detail to your baseline to enable envelope tracking.
        </p>
      </div>
    );
  }

  const pct = Math.min(data.utilizationPct, 100);
  const overflowPct = data.utilizationPct > 100 ? data.utilizationPct - 100 : 0;
  const colors = thresholdColors(data.utilizationPct);

  return (
    <div className="card">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Spend vs SOW Envelope</p>
          <p className="mt-2 text-2xl font-bold text-zinc-900">
            {formatCompact(data.spent, data.currency)}{" "}
            <span className="text-base font-normal text-muted">of {formatCompact(data.totalCommitted, data.currency)} committed</span>
          </p>
          <p className="mt-1 text-xs text-muted">
            {formatCompact(data.baselineValue, data.currency)} baseline
            {data.approvedChanges !== 0 && (
              <>
                {" "}
                + {formatCompact(data.approvedChanges, data.currency)} approved changes
              </>
            )}
          </p>
        </div>
        <div className="text-right">
          <p className={`text-2xl font-bold ${colors.text}`}>{Math.round(data.utilizationPct)}%</p>
          <p className={`text-xs font-medium ${colors.text}`}>{colors.state}</p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-4 relative h-2.5 w-full overflow-hidden rounded-full bg-zinc-100">
        <div
          className={`absolute left-0 top-0 h-full rounded-full transition-all ${colors.bar}`}
          style={{ width: `${pct}%` }}
        />
        {overflowPct > 0 && (
          <div
            className="absolute top-0 h-full bg-red-700"
            style={{ left: "0%", width: "100%", opacity: 0.15 }}
          />
        )}
      </div>

      {data.overBudgetCategories.length > 0 ? (
        <div className="mt-4 border-t border-zinc-100 pt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Over-budget categories</p>
          <div className="mt-2 space-y-1.5">
            {data.overBudgetCategories.map((cat) => {
              const ratio = cat.baseline > 0 ? Math.round((cat.spent / cat.baseline) * 100) : 0;
              return (
                <div key={cat.clauseId} className="flex items-center justify-between gap-3 text-xs">
                  <span className="truncate text-zinc-700">{cat.label}</span>
                  <span className="flex-shrink-0 text-muted">
                    {formatCompact(cat.spent, data.currency)} of {formatCompact(cat.baseline, data.currency)}{" "}
                    <span className="font-semibold text-red-600">({ratio}%)</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        data.utilizationPct > 0 && (
          <p className="mt-4 border-t border-zinc-100 pt-3 text-xs text-muted">
            All categories on track against their baseline allocations.
          </p>
        )
      )}
    </div>
  );
}
