"use client";

import { useState, useEffect } from "react";
import { formatCompact } from "@/lib/format";

interface AgingBucket {
  label: string;
  amount: number;
  count: number;
  percentage: number;
}

interface DelinquentAccount {
  programId: string;
  name: string;
  cdmoName: string;
  overdueAmount: number;
  maxDaysOverdue: number;
}

interface ExecutiveData {
  metrics: {
    totalInvoiced: number;
    totalOutstanding: number;
    flaggedCount: number;
    flaggedAmount: number;
    disputedCount: number;
    disputedAmount: number;
    currency: string;
    invoiceCount: number;
  };
  agingBuckets: AgingBucket[];
  collectionVelocity: { count: number; amount: number; periodDays: number };
  delinquentAccounts: DelinquentAccount[];
}

interface ExecutiveDashboardProps {
  readOnly?: boolean;
}

const BUCKET_COLORS = [
  "bg-green-400",
  "bg-amber-400",
  "bg-orange-400",
  "bg-red-400",
  "bg-red-600",
];

const BUCKET_TEXT_COLORS = [
  "text-green-700",
  "text-amber-700",
  "text-orange-700",
  "text-red-700",
  "text-red-800",
];

const BUCKET_BG_COLORS = [
  "bg-green-50",
  "bg-amber-50",
  "bg-orange-50",
  "bg-red-50",
  "bg-red-100",
];

