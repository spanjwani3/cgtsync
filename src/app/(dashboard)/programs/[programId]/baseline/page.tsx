"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
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

export default function BaselinePage() {
  const { programId } = useParams<{ programId: string }>();
  const [baselines, setBaselines] = useState<Baseline[]>([]);
  const [selected, setSelected] = useState<Baseline | null>(null);
  const [loading, setLoading] = useState(true);
  const [showNewBaseline, setShowNewBaseline] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [showAddClause, setShowAddClause] = useState(false);
  const [clauseForm, setClauseForm] = useState({
    clauseRef: "",
    type: "PRICING",
    title: "",
    description: "",
    value: "",
    unit: "",
  });
  const [error, setError] = useState("");

  useSyncProgram();

  const loadBaselines = useCallback(async () => {
    const res = await fetch(`/api/baselines?programId=${programId}`);
    if (res.ok) {
      const data = await res.json();
      setBaselines(data);
    }
    setLoading(false);
  }, [programId]);

  useEffect(() => {
    loadBaselines();
  }, [loadBaselines]);

  async function loadBaseline(id: string) {
    const res = await fetch(`/api/baselines/${id}`);
    if (res.ok) {
      setSelected(await res.json());
    }
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
      setClauseForm({ clauseRef: "", type: "PRICING", title: "", description: "", value: "", unit: "" });
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

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted">Baseline Truth</p>
          <h1 className="mt-0.5 text-2xl font-bold text-zinc-900">Assumption Locker</h1>
          <p className="mt-1 text-sm text-muted">Manage baselines from SOW/MSA documents</p>
        </div>
        <button onClick={() => setShowNewBaseline(true)} className="btn-primary">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          New Baseline
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {showNewBaseline && (
        <div className="mt-4 rounded-lg border border-card-border bg-card-bg p-4">
          <h3 className="text-sm font-medium text-zinc-900">Create New Baseline</h3>
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Baseline title (e.g., MSA v2.0 — Jan 2026)"
            className="mt-2 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none"
          />
          <div className="mt-3 flex gap-2">
            <button onClick={createBaseline} className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-800">Create</button>
            <button onClick={() => setShowNewBaseline(false)} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50">Cancel</button>
          </div>
        </div>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        {/* Baseline list */}
        <div className="space-y-2">
          {baselines.map((b) => (
            <button
              key={b.id}
              onClick={() => loadBaseline(b.id)}
              className={`w-full rounded-lg border p-3 text-left transition-all ${
                selected?.id === b.id ? "border-accent bg-accent-light/30 shadow-sm" : "border-card-border bg-card-bg hover:border-accent/40 hover:shadow-sm"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-zinc-900">v{b.version}: {b.title}</span>
                <StatusBadge status={b.status} />
              </div>
              <p className="mt-1 text-xs text-zinc-400">{b._count?.clauses ?? 0} clauses</p>
            </button>
          ))}
          {baselines.length === 0 && (
            <p className="text-sm text-zinc-400">No baselines yet. Create one to start.</p>
          )}
        </div>

        {/* Baseline detail */}
        {selected && (
          <div className="lg:col-span-2 rounded-lg border border-card-border bg-card-bg p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-medium text-zinc-900">v{selected.version}: {selected.title}</h2>
              <StatusBadge status={selected.status} />
            </div>

            {/* Status transition buttons */}
            <div className="mt-3 flex flex-wrap gap-2">
              {selected.status === "DRAFT" && (
                <button onClick={() => transitionStatus(selected.id, "RELEASED")} className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500">Release</button>
              )}
              {selected.status === "RELEASED" && (
                <>
                  <button onClick={() => transitionStatus(selected.id, "CONFIRMED")} className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-500">Confirm</button>
                  <button onClick={() => createMagicLink(selected.id)} className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50">Send Magic Link</button>
                </>
              )}
              {selected.status === "CONFIRMED" && (
                <button onClick={() => transitionStatus(selected.id, "LOCKED")} className="rounded-md bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-500">Lock Baseline</button>
              )}
              {selected.status === "LOCKED" && (
                <button onClick={() => transitionStatus(selected.id, "SUPERSEDED")} className="rounded-md border border-zinc-400 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50">Supersede</button>
              )}
            </div>

            {/* Clauses */}
            <div className="mt-6">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-zinc-700">Clauses</h3>
                {selected.status === "DRAFT" && (
                  <button onClick={() => setShowAddClause(true)} className="text-xs font-medium text-zinc-600 hover:text-zinc-900">+ Add Clause</button>
                )}
              </div>

              {showAddClause && selected.status === "DRAFT" && (
                <div className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 p-3 space-y-2">
                  <div className="grid grid-cols-3 gap-2">
                    <input placeholder="Clause ref (e.g., 3.1)" value={clauseForm.clauseRef} onChange={(e) => setClauseForm({ ...clauseForm, clauseRef: e.target.value })} className="rounded border border-zinc-300 px-2 py-1.5 text-sm" />
                    <select value={clauseForm.type} onChange={(e) => setClauseForm({ ...clauseForm, type: e.target.value })} className="rounded border border-zinc-300 px-2 py-1.5 text-sm">
                      {["PRICING", "TIMELINE", "SCOPE", "QUALITY", "REGULATORY", "PAYMENT_TERMS", "IP", "OTHER"].map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                    <input placeholder="Title *" value={clauseForm.title} onChange={(e) => setClauseForm({ ...clauseForm, title: e.target.value })} className="rounded border border-zinc-300 px-2 py-1.5 text-sm" />
                  </div>
                  <input placeholder="Description" value={clauseForm.description} onChange={(e) => setClauseForm({ ...clauseForm, description: e.target.value })} className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm" />
                  <div className="grid grid-cols-2 gap-2">
                    <input placeholder="Value (e.g., 150000)" type="number" value={clauseForm.value} onChange={(e) => setClauseForm({ ...clauseForm, value: e.target.value })} className="rounded border border-zinc-300 px-2 py-1.5 text-sm" />
                    <input placeholder="Unit (e.g., USD/batch)" value={clauseForm.unit} onChange={(e) => setClauseForm({ ...clauseForm, unit: e.target.value })} className="rounded border border-zinc-300 px-2 py-1.5 text-sm" />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={addClause} className="rounded bg-zinc-900 px-3 py-1.5 text-xs text-white hover:bg-zinc-800">Add</button>
                    <button onClick={() => setShowAddClause(false)} className="rounded border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700">Cancel</button>
                  </div>
                </div>
              )}

              <table className="mt-3 w-full">
                <thead>
                  <tr>
                    <th>Ref</th>
                    <th>Type</th>
                    <th>Title</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.clauses?.map((c) => (
                    <tr key={c.id}>
                      <td className="font-mono text-xs">{c.clauseRef ?? "—"}</td>
                      <td><StatusBadge status={c.type} /></td>
                      <td>
                        <span className="font-medium">{c.title}</span>
                        {c.description && <p className="text-xs text-zinc-400">{c.description}</p>}
                      </td>
                      <td className="text-right font-mono">
                        {c.value ? `${Number(c.value).toLocaleString()} ${c.unit ?? ""}` : "—"}
                      </td>
                    </tr>
                  ))}
                  {(!selected.clauses || selected.clauses.length === 0) && (
                    <tr><td colSpan={4} className="text-center text-sm text-zinc-400 py-4">No clauses added yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
