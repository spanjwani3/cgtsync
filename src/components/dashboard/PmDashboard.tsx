"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import StatusBadge from "@/components/ui/StatusBadge";

interface PendingItem {
  id: string;
  sequenceNum?: number;
  version?: number;
  title: string;
}

interface ProgramData {
  id: string;
  name: string;
  cdmoName: string;
  molecule: string | null;
  status: string;
  _count: { baselines: number; changes: number; invoices: number };
  pendingConfirmations: number;
  pendingBaselines: PendingItem[];
  pendingChanges: PendingItem[];
  flaggedInvoices: number;
  disputedInvoices: number;
  totalInvoiced: number;
  overdueCount: number;
}

export default function PmDashboard() {
  const [programs, setPrograms] = useState<ProgramData[]>([]);
  const [pendingTotal, setPendingTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/dashboard/pm")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          setPrograms(data.programs);
          setPendingTotal(data.pendingTotal);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex items-center gap-3 text-sm text-muted">
          <svg className="h-5 w-5 animate-spin text-accent" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
          Loading dashboard...
        </div>
      </div>
    );
  }

  // Collect all pending items across programs
  const allPending: { programName: string; label: string; type: string; href: string }[] = [];
  for (const p of programs) {
    for (const b of p.pendingBaselines) {
      allPending.push({ programName: p.name, label: `Baseline v${b.version}: ${b.title}`, type: "BASELINE", href: `/programs/${p.id}/baseline` });
    }
    for (const c of p.pendingChanges) {
      allPending.push({ programName: p.name, label: `Change #${c.sequenceNum}: ${c.title}`, type: "CHANGE", href: `/programs/${p.id}/changes` });
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">My Dashboard</h1>
          <p className="mt-1 text-sm text-muted">{programs.length} program{programs.length !== 1 ? "s" : ""} assigned to you</p>
        </div>
        <Link href="/programs" className="btn-secondary text-sm">View All Programs</Link>
      </div>

      {/* Quick stats */}
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="card">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">My Programs</p>
          <p className="mt-2 text-2xl font-bold text-zinc-900">{programs.length}</p>
        </div>
        <div className="card">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Pending Confirmations</p>
          <p className={`mt-2 text-2xl font-bold ${pendingTotal > 0 ? "text-amber-600" : "text-zinc-900"}`}>{pendingTotal}</p>
        </div>
        <div className="card">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Flagged Invoices</p>
          <p className={`mt-2 text-2xl font-bold ${programs.some((p) => p.flaggedInvoices > 0) ? "text-red-600" : "text-zinc-900"}`}>
            {programs.reduce((s, p) => s + p.flaggedInvoices, 0)}
          </p>
        </div>
        <div className="card">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Overdue</p>
          <p className={`mt-2 text-2xl font-bold ${programs.some((p) => p.overdueCount > 0) ? "text-red-600" : "text-zinc-900"}`}>
            {programs.reduce((s, p) => s + p.overdueCount, 0)}
          </p>
        </div>
      </div>

      {/* Pending actions */}
      {allPending.length > 0 && (
        <div className="mt-6 card border-amber-200 bg-amber-50/30">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-900">Pending Actions</h2>
            <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-amber-100 px-1.5 text-xs font-bold text-amber-700">{allPending.length}</span>
          </div>
          <div className="mt-3 space-y-2">
            {allPending.map((item, i) => (
              <Link key={i} href={item.href} className="flex items-center justify-between rounded-lg border border-amber-200 bg-white p-3 transition-colors hover:shadow-sm">
                <div className="flex items-center gap-3">
                  <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${
                    item.type === "BASELINE" ? "bg-purple-100 text-purple-700" : "bg-amber-100 text-amber-700"
                  }`}>{item.type}</span>
                  <span className="text-sm font-medium text-zinc-700">{item.label}</span>
                </div>
                <span className="text-xs text-muted">{item.programName}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Program cards */}
      <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {programs.map((p) => (
          <Link key={p.id} href={`/programs/${p.id}/cockpit`} className="card card-hover group">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-zinc-900 group-hover:text-accent-text">{p.name}</h3>
                <p className="mt-0.5 text-sm text-muted">{p.cdmoName}</p>
              </div>
              <StatusBadge status={p.status} />
            </div>
            {p.molecule && <p className="mt-2 text-xs text-muted">{p.molecule}</p>}

            {/* Alerts */}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {p.pendingConfirmations > 0 && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                  {p.pendingConfirmations} pending
                </span>
              )}
              {p.flaggedInvoices > 0 && (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">
                  {p.flaggedInvoices} flagged
                </span>
              )}
              {p.overdueCount > 0 && (
                <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-700">
                  {p.overdueCount} overdue
                </span>
              )}
            </div>

            <div className="mt-3 flex gap-4 border-t border-card-border pt-3 text-xs text-muted">
              <span><span className="font-semibold text-zinc-700">{p._count.baselines}</span> baselines</span>
              <span><span className="font-semibold text-zinc-700">{p._count.changes}</span> changes</span>
              <span><span className="font-semibold text-zinc-700">{p._count.invoices}</span> invoices</span>
            </div>
          </Link>
        ))}
      </div>

      {programs.length === 0 && (
        <div className="mt-16 flex flex-col items-center">
          <p className="font-medium text-zinc-900">No programs assigned to you</p>
          <p className="mt-1 text-sm text-muted">Ask an admin to assign you to a program</p>
        </div>
      )}
    </div>
  );
}