export default function ExecutiveDashboard({ readOnly }: ExecutiveDashboardProps) {
  const [data, setData] = useState<ExecutiveData | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    fetch("/api/dashboard/executive")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  async function handleExport() {
    setExporting(true);
    try {
      const res = await fetch("/api/dashboard/executive/export", { method: "POST" });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `executive-dashboard-${new Date().toISOString().split("T")[0]}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch { /* silent */ }
    setExporting(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex items-center gap-3 text-sm text-muted">
          <svg className="h-5 w-5 animate-spin text-accent" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
          Loading executive view...
        </div>
      </div>
    );
  }

  if (!data) return <div className="py-8 text-sm text-red-500">Failed to load executive data</div>;

  const { metrics, agingBuckets, collectionVelocity, delinquentAccounts } = data;
  const cur = metrics.currency;
  const fmt = (n: number) => `${cur} ${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  return (
    <div>
      {/* Export button */}
      {!readOnly && (
        <div className="mt-4 flex justify-end">
          <button onClick={handleExport} disabled={exporting} className="btn-secondary text-sm">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
            {exporting ? "Generating..." : "Export PDF"}
          </button>
        </div>
      )}

      {/* Metric cards */}
      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="card">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Total Invoiced</p>
          <p className="mt-2 text-2xl font-bold text-zinc-900">{fmt(metrics.totalInvoiced)}</p>
          <p className="mt-1 text-xs text-muted">{metrics.invoiceCount} invoices</p>
        </div>
        <div className="card">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Outstanding</p>
          <p className={`mt-2 text-2xl font-bold ${metrics.totalOutstanding > 0 ? "text-amber-600" : "text-zinc-900"}`}>{fmt(metrics.totalOutstanding)}</p>
        </div>
        <div className="card">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Flagged</p>
          <p className={`mt-2 text-2xl font-bold ${metrics.flaggedCount > 0 ? "text-red-600" : "text-zinc-900"}`}>{metrics.flaggedCount}</p>
          {metrics.flaggedCount > 0 && (
            <p className="mt-1 text-xs text-muted">{formatCompact(metrics.flaggedAmount, metrics.currency)} under review</p>
          )}
        </div>
        <div className="card">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Disputed</p>
          <p className={`mt-2 text-2xl font-bold ${metrics.disputedCount > 0 ? "text-red-600" : "text-zinc-900"}`}>{metrics.disputedCount}</p>
          {metrics.disputedCount > 0 && (
            <p className="mt-1 text-xs text-muted">{formatCompact(metrics.disputedAmount, metrics.currency)} being challenged</p>
          )}
        </div>
      </div>

      {/* Aging Buckets */}
      <div className="mt-6 card">
        <h2 className="text-sm font-semibold text-zinc-900">Aging Buckets</h2>
        <p className="mt-1 text-xs text-muted">Outstanding invoices by days past due date</p>

        {/* Stacked bar chart */}
        <div className="mt-4 flex h-10 w-full overflow-hidden rounded-lg">
          {agingBuckets.map((bucket, i) => (
            bucket.percentage > 0 && (
              <div
                key={i}
                className={`${BUCKET_COLORS[i]} flex items-center justify-center text-xs font-semibold text-white`}
                style={{ width: `${Math.max(bucket.percentage, 3)}%` }}
                title={`${bucket.label}: ${fmt(bucket.amount)} (${bucket.percentage}%)`}
              >
                {bucket.percentage > 8 ? `${bucket.percentage}%` : ""}
              </div>
            )
          ))}
          {agingBuckets.every((b) => b.percentage === 0) && (
            <div className="flex h-full w-full items-center justify-center bg-zinc-100 text-xs text-muted">No outstanding invoices</div>
          )}
        </div>

        {/* Legend */}
        <div className="mt-3 flex flex-wrap gap-4">
          {agingBuckets.map((bucket, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className={`h-3 w-3 rounded-sm ${BUCKET_COLORS[i]}`} />
              <span className="text-xs text-zinc-600">{bucket.label}</span>
              <span className={`text-xs font-semibold ${BUCKET_TEXT_COLORS[i]}`}>{fmt(bucket.amount)}</span>
              <span className="text-xs text-muted">({bucket.count})</span>
            </div>
          ))}
        </div>
      </div>

      {/* Collection Velocity */}
      <div className="mt-6 card">
        <h2 className="text-sm font-semibold text-zinc-900">Collection Velocity</h2>
        <div className="mt-3 flex items-baseline gap-3">
          <p className="text-2xl font-bold text-green-600">{fmt(collectionVelocity.amount)}</p>
          <p className="text-sm text-muted">collected in the last {collectionVelocity.periodDays} days</p>
        </div>
        <p className="mt-1 text-xs text-muted">{collectionVelocity.count} invoice{collectionVelocity.count !== 1 ? "s" : ""} approved</p>
      </div>

      {/* Collection Forecast */}
      {(() => {
        const dailyRate = collectionVelocity.periodDays > 0
          ? collectionVelocity.amount / collectionVelocity.periodDays
          : 0;
        const daysToZero = dailyRate > 0
          ? Math.ceil(metrics.totalOutstanding / dailyRate)
          : null;
        const zeroDate = daysToZero != null
          ? new Date(Date.now() + daysToZero * 86_400_000)
          : null;

        const BUCKET_EST_DAYS = [15, 20, 35, 50, 75];
        const bucketForecasts = agingBuckets
          .map((b, i) => ({
            label: b.label,
            amount: b.amount,
            estDays: BUCKET_EST_DAYS[i] ?? 75,
            projectedBy: new Date(Date.now() + (BUCKET_EST_DAYS[i] ?? 75) * 86_400_000),
          }))
          .filter((b) => b.amount > 0);

        const ninetyPlusBucket = agingBuckets[4];
        const atRiskPct = metrics.totalOutstanding > 0 && ninetyPlusBucket
          ? Math.round((ninetyPlusBucket.amount / metrics.totalOutstanding) * 100)
          : 0;

        const fmtDate = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

        return (
          <div className="mt-6 card">
            <div className="flex items-center gap-2">
              <svg className="h-4 w-4 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
              <h2 className="text-sm font-semibold text-zinc-900">Collection Forecast</h2>
            </div>

            {metrics.totalOutstanding === 0 ? (
              <p className="mt-3 text-sm text-green-600 font-medium">No outstanding invoices. All caught up.</p>
            ) : dailyRate === 0 ? (
              <p className="mt-3 text-sm text-amber-600">No collections in the last {collectionVelocity.periodDays} days — unable to project.</p>
            ) : (
              <>
                <div className="mt-3 flex items-baseline gap-3">
                  <p className="text-2xl font-bold text-zinc-900">{daysToZero} days</p>
                  <p className="text-sm text-muted">to clear outstanding balance</p>
                </div>
                {zeroDate && (
                  <p className="mt-1 text-xs text-muted">
                    Projected payoff: <span className="font-medium text-zinc-700">{fmtDate(zeroDate)}</span>
                    <span className="ml-1">(at {fmt(Math.round(dailyRate))}/day)</span>
                  </p>
                )}

                {bucketForecasts.length > 0 && (
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr>
                          <th className="text-left font-medium text-muted pb-2">Bucket</th>
                          <th className="text-right font-medium text-muted pb-2">Outstanding</th>
                          <th className="text-right font-medium text-muted pb-2">Est. Days</th>
                          <th className="text-right font-medium text-muted pb-2">Projected By</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bucketForecasts.map((b, i) => (
                          <tr key={i} className={i % 2 === 0 ? "bg-zinc-50" : ""}>
                            <td className="py-1.5 pl-2 text-zinc-700">{b.label}</td>
                            <td className="py-1.5 text-right font-medium text-zinc-900">{fmt(b.amount)}</td>
                            <td className="py-1.5 text-right text-zinc-600">~{b.estDays}d</td>
                            <td className="py-1.5 pr-2 text-right text-zinc-600">{fmtDate(b.projectedBy)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {atRiskPct >= 25 && (
                  <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                    <span className="font-semibold">{atRiskPct}%</span> of outstanding is 90+ days overdue — collection risk
                  </div>
                )}
              </>
            )}
          </div>
        );
      })()}

      {/* Delinquent Accounts */}
      {delinquentAccounts.length > 0 && (
        <div className="mt-6 card">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-900">Delinquent Accounts</h2>
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-100 text-xs font-bold text-red-600">{delinquentAccounts.length}</span>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th>Program</th>
                  <th>CDMO</th>
                  <th className="text-right">Overdue Amount</th>
                  <th className="text-right">Max Days Overdue</th>
                </tr>
              </thead>
              <tbody>
                {delinquentAccounts.map((d) => (
                  <tr key={d.programId} className="cursor-pointer hover:bg-zinc-50" onClick={() => window.location.href = `/programs/${d.programId}/invoices`}>
                    <td className="font-medium text-zinc-900">{d.name}</td>
                    <td className="text-zinc-600">{d.cdmoName}</td>
                    <td className="text-right font-semibold text-red-600">{fmt(d.overdueAmount)}</td>
                    <td className="text-right text-zinc-700">{d.maxDaysOverdue}d</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
