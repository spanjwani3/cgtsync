"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import StatusBadge from "@/components/ui/StatusBadge";
import { useSyncProgram } from "@/components/layout/useSyncProgram";

interface Clause {
  id: string;
  clauseRef: string | null;
  type: string;
  title: string;
  description: string | null;
  value: string | null;
  unit: string | null;
  sortOrder: number;
}

interface Baseline {
  id: string;
  version: number;
  title: string;
  status: string;
  releasedAt: string | null;
  confirmedAt: string | null;
  lockedAt: string | null;
  createdAt: string;
  clauses: Clause[];
  _count?: { clauses: number };
}

/* Map clause types into demo categories */
const CATEGORY_MAP: Record<string, string> = {
  PRICING: "Deliverable",
  SCOPE: "Deliverable",
  TIMELINE: "Deliverable",
  QUALITY: "Assumption",
  REGULATORY: "Assumption",
  PAYMENT_TERMS: "Exclusion",
  IP: "Exclusion",
  OTHER: "Deliverable",
};

function getCategory(type: string) {
  return CATEGORY_MAP[type] ?? "Deliverable";
}

const TABS = ["All Items", "Deliverables", "Assumptions", "Exclusions"] as const;
type Tab = (typeof TABS)[number];
const TAB_CATEGORY: Record<Tab, string | null> = {
  "All Items": null,
  Deliverables: "Deliverable",
  Assumptions: "Assumption",
  Exclusions: "Exclusion",
};

