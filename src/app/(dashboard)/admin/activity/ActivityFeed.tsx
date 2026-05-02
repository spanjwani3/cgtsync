"use client";

import { useEffect, useState, useCallback } from "react";
import AdminNav from "../AdminNav";

interface ActivityEvent {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  actor: { email: string; fullName: string | null } | null;
  program: { id: string; name: string } | null;
  tenant: { id: string; slug: string; name: string } | null;
}

interface TenantOption {
  id: string;
  name: string;
  slug: string;
}

interface ActivityResponse {
  events: ActivityEvent[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  tenants: TenantOption[];
}

const ACTION_GROUPS: Record<string, { label: string; color: string }> = {
  // Email in
  INGEST_EMAIL_RECEIVED: { label: "Email in: received", color: "bg-blue-100 text-blue-700" },
  INGEST_EMAIL_PROCESSED: { label: "Email in: processed", color: "bg-blue-100 text-blue-700" },
  INGEST_EMAIL_FAILED: { label: "Email in: failed", color: "bg-red-100 text-red-700" },
  INGEST_ADDRESS_CREATED: { label: "Ingest address created", color: "bg-blue-50 text-blue-600" },
  INGEST_ADDRESS_DEACTIVATED: { label: "Ingest address deactivated", color: "bg-zinc-100 text-zinc-600" },
  // Email out
  EMAIL_SENT: { label: "Email sent", color: "bg-violet-100 text-violet-700" },
  EMAIL_DELIVERED: { label: "Email delivered", color: "bg-violet-100 text-violet-700" },
  EMAIL_OPENED: { label: "Email opened", color: "bg-violet-100 text-violet-700" },
  EMAIL_BOUNCED: { label: "Email bounced", color: "bg-red-100 text-red-700" },
  EMAIL_FAILED: { label: "Email failed", color: "bg-red-100 text-red-700" },
  DISPUTE_PACK_SENT: { label: "Dispute pack sent", color: "bg-violet-100 text-violet-700" },
  PAYMENT_REMINDER_SENT: { label: "Payment reminder sent", color: "bg-violet-100 text-violet-700" },
  // Baseline lifecycle
  BASELINE_DRAFTED: { label: "Baseline drafted", color: "bg-emerald-100 text-emerald-700" },
  BASELINE_RELEASED: { label: "Baseline released", color: "bg-emerald-100 text-emerald-700" },
  BASELINE_CONFIRMED: { label: "Baseline confirmed", color: "bg-emerald-100 text-emerald-700" },
  BASELINE_LOCKED: { label: "Baseline locked", color: "bg-emerald-100 text-emerald-700" },
  BASELINE_COUNTERED: { label: "Baseline countered", color: "bg-amber-100 text-amber-700" },
  // Change lifecycle
  CHANGE_DRAFTED: { label: "Change drafted", color: "bg-cyan-100 text-cyan-700" },
  CHANGE_RELEASED: { label: "Change released", color: "bg-cyan-100 text-cyan-700" },
  CHANGE_CONFIRMED: { label: "Change confirmed", color: "bg-cyan-100 text-cyan-700" },
  CHANGE_LOGGED: { label: "Change logged", color: "bg-cyan-100 text-cyan-700" },
  CHANGE_COUNTERED: { label: "Change countered", color: "bg-amber-100 text-amber-700" },
  // Scope
  SCOPE_ANALYSIS_STARTED: { label: "Scope analysis started", color: "bg-orange-100 text-orange-700" },
  SCOPE_ANALYSIS_COMPLETED: { label: "Scope analysis complete", color: "bg-orange-100 text-orange-700" },
  SCOPE_ALERT_CREATED: { label: "Scope alert created", color: "bg-orange-100 text-orange-700" },
  SCOPE_ALERT_RESOLVED: { label: "Scope alert resolved", color: "bg-zinc-100 text-zinc-600" },
  SCOPE_ALERT_CONVERTED: { label: "Scope alert → CO", color: "bg-orange-100 text-orange-700" },
  // Evidence + extraction
  EVIDENCE_UPLOADED: { label: "Evidence uploaded", color: "bg-zinc-100 text-zinc-700" },
  EVIDENCE_BACKLOADED: { label: "Evidence backloaded", color: "bg-zinc-100 text-zinc-700" },
  EXTRACTION_JOB_CREATED: { label: "Extraction queued", color: "bg-zinc-100 text-zinc-600" },
  EXTRACTION_JOB_COMPLETED: { label: "Extraction complete", color: "bg-zinc-100 text-zinc-700" },
  // Other
  BULK_IMPORT: { label: "Bulk import", color: "bg-zinc-100 text-zinc-700" },
  INVOICE_RECONCILED: { label: "Invoice reconciled", color: "bg-cyan-100 text-cyan-700" },
};

function actionStyle(action: string) {
  return (
    ACTION_GROUPS[action] ?? {
      label: action,
      color: "bg-zinc-100 text-zinc-700",
    }
  );
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

function summarizeMetadata(action: string, metadata: Record<string, unknown> | null): string | null {
  if (!metadata) return null;
  // Pull a few useful fields without dumping the whole JSON
  const interesting: string[] = [];
  for (const k of [
    "detectedType",
    "alertCount",
    "candidateCount",
    "type",
    "fileName",
    "subject",
    "error",
    "stage",
    "dropped",
    "reason",
  ]) {
    const v = metadata[k];
    if (v !== undefined && v !== null) {
      const s = typeof v === "object" ? JSON.stringify(v) : String(v);
      if (s.length > 0 && s !== "false") {
        interesting.push(`${k}: ${s.length > 60 ? s.slice(0, 57) + "…" : s}`);
      }
    }
  }
  return interesting.length > 0 ? interesting.join(" · ") : null;
}

export default function ActivityFeed() {
  const [data, setData] = useState<ActivityResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tenantFilter, setTenantFilter] = useState<string>("");
  const [actionFilter, setActionFilter] = useState<string>("");
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (tenantFilter) params.set("orgId", tenantFilter);
      if (actionFilter) params.set("action", actionFilter);
      params.set("page", String(page));
      const res = await fetch(`/api/admin/activity?${params.toString()}`);
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
      } else {
        setData(body);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [tenantFilter, actionFilter, page]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <AdminNav active="activity" />

      <div className="mt-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Platform Activity</h1>
          <p className="mt-1 text-sm text-muted">
            Recent meaningful events across all tenants
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="btn-secondary text-xs disabled:opacity-50"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      <div className="mt-5 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Tenant
          </span>
          <select
            value={tenantFilter}
            onChange={(e) => {
              setTenantFilter(e.target.value);
              setPage(1);
            }}
            className="input mt-1 min-w-[200px]"
          >
            <option value="">All tenants</option>
            {data?.tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.slug})
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Event type
          </span>
          <select
            value={actionFilter}
            onChange={(e) => {
              setActionFilter(e.target.value);
              setPage(1);
            }}
            className="input mt-1 min-w-[220px]"
          >
            <option value="">All events</option>
            <optgroup label="Email in">
              <option value="INGEST_EMAIL_PROCESSED,INGEST_EMAIL_FAILED,INGEST_EMAIL_RECEIVED">
                All inbound email events
              </option>
              <option value="INGEST_EMAIL_FAILED">Inbound failures only</option>
            </optgroup>
            <optgroup label="Scope">
              <option value="SCOPE_ANALYSIS_COMPLETED,SCOPE_ALERT_CREATED,SCOPE_ALERT_CONVERTED,SCOPE_ALERT_RESOLVED">
                All scope events
              </option>
              <option value="SCOPE_ALERT_CREATED">New alerts</option>
              <option value="SCOPE_ALERT_CONVERTED">Alerts → COs</option>
            </optgroup>
            <optgroup label="Baseline">
              <option value="BASELINE_DRAFTED,BASELINE_RELEASED,BASELINE_CONFIRMED,BASELINE_LOCKED,BASELINE_COUNTERED">
                All baseline events
              </option>
              <option value="BASELINE_LOCKED">Baselines locked only</option>
            </optgroup>
            <optgroup label="Change orders">
              <option value="CHANGE_DRAFTED,CHANGE_RELEASED,CHANGE_CONFIRMED,CHANGE_LOGGED,CHANGE_COUNTERED">
                All change events
              </option>
            </optgroup>
            <optgroup label="Email out">
              <option value="EMAIL_SENT,EMAIL_DELIVERED,EMAIL_OPENED,EMAIL_BOUNCED,EMAIL_FAILED">
                All outbound email events
              </option>
            </optgroup>
            <optgroup label="Evidence">
              <option value="EVIDENCE_UPLOADED,EVIDENCE_BACKLOADED">
                All evidence events
              </option>
            </optgroup>
          </select>
        </label>

