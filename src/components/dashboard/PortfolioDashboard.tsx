"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import StatusBadge from "@/components/ui/StatusBadge";

interface ProgramRow {
  id: string;
  name: string;
  cdmoName: string;
  molecule: string | null;
  status: string;
  assignedPm: { id: string; fullName: string | null; email: string } | null;
  _count: { baselines: number; changes: number; invoices: number };
  invoiced: number;
  outstanding: number;
  flagged: number;
  lastActivity: string | null;
  daysSinceActivity: number | null;
}

interface Totals {
  totalInvoiced: number;
  totalOutstanding: number;
  totalFlagged: number;
  programCount: number;
}

interface OrgMember {
  id: string;
  fullName: string | null;
  email: string;
}

interface PortfolioDashboardProps {
  readOnly?: boolean;
}

type SortKey = "name" | "invoiced" | "outstanding" | "flagged" | "daysSinceActivity";

export default function PortfolioDashboard({ readOnly }: PortfolioDashboardProps) {
  const [programs, setPrograms] = useState<ProgramRow[]>([]);
  const [totals, setTotals] = useState<Totals>({ totalInvoiced: 0, totalOutstanding: 0, totalFlagged: 0, programCount: 0 });
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [filterPm, setFilterPm] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const url = filterPm ? `/api/dashboard/portfolio?assignedPmId=${filterPm}` : "/api/dashboard/portfolio";
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          setPrograms(data.programs);
          setTotals(data.totals);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [filterPm]);

  useEffect(() => {
    fetch("/api/org/members")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data?.members) setMembers(data.members); })
      .catch(() => {});
  }, []);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "name" ? "asc" : "desc"); }
  }

  const sorted = useMemo(() => {
    return [...programs].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") cmp = a.name.localeCompare(b.name);
      else if (sortKey === "invoiced") cmp = a.invoiced - b.invoiced;
      else if (sortKey === "outstanding") cmp = a.outstanding - b.outstanding;
      else if (sortKey === "flagged") cmp = a.flagged - b.flagged;
      else if (sortKey === "daysSinceActivity") cmp = (a.daysSinceActivity ?? 999) - (b.daysSinceActivity ?? 999);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [programs, sortKey, sortDir]);

  function fmtAmount(n: number) {
    if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `$${(n / 1000).toFixed(0)}k`;
    return `$${n.toLocaleString()}`;
  }

  function SortHeader({ label, field }: { label: string; field: SortKey }) {
    const active = sortKey === field;
    return (
      <th className="cursor-pointer select-none" onClick={() => toggleSort(field)}>
        <span className="inline-flex items-center gap-1">
          {label}
          {active && <span className="text-[10px]">{sortDir === "asc" ? "\u25B2" : "\u25BC"}</span>}
        </span>
      </th>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex items-center gap-3 text-sm text-muted">
          <svg className="h-5 w-5 animate-spin text-accent" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
          Loading portfolio...
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Summary metrics */}
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="card">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Programs</p>
          <p className="mt-2 text-2xl font-bold text-zinc-900">{totals.programCount}</p>
        </div>
        <div className="card">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Total Invoiced</p>
          <p className="mt-2 text-2xl font-bold text-zinc-900">{fmtAmount(totals.totalInvoiced)}</p>
        </div>
        <div className="card">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Outstanding</p>
          <p className={`mt-2 text-2xl font-bold ${totals.totalOutstanding > 0 ? "text-amber-600" : "text-zinc-900"}`}>{fmtAmount(totals.totalOutstanding)}</p>
        </div>
        <div className="card">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Flagged</p>
          <p className={`mt-2 text-2xl font-bold ${totals.totalFlagged > 0 ? "text-red-600" : "text-zinc-900"}`}>{totals.totalFlagged}</p>
        </div>
      </div>

      {/* Filter bar */}
      <div className="mt-6 flex items-center gap-3">
        {members.length > 1 && (
          <select
            value={filterPm}
            onChange={(e) => setFilterPm(e.target.value)}
            className="rounded-md border border-zinc-300 px-2 py-1.5 text-xs text-zinc-700"
          >
            <option value="">All PMs</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.fullName ?? m.email}</option>
            ))}
          </select>
        )}
      </div>

      {/* Table */}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <SortHeader label="Program" field="name" />
              <th>CDMO</th>
              <th>PM</th>
              <th>Status</th>
              <SortHeader label="Invoiced" field="invoiced" />
              <SortHeader label="Outstanding" field="outstanding" />
              <SortHeader label="Flagged" field="flagged" />
              <SortHeader label="Last Activity" field="daysSinceActivity" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => (
              <tr key={p.id} className="cursor-pointer hover:bg-zinc-50" onClick={() => window.location.href = `/programs/${p.id}/cockpit`}>
                <td>
                  <span className="font-medium text-zinc-900">{p.name}</span>
                  {p.molecule && <p className="text-xs text-muted">{p.molecule}</p>}
                </td>
                <td className="text-zinc-600">{p.cdmoName}</td>
                <td className="text-zinc-600">{p.assignedPm?.fullName ?? p.assignedPm?.email ?? "—"}</td>
                <td><StatusBadge status={p.status} /></td>
                <td className="text-right font-medium text-zinc-900">{fmtAmount(p.invoiced)}</td>
                <td className={`text-right font-medium ${p.outstanding > 0 ? "text-amber-600" : "text-zinc-600"}`}>{fmtAmount(p.outstanding)}</td>
                <td className={`text-right font-medium ${p.flagged > 0 ? "text-red-600" : "text-zinc-600"}`}>{p.flagged}</td>
                <td className="text-right text-zinc-500">
                  {p.daysSinceActivity !== null ? (
                    p.daysSinceActivity === 0 ? "Today" : `${p.daysSinceActivity}d ago`
                  ) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {programs.length === 0 && (
        <div className="mt-16 flex flex-col items-center">
          <p className="font-medium text-zinc-900">No programs found</p>
          <p className="mt-1 text-sm text-muted">{filterPm ? "Try changing the filter" : "Create your first program to get started"}</p>
        </div>
      )}
    </div>
  );
}