export default function BaselinePage() {
  const { programId } = useParams<{ programId: string }>();
  const [baselines, setBaselines] = useState<Baseline[]>([]);
  const [selected, setSelected] = useState<Baseline | null>(null);
  const [loading, setLoading] = useState(true);
  const [showNewBaseline, setShowNewBaseline] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("All Items");
  const [showAddClause, setShowAddClause] = useState(false);
  const [clauseForm, setClauseForm] = useState({
    clauseRef: "",
    type: "SCOPE",
    title: "",
    description: "",
    value: "",
    unit: "",
  });
  const [error, setError] = useState("");
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  useSyncProgram();

  const loadBaselines = useCallback(async () => {
    const res = await fetch(`/api/baselines?programId=${programId}`);
    if (res.ok) setBaselines(await res.json());
    setLoading(false);
  }, [programId]);

  useEffect(() => { loadBaselines(); }, [loadBaselines]);

  async function loadBaseline(id: string) {
    const res = await fetch(`/api/baselines/${id}`);
    if (res.ok) setSelected(await res.json());
  }

  async function createBaseline() {
    if (!newTitle) return;
    setError("");
    const res = await fetch("/api/baselines", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ programId, title: newTitle }),
    });
    if (res.ok) {
      setNewTitle("");
      setShowNewBaseline(false);
      await loadBaselines();
    } else {
      const data = await res.json();
      setError(data.error || "Failed to create baseline");
    }
  }

  async function transitionStatus(baselineId: string, status: string) {
    const res = await fetch(`/api/baselines/${baselineId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      await loadBaseline(baselineId);
      await loadBaselines();
    } else {
      const data = await res.json();
      setError(data.error || "Transition failed");
    }
  }

  async function addClause() {
    if (!selected || !clauseForm.title || !clauseForm.type) return;
    const res = await fetch(`/api/baselines/${selected.id}/clauses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...clauseForm,
        value: clauseForm.value ? parseFloat(clauseForm.value) : undefined,
        clauseRef: clauseForm.clauseRef || undefined,
        description: clauseForm.description || undefined,
        unit: clauseForm.unit || undefined,
      }),
    });
    if (res.ok) {
      setShowAddClause(false);
      setClauseForm({ clauseRef: "", type: "SCOPE", title: "", description: "", value: "", unit: "" });
      await loadBaseline(selected.id);
    } else {
      const data = await res.json();
      setError(data.error || "Failed to add clause");
    }
  }

  async function createMagicLink(baselineId: string) {
    const res = await fetch("/api/gateway/magic-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "BASELINE_CONFIRM", entityId: baselineId }),
    });
    if (res.ok) {
      const data = await res.json();
      await navigator.clipboard.writeText(data.url);
      setShowConfirmModal(false);
      alert(`Magic link copied to clipboard!\n\n${data.url}\n\nExpires: ${new Date(data.expiresAt).toLocaleString()}`);
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="flex items-center gap-3 text-sm text-muted">
        <svg className="h-5 w-5 animate-spin text-accent" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
        Loading baselines...
      </div>
    </div>
  );

  /* Derive filtered/grouped clauses */
  const clauses = selected?.clauses ?? [];
  const catFilter = TAB_CATEGORY[activeTab];
  const filtered = catFilter ? clauses.filter((c) => getCategory(c.type) === catFilter) : clauses;

  const deliverableCount = clauses.filter((c) => getCategory(c.type) === "Deliverable").length;
  const assumptionCount = clauses.filter((c) => getCategory(c.type) === "Assumption").length;
  const exclusionCount = clauses.filter((c) => getCategory(c.type) === "Exclusion").length;

  const confirmedCount = 0; // placeholder — would come from clause-level status
  const pendingCount = clauses.length;

  /* Group clauses by category for "All Items" view */
  const grouped: { label: string; items: Clause[] }[] = [
    { label: `Deliverables (${deliverableCount})`, items: clauses.filter((c) => getCategory(c.type) === "Deliverable") },
    { label: `Assumptions (${assumptionCount})`, items: clauses.filter((c) => getCategory(c.type) === "Assumption") },
    { label: `Exclusions (${exclusionCount})`, items: clauses.filter((c) => getCategory(c.type) === "Exclusion") },
  ];

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted">Baseline Truth {selected ? `/ Active v${selected.version}` : ""}</p>
          <h1 className="mt-0.5 text-2xl font-bold text-zinc-900">Truth Table</h1>
        </div>
        <div className="flex items-center gap-2">
          {selected && selected.status === "RELEASED" && (
            <button onClick={() => setShowConfirmModal(true)} className="btn-primary">
              Send for Confirmation
            </button>
          )}
          <button onClick={() => setShowNewBaseline(true)} className="btn-secondary">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            New Baseline
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {/* New baseline form */}
      {showNewBaseline && (
        <div className="mt-4 card">
          <h3 className="text-sm font-semibold text-zinc-900">Create New Baseline</h3>
          <input type="text" value={newTitle} onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Baseline title (e.g., MSA v2.0 — Jan 2026)"
            className="input mt-2" />
          <div className="mt-3 flex gap-2">
            <button onClick={createBaseline} className="btn-primary">Create</button>
            <button onClick={() => setShowNewBaseline(false)} className="btn-secondary">Cancel</button>
          </div>
        </div>
      )}

      {/* Baseline selector + status card */}
      <div className="mt-6 grid gap-4 lg:grid-cols-4">
        {/* Baseline list */}
        <div className="space-y-2">
          {baselines.map((b) => (
            <button key={b.id} onClick={() => loadBaseline(b.id)}
              className={`w-full rounded-lg border p-3 text-left transition-all ${
                selected?.id === b.id ? "border-accent bg-accent-light/30 shadow-sm" : "border-card-border bg-card-bg hover:border-accent/40 hover:shadow-sm"
              }`}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-zinc-900">v{b.version}: {b.title}</span>
                <StatusBadge status={b.status} />
              </div>
              <p className="mt-1 text-xs text-zinc-400">{b._count?.clauses ?? 0} items</p>
            </button>
          ))}
          {baselines.length === 0 && (
            <div className="card text-center">
              <p className="text-sm text-muted">No baselines yet</p>
              <button onClick={() => setShowNewBaseline(true)} className="mt-2 text-xs font-medium text-accent hover:text-accent-text">Create one to start</button>
            </div>
          )}
        </div>

        {/* Main content */}
        {selected ? (
          <div className="lg:col-span-3 space-y-4">
            {/* Status summary card */}
            <div className="card flex items-center justify-between">
              <div className="flex items-center gap-4">
                <StatusBadge status={selected.status} />
                <div className="text-sm">
                  <span className="text-muted">Completion: </span>
                  <span className="font-semibold text-zinc-900">{confirmedCount}% Confirmed</span>
                  <span className="mx-2 text-card-border">|</span>
                  <span className="font-semibold text-amber-600">{pendingCount} Pending</span>
                </div>
              </div>
              <div className="flex gap-2">
                {selected.status === "DRAFT" && (
                  <button onClick={() => transitionStatus(selected.id, "RELEASED")} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500">Release</button>
                )}
                {selected.status === "RELEASED" && (
                  <button onClick={() => transitionStatus(selected.id, "CONFIRMED")} className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-500">Confirm</button>
                )}
                {selected.status === "CONFIRMED" && (
                  <button onClick={() => transitionStatus(selected.id, "LOCKED")} className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-500">Lock Baseline</button>
                )}
                {selected.status === "LOCKED" && (
                  <button onClick={() => transitionStatus(selected.id, "SUPERSEDED")} className="btn-secondary text-xs">Supersede</button>
                )}
              </div>
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-1 border-b border-card-border">
              {TABS.map((tab) => {
                const count = tab === "All Items" ? clauses.length
                  : tab === "Deliverables" ? deliverableCount
                  : tab === "Assumptions" ? assumptionCount
                  : exclusionCount;
                return (
                  <button key={tab} onClick={() => setActiveTab(tab)}
                    className={`px-4 py-2.5 text-sm font-medium transition-colors ${
                      activeTab === tab
                        ? "border-b-2 border-accent text-accent-text"
                        : "text-muted hover:text-zinc-900"
                    }`}>
                    {tab} <span className="ml-1 rounded-full bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600">{count}</span>
                  </button>
                );
              })}
            </div>

            {/* Toolbar */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                <input type="text" placeholder="Search truth items..." className="input pl-9" />
              </div>
              {selected.status === "DRAFT" && (
                <button onClick={() => setShowAddClause(true)} className="btn-primary">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                  Add Item
                </button>
              )}
            </div>

            {/* Add clause form */}
            {showAddClause && selected.status === "DRAFT" && (
              <div className="card space-y-3 border-accent/30 bg-accent-light/10">
                <h3 className="text-sm font-semibold text-zinc-900">Add Truth Item</h3>
                <div className="grid grid-cols-3 gap-3">
                  <input placeholder="Ref (e.g., 3.1)" value={clauseForm.clauseRef} onChange={(e) => setClauseForm({ ...clauseForm, clauseRef: e.target.value })} className="input" />
                  <select value={clauseForm.type} onChange={(e) => setClauseForm({ ...clauseForm, type: e.target.value })} className="input">
                    <optgroup label="Deliverables">
                      {["PRICING", "TIMELINE", "SCOPE"].map((t) => <option key={t} value={t}>{t}</option>)}
                    </optgroup>
                    <optgroup label="Assumptions">
                      {["QUALITY", "REGULATORY"].map((t) => <option key={t} value={t}>{t}</option>)}
                    </optgroup>
                    <optgroup label="Exclusions">
                      {["PAYMENT_TERMS", "IP"].map((t) => <option key={t} value={t}>{t}</option>)}
                    </optgroup>
                    <option value="OTHER">OTHER</option>
                  </select>
                  <input placeholder="Title *" value={clauseForm.title} onChange={(e) => setClauseForm({ ...clauseForm, title: e.target.value })} className="input" />
                </div>
                <input placeholder="Description" value={clauseForm.description} onChange={(e) => setClauseForm({ ...clauseForm, description: e.target.value })} className="input" />
                <div className="grid grid-cols-2 gap-3">
                  <input placeholder="Value (e.g., 150000)" type="number" value={clauseForm.value} onChange={(e) => setClauseForm({ ...clauseForm, value: e.target.value })} className="input" />
                  <input placeholder="Unit (e.g., USD/batch)" value={clauseForm.unit} onChange={(e) => setClauseForm({ ...clauseForm, unit: e.target.value })} className="input" />
                </div>
                <div className="flex gap-2">
                  <button onClick={addClause} className="btn-primary">Add Item</button>
                  <button onClick={() => setShowAddClause(false)} className="btn-secondary">Cancel</button>
                </div>
              </div>
            )}

            {/* Truth items — grouped view for All Items, flat for category tabs */}
            {activeTab === "All Items" ? (
              <div className="space-y-6">
                {grouped.map((group) => (
                  group.items.length > 0 && (
                    <div key={group.label}>
                      <h3 className="mb-3 text-sm font-semibold text-zinc-700">{group.label}</h3>
                      <div className="space-y-2">
                        {group.items.map((c, i) => (
                          <TruthItemCard key={c.id} clause={c} index={i} programId={programId} />
                        ))}
                      </div>
                    </div>
                  )
                ))}
                {clauses.length === 0 && (
                  <div className="card py-8 text-center">
                    <p className="text-sm text-muted">No truth items yet. Add items to build your baseline.</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {filtered.map((c, i) => (
                  <TruthItemCard key={c.id} clause={c} index={i} programId={programId} />
                ))}
                {filtered.length === 0 && (
                  <div className="card py-8 text-center">
                    <p className="text-sm text-muted">No {activeTab.toLowerCase()} in this baseline.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="lg:col-span-3 card flex flex-col items-center justify-center py-16">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-light">
              <svg className="h-7 w-7 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>
            </div>
            <p className="mt-4 font-medium text-zinc-900">Select a baseline</p>
            <p className="mt-1 text-sm text-muted">Choose a baseline from the left to view truth items</p>
          </div>
        )}
      </div>

      {/* Send for Confirmation modal */}
      {showConfirmModal && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowConfirmModal(false)}>
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-zinc-900">Send for Confirmation</h3>
            <p className="mt-2 text-sm text-muted">
              Generate a secure magic link for your CDMO counterparty to review and confirm this baseline.
            </p>
            <div className="mt-4 rounded-lg bg-zinc-50 p-3">
              <p className="text-xs text-muted">Baseline</p>
              <p className="font-medium text-zinc-900">v{selected.version}: {selected.title}</p>
              <p className="mt-1 text-xs text-muted">{selected.clauses?.length ?? 0} truth items</p>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setShowConfirmModal(false)} className="btn-secondary">Cancel</button>
              <button onClick={() => createMagicLink(selected.id)} className="btn-primary">Generate Magic Link</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ───── Truth Item Card ───── */

function TruthItemCard({ clause, index, programId }: { clause: Clause; index: number; programId: string }) {
  const category = getCategory(clause.type);
  const statusColor = "bg-amber-50 text-amber-700 border-amber-200"; // PROPOSED state

  return (
    <div className="card card-hover flex items-start gap-4">
      {/* Item number */}
      <span className="mt-0.5 flex-shrink-0 font-mono text-xs font-semibold text-muted">
        #{clause.clauseRef ?? `t${index + 1}`}
      </span>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`inline-flex rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase ${statusColor}`}>
            Proposed
          </span>
          <StatusBadge status={clause.type} />
        </div>
        <h4 className="mt-1.5 font-medium text-zinc-900">{clause.title}</h4>
        {clause.description && (
          <p className="mt-0.5 text-sm text-muted">{clause.description}</p>
        )}
        <div className="mt-2 flex items-center gap-3">
          {clause.value && (
            <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700">
              {Number(clause.value).toLocaleString()} {clause.unit ?? ""}
            </span>
          )}
          <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500">
            {category}
          </span>
          {/* Evidence badge */}
          <Link href={`/programs/${programId}/evidence`}
            className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600 hover:bg-blue-100">
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
            Evidence
          </Link>
        </div>
      </div>
    </div>
  );
}
