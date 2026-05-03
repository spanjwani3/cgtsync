"use client";

import { useState, useEffect } from "react";

interface ImpactSummary {
  baselineTotal: number;
  confirmedChangesTotal: number;
  pendingChangesTotal: number;
  projectedTotal: number;
  currency: string;
}

export default function ImpactCard({ programId }: { programId: string }) {
  const [data, setData] = useState<ImpactSummary | null>(null);

  useEffect(() => {
    fetch(`/api/changes/impact-summary?programId=${programId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setData(d); });
  }, [programId]);

  if (!data || (data.baselineTotal === 0 && data.confirmedChangesTotal === 0)) return null;

  const fmt = (n: number) => `${data.currency} ${n.toLocaleString()}`;
  const baselinePct = data.projectedTotal > 0 ? (data.baselineTotal / data.projectedTotal) * 100 : 100;
  const changePct = data.projectedTotal > 0 ? (data.confirmedChangesTotal / data.projectedTotal) * 100 : 0;

  return (
    <div className="rounded-lg border border-card-border bg-card-bg p-4">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">Financial Impact</h4>
      <div className="mt-3 grid grid-cols-3 gap-4 text-center">
        <div>
          <p className="text-xs text-muted">Baseline Total</p>
          <p className="mt-0.5 text-lg font-bold text-zinc-900">{fmt(data.baselineTotal)}</p>
        </div>
        <div>
          <p className="text-xs text-muted">Change Impact</p>
          <p className="mt-0.5 text-lg font-bold text-red-600">+{fmt(data.confirmedChangesTotal)}</p>
          {data.pendingChangesTotal > 0 && (
            <p className="text-[10px] text-amber-600">+{fmt(data.pendingChangesTotal)} pending</p>
          )}
        </div>
        <div>
          <p className="text-xs text-muted">Projected Total</p>
          <p className="mt-0.5 text-lg font-bold text-zinc-900">{fmt(data.projectedTotal)}</p>
        </div>
      </div>
      <div className="mt-3 flex h-2 rounded-full overflow-hidden bg-zinc-100">
        <div className="bg-accent transition-all" style={{ width: `${baselinePct}%` }} />
        <div className="bg-red-400 transition-all" style={{ width: `${changePct}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted">
        <span>Baseline</span>
        <span>Changes (+{changePct.toFixed(1)}%)</span>
      </div>
    </div>
  );
}
