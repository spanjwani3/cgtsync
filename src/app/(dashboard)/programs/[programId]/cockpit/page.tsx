"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import StatusBadge from "@/components/ui/StatusBadge";
import { useSyncProgram } from "@/components/layout/useSyncProgram";

interface Program {
  id: string;
  name: string;
  cdmoName: string;
  molecule: string | null;
  modality: string | null;
  status: string;
  currency: string;
  changeThreshold: string | null;
  activatedAt: string | null;
  _count: { baselines: number; changes: number; invoices: number; commitmentTerms: number };
}

interface RedFlag {
  id: string;
  description: string;
  amount: string;
  flag: string;
  flagNote: string | null;
  invoice: { invoiceNumber: string | null; id: string };
}

export default function CockpitPage() {
  const { programId } = useParams<{ programId: string }>();
  const [program, setProgram] = useState<Program | null>(null);
  const [flags, setFlags] = useState<RedFlag[]>([]);
  const [loading, setLoading] = useState(true);

  useSyncProgram(program ? { id: program.id, name: program.name, molecule: program.molecule } : null);

  const load = useCallback(async () => {
    const [pRes] = await Promise.all([
      fetch(`/api/programs/${programId}`),
    ]);
    if (pRes.ok) {
      const pData = await pRes.json();
      setProgram(pData.program ?? pData);
    }

    const invRes = await fetch(`/api/invoices?programId=${programId}`);
    if (invRes.ok) {
      const invoices = await invRes.json();
      const allFlags: RedFlag[] = [];
      for (const inv of invoices) {
        const detailRes = await fetch(`/api/invoices/${inv.id}`);
        if (detailRes.ok) {
          const detail = await detailRes.json();
          for (const li of detail.lineItems ?? []) {
            if (li.flag !== "NONE") {
              allFlags.push({ ...li, invoice: { invoiceNumber: inv.invoiceNumber, id: inv.id } });
            }
          }
        }
      }
      setFlags(allFlags);
    }
    setLoading(false);
  }, [programId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="flex items-center gap-3 text-sm text-muted">
        <svg className="h-5 w-5 animate-spin text-accent" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
        Loading cockpit...
      </div>
    </div>
  );
  if (!program) return <div className="py-8 text-sm text-red-500">Program not found</div>;

  const latestBaseline = program._count.baselines > 0 ? "Active" : "None";
  const pendingChanges = program._count.changes;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted">Program Cockpit</p>
          <h1 className="mt-0.5 text-2xl font-bold text-zinc-900">{program.name}</h1>
          <p className="mt-1 text-sm text-muted">{program.cdmoName} {program.molecule ? `· ${program.molecule}` : ""} {program.modality ? `· ${program.modality}` : ""}</p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={program.status} />
          <span className="rounded-lg bg-accent-light px-3 py-1.5 text-xs font-semibold text-accent-text">
            Sponsor Owner
          </span>
        </div>
      </div>

      {/* Metric cards — styled like demo */}
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Link href={`/programs/${programId}/baseline`} className="card card-hover">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">Truth Status</p>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-50">
              <svg className="h-4 w-4 text-purple-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
            </div>
          </div>
          <p className="mt-2 text-2xl font-bold text-zinc-900">{latestBaseline}</p>
          <p className="mt-1 text-xs text-muted">{program._count.baselines} baseline{program._count.baselines !== 1 ? "s" : ""} total</p>
        </Link>

        <Link href={`/programs/${programId}/timeline`} className="card card-hover">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">Timeline</p>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50">
              <svg className="h-4 w-4 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
            </div>
          </div>
          <p className="mt-2 text-2xl font-bold text-zinc-900">{program._count.commitmentTerms}</p>
          <p className="mt-1 text-xs text-muted">commitment terms</p>
        </Link>

        <Link href={`/programs/${programId}/changes`} className="card card-hover">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">Change Velocity</p>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50">
              <svg className="h-4 w-4 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" /></svg>
            </div>
          </div>
          <p className="mt-2 text-2xl font-bold text-zinc-900">{pendingChanges}</p>
          <p className="mt-1 text-xs text-muted">total change events</p>
        </Link>

        <Link href={`/programs/${programId}/invoices`} className="card card-hover">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">Invoice Health</p>
            <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${flags.length > 0 ? "bg-red-50" : "bg-green-50"}`}>
              <svg className={`h-4 w-4 ${flags.length > 0 ? "text-red-500" : "text-green-500"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
            </div>
          </div>
          <p className={`mt-2 text-2xl font-bold ${flags.length > 0 ? "text-red-600" : "text-zinc-900"}`}>
            {flags.length > 0 ? `${flags.length} Flagged` : `${program._count.invoices} Clean`}
          </p>
          <p className="mt-1 text-xs text-muted">{program._count.invoices} invoice{program._count.invoices !== 1 ? "s" : ""} total</p>
        </Link>
      </div>

      {/* Two-column: Details + Red Flags */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Program details card */}
        <div className="card">
          <h2 className="text-sm font-semibold text-zinc-900">Program Details</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted">CDMO</dt>
              <dd className="font-medium text-zinc-900">{program.cdmoName}</dd>
            </div>
            <div className="flex justify-between border-t border-card-border pt-3">
              <dt className="text-muted">Currency</dt>
              <dd className="font-medium text-zinc-900">{program.currency}</dd>
            </div>
            <div className="flex justify-between border-t border-card-border pt-3">
              <dt className="text-muted">Auto-log Threshold</dt>
              <dd className="font-medium text-zinc-900">
                {program.changeThreshold ? `${program.currency} ${Number(program.changeThreshold).toLocaleString()}` : "Not set"}
              </dd>
            </div>
            <div className="flex justify-between border-t border-card-border pt-3">
              <dt className="text-muted">Activated</dt>
              <dd className="font-medium text-zinc-900">
                {program.activatedAt ? new Date(program.activatedAt).toLocaleDateString() : "Not yet"}
              </dd>
            </div>
          </dl>
        </div>

        {/* Red Flags */}
        <div className="card">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-900">Red Flags</h2>
            {flags.length > 0 && (
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-100 text-xs font-bold text-red-600">{flags.length}</span>
            )}
          </div>
          {flags.length === 0 ? (
            <div className="mt-6 flex flex-col items-center py-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-50">
                <svg className="h-5 w-5 text-green-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
              </div>
              <p className="mt-2 text-sm text-muted">No red flags - all clear</p>
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              {flags.slice(0, 5).map((f) => (
                <div key={f.id} className="flex items-start gap-3 rounded-lg border border-red-100 bg-red-50/50 p-3">
                  <StatusBadge status={f.flag} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-zinc-900">{f.description}</p>
                    {f.flagNote && <p className="mt-0.5 text-xs text-red-600">{f.flagNote}</p>}
                    <p className="mt-1 text-xs text-muted">
                      Invoice: {f.invoice.invoiceNumber ?? "N/A"} · ${Number(f.amount).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
              {flags.length > 5 && (
                <Link href={`/programs/${programId}/invoices`} className="block text-center text-xs font-medium text-accent hover:text-accent-text">
                  View all {flags.length} flags
                </Link>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Quick links */}
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { href: `/programs/${programId}/baseline`, label: "Assumption Locker", icon: "M3 11h18v11H3zM7 11V7a5 5 0 0110 0v4", color: "bg-purple-50 text-purple-500" },
          { href: `/programs/${programId}/evidence`, label: "Evidence Log", icon: "M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z", color: "bg-blue-50 text-blue-500" },
          { href: `/programs/${programId}/exports`, label: "Export Center", icon: "M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3", color: "bg-emerald-50 text-emerald-500" },
          { href: `/programs/${programId}/timeline`, label: "Commitment Timeline", icon: "M12 2a10 10 0 100 20 10 10 0 000-20zM12 6v6l4 2", color: "bg-amber-50 text-amber-500" },
        ].map((item) => (
          <Link key={item.href} href={item.href} className="card card-hover flex items-center gap-3">
            <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${item.color}`}>
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={item.icon} /></svg>
            </div>
            <span className="text-sm font-medium text-zinc-700">{item.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
