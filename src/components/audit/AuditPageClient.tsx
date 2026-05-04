"use client";

import { useState, useEffect, useCallback } from "react";
import AuditEventRow, { type AuditEntry } from "./AuditEventRow";

interface Member {
  id: string;
  email: string;
  fullName: string | null;
}

interface ProgramOption {
  id: string;
  name: string;
}

interface Props {
  members: Member[];
  programs: ProgramOption[];
}

const ACTION_GROUPS: Array<{ label: string; actions: string[] }> = [
  { label: "Auth", actions: ["USER_LOGIN", "USER_LOGOUT"] },
  { label: "Program", actions: ["PROGRAM_CREATED", "PROGRAM_UPDATED", "PROGRAM_ARCHIVED"] },
  {
    label: "Baseline",
    actions: [
      "BASELINE_CREATED",
      "BASELINE_RELEASED",
      "BASELINE_CONFIRMED",
      "BASELINE_COUNTERED",
      "BASELINE_LOCKED",
      "BASELINE_SUPERSEDED",
      "CLAUSE_CREATED",
      "CLAUSE_UPDATED",
      "CLAUSE_DELETED",
    ],
  },
  {
    label: "Change",
    actions: [
      "CHANGE_DRAFTED",
      "CHANGE_RELEASED",
      "CHANGE_CONFIRMED",
      "CHANGE_COUNTERED",
      "CHANGE_AUTO_LOGGED",
    ],
  },
  {
    label: "Invoice",
    actions: [
      "INVOICE_UPLOADED",
      "INVOICE_MAPPED",
      "INVOICE_FLAGGED",
      "INVOICE_APPROVED",
      "INVOICE_DISPUTED",
      "LINE_ITEM_FLAGGED",
    ],
  },
  { label: "Evidence", actions: ["EVIDENCE_UPLOADED", "EVIDENCE_FINALIZED", "EVIDENCE_BACKLOADED"] },
  {
    label: "Magic links",
    actions: ["MAGIC_LINK_CREATED", "MAGIC_LINK_VIEWED", "MAGIC_LINK_CONFIRMED", "MAGIC_LINK_EXPIRED"],
  },
  { label: "Export", actions: ["EXPORT_GENERATED"] },
  {
    label: "Email",
    actions: [
      "EMAIL_SENT",
      "EMAIL_DELIVERED",
      "EMAIL_OPENED",
      "EMAIL_BOUNCED",
      "EMAIL_FAILED",
      "DISPUTE_PACK_SENT",
      "PAYMENT_REMINDER_SENT",
    ],
  },
  {
    label: "Scope",
    actions: [
      "SCOPE_ANALYSIS_STARTED",
      "SCOPE_ANALYSIS_COMPLETED",
      "SCOPE_ALERT_CREATED",
      "SCOPE_ALERT_RESOLVED",
      "SCOPE_ALERT_CONVERTED",
    ],
  },
  {
    label: "Ingestion",
    actions: [
      "INGEST_EMAIL_RECEIVED",
      "INGEST_EMAIL_PROCESSED",
      "INGEST_EMAIL_FAILED",
      "INGEST_ADDRESS_CREATED",
      "INGEST_ADDRESS_DEACTIVATED",
    ],
  },
];

const PAGE_SIZE = 50;

export default function AuditPageClient({ members, programs }: Props) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [userId, setUserId] = useState("");
  const [action, setAction] = useState("");
  const [filterProgramId, setFilterProgramId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const buildQuery = useCallback(() => {
    const params = new URLSearchParams({ orgId: "self" });
    if (userId) params.set("userId", userId);
    if (action) params.set("action", action);
    if (filterProgramId) params.set("filterProgramId", filterProgramId);
    if (from) params.set("from", new Date(from).toISOString());
    if (to) {
      // include the entire 'to' day
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);
      params.set("to", end.toISOString());
    }
    return params;
  }, [userId, action, filterProgramId, from, to]);

  const fetchEntries = useCallback(
    async (newOffset: number) => {
      setLoading(true);
      try {
        const params = buildQuery();
        params.set("limit", String(PAGE_SIZE));
        params.set("offset", String(newOffset));
        const res = await fetch(`/api/gateway/audit?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          setEntries((prev) => (newOffset === 0 ? data.entries : [...prev, ...data.entries]));
          setTotal(data.total);
          setOffset(newOffset);
        }
      } catch {
        // surface nothing — empty state will render
      }
      setLoading(false);
    },
    [buildQuery],
  );

  useEffect(() => {
    fetchEntries(0);
  }, [fetchEntries]);

  async function handleExport() {
    setExporting(true);
    try {
      const params = buildQuery();
      params.set("format", "csv");
      const res = await fetch(`/api/gateway/audit?${params.toString()}`);
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `audit-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch {
      // ignore
    }
    setExporting(false);
  }

  function clearFilters() {
    setUserId("");
    setAction("");
    setFilterProgramId("");
    setFrom("");
    setTo("");
  }

  const hasFilters = userId || action || filterProgramId || from || to;

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="card">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-5">
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted">User</label>
            <select
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs"
            >
              <option value="">All users</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.fullName ? `${m.fullName} (${m.email})` : m.email}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted">Action</label>
            <select
              value={action}
              onChange={(e) => setAction(e.target.value)}
              className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs"
            >
              <option value="">All actions</option>
              {ACTION_GROUPS.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.actions.map((a) => (
                    <option key={a} value={a}>
                      {a.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted">Program</label>
            <select
              value={filterProgramId}
              onChange={(e) => setFilterProgramId(e.target.value)}
              className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs"
            >
              <option value="">All programs</option>
              {programs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted">From</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs"
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted">To</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs"
            />
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between">
          <div className="text-xs text-muted">
            {hasFilters ? (
              <button onClick={clearFilters} className="font-medium text-accent hover:underline">
                Clear filters
              </button>
            ) : (
              <span>No filters applied</span>
            )}
          </div>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-accent/90 disabled:opacity-50"
          >
            {exporting ? "Exporting…" : "Export CSV"}
          </button>
        </div>
      </div>

      {/* Results */}
      <div className="card p-0">
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">
            Events
          </p>
          <p className="text-xs text-muted">
            {loading && entries.length === 0
              ? "Loading…"
              : `${entries.length} of ${total.toLocaleString()}`}
          </p>
        </div>

        {entries.length === 0 && !loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-sm text-zinc-400">
            <svg className="mb-2 h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            No audit events match these filters
          </div>
        ) : (
          <div className="divide-y divide-zinc-100">
            {entries.map((entry) => (
              <AuditEventRow
                key={entry.id}
                entry={entry}
                showProgram={!filterProgramId}
                showFullTimestamp
              />
            ))}
          </div>
        )}

        {entries.length < total && (
          <div className="border-t border-zinc-200 px-5 py-3">
            <button
              onClick={() => fetchEntries(offset + PAGE_SIZE)}
              disabled={loading}
              className="w-full rounded-lg border border-zinc-200 py-2 text-xs font-medium text-zinc-500 hover:bg-zinc-50 disabled:opacity-50"
            >
              {loading ? "Loading…" : `Load more (${(total - entries.length).toLocaleString()} remaining)`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
