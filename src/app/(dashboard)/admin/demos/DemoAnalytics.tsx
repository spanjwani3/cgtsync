"use client";

import { useEffect, useState } from "react";
import AdminNav from "../AdminNav";

interface DemoSummary {
  slug: string;
  title: string;
  uniqueLeads: number;
  totalViews: number;
  viewsLast7Days: number;
  avgWatchSeconds: number;
  completionRate: number;
}

interface LeadRow {
  id: string;
  email: string;
  name: string | null;
  company: string | null;
  demoSlug: string;
  demoTitle: string;
  capturedAt: string;
  viewCount: number;
  totalWatchedSeconds: number;
  furthestPct: number | null;
  completed: boolean;
  lastViewedAt: string | null;
}

interface DemosData {
  demos: DemoSummary[];
  leads: LeadRow[];
}

function fmtDuration(seconds: number): string {
  if (!seconds) return "0s";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export default function DemoAnalytics() {
  const [data, setData] = useState<DemosData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function fetchData() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/demos");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
  }, []);

  return (
    <div className="mx-auto max-w-5xl py-6">
      <AdminNav active="demos" />

      <div className="mt-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-zinc-900">Demo Video Analytics</h1>
        <button
          onClick={fetchData}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
        >
          Refresh
        </button>
      </div>

      {loading && <p className="mt-6 text-sm text-zinc-500">Loading…</p>}
      {error && (
        <div className="mt-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {data && !loading && (
        <>
          {/* Per-demo summary cards */}
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {data.demos.length === 0 && (
              <p className="text-sm text-zinc-500">No demo views captured yet.</p>
            )}
            {data.demos.map((d) => (
              <div key={d.slug} className="card">
                <h2 className="text-sm font-semibold text-zinc-900">{d.title}</h2>
                <p className="font-mono text-xs text-zinc-400">/demo/{d.slug}</p>
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <Stat label="Unique leads" value={String(d.uniqueLeads)} />
                  <Stat label="Total views" value={String(d.totalViews)} />
                  <Stat label="Views (7d)" value={String(d.viewsLast7Days)} />
                  <Stat label="Avg watch" value={fmtDuration(d.avgWatchSeconds)} />
                  <Stat label="Completion" value={`${d.completionRate}%`} />
                </div>
              </div>
            ))}
          </div>

          {/* Leads table */}
          <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Leads
          </h2>
          <div className="mt-3 overflow-x-auto rounded-lg border border-zinc-200">
            <table className="min-w-full divide-y divide-zinc-200 text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-2.5">Email</th>
                  <th className="px-4 py-2.5">Company</th>
                  <th className="px-4 py-2.5">Demo</th>
                  <th className="px-4 py-2.5">Views</th>
                  <th className="px-4 py-2.5">Watch time</th>
                  <th className="px-4 py-2.5">Furthest</th>
                  <th className="px-4 py-2.5">Last viewed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {data.leads.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-zinc-500">
                      No leads yet.
                    </td>
                  </tr>
                )}
                {data.leads.map((l) => (
                  <tr key={l.id} className="hover:bg-zinc-50">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-zinc-900">{l.email}</div>
                      {l.name && (
                        <div className="text-xs text-zinc-500">{l.name}</div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-zinc-700">
                      {l.company || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-zinc-700">{l.demoTitle}</td>
                    <td className="px-4 py-2.5 text-zinc-700">{l.viewCount}</td>
                    <td className="px-4 py-2.5 text-zinc-700">
                      {fmtDuration(l.totalWatchedSeconds)}
                    </td>
                    <td className="px-4 py-2.5">
                      {l.completed ? (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                          Completed
                        </span>
                      ) : (
                        <span className="text-zinc-700">
                          {l.furthestPct != null ? `${l.furthestPct}%` : "—"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-zinc-500">
                      {fmtDate(l.lastViewedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-lg font-semibold text-zinc-900">{value}</div>
      <div className="text-xs text-zinc-500">{label}</div>
    </div>
  );
}