        {(tenantFilter || actionFilter) && (
          <button
            onClick={() => {
              setTenantFilter("");
              setActionFilter("");
              setPage(1);
            }}
            className="btn-secondary text-xs"
          >
            Clear filters
          </button>
        )}

        {data && (
          <span className="ml-auto text-xs text-muted">
            {data.total.toLocaleString()} event{data.total === 1 ? "" : "s"}
            {(tenantFilter || actionFilter) && " matching filter"}
          </span>
        )}
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mt-6 overflow-hidden rounded-lg border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50/60 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-2 font-medium">When</th>
              <th className="px-4 py-2 font-medium">Tenant</th>
              <th className="px-4 py-2 font-medium">Event</th>
              <th className="px-4 py-2 font-medium">Actor / Context</th>
            </tr>
          </thead>
          <tbody>
            {data?.events.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-12 text-center text-sm text-muted">
                  No events match the current filters.
                </td>
              </tr>
            )}
            {data?.events.map((ev) => {
              const style = actionStyle(ev.action);
              const summary = summarizeMetadata(ev.action, ev.metadata);
              return (
                <tr
                  key={ev.id}
                  className="border-b border-zinc-100 last:border-b-0 hover:bg-zinc-50/40"
                >
                  <td className="whitespace-nowrap px-4 py-3 align-top text-xs text-muted">
                    <div>{relativeTime(ev.createdAt)}</div>
                    <div className="mt-0.5 text-[10px] text-zinc-400">
                      {new Date(ev.createdAt).toLocaleString()}
                    </div>
                  </td>
                  <td className="px-4 py-3 align-top">
                    {ev.tenant ? (
                      <>
                        <div className="font-medium text-zinc-900">
                          {ev.tenant.name}
                        </div>
                        <div className="text-xs text-muted font-mono">
                          {ev.tenant.slug}
                        </div>
                      </>
                    ) : (
                      <span className="text-xs text-zinc-400">
                        (platform-level)
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <span
                      className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${style.color}`}
                    >
                      {style.label}
                    </span>
                    {ev.program && (
                      <div className="mt-1 text-xs text-muted">
                        {ev.program.name}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top text-xs">
                    {ev.actor && (
                      <div className="text-zinc-700">
                        {ev.actor.fullName || ev.actor.email}
                      </div>
                    )}
                    {summary && (
                      <div className="mt-0.5 text-muted">{summary}</div>
                    )}
                    {!ev.actor && !summary && (
                      <span className="text-zinc-400">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between text-xs text-muted">
        <span>
          {data && (
            <>
              Page {data.page} · showing{" "}
              {data.events.length === 0
                ? 0
                : (data.page - 1) * data.pageSize + 1}
              –{(data.page - 1) * data.pageSize + data.events.length} of{" "}
              {data.total.toLocaleString()}
            </>
          )}
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1 || loading}
            className="btn-secondary text-xs disabled:opacity-50"
          >
            Previous
          </button>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={!data?.hasMore || loading}
            className="btn-secondary text-xs disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
