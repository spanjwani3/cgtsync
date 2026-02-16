"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import StatusBadge from "@/components/ui/StatusBadge";
import { useSyncProgram } from "@/components/layout/useSyncProgram";

interface Change {
  id: string;
  sequenceNum: number;
  title: string;
  description: string | null;
  severity: string;
  status: string;
  estimatedImpact: string | null;
  releasedAt: string | null;
  confirmedAt: string | null;
  createdAt: string;
  baseline?: { title: string; version: number } | null;
}

export default function ChangesPage() {
  const { programId } = useParams<{ programId: string }>();
  const [changes, setChanges] = useState<Change[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    title: "",
    description: "",
    severity: "MEDIUM",
    estimatedImpact: "",
  });

  useSyncProgram();

  const loadChanges = useCallback(async () => {
    const res = await fetch(`/api/changes?programId=${programId}`);
    if (res.ok) setChanges(await res.json());
    setLoading(false);
  }, [programId]);

  useEffect(() => {
    loadChanges();
  }, [loadChanges]);

  async function createChange() {
    if (!form.title) return;
    setError("");
    const res = await fetch("/api/changes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        programId,
        title: form.title,
        description: form.description || undefined,
        severity: form.severity,
        estimatedImpact: form.estimatedImpact ? parseFloat(form.estimatedImpact) : undefined,
      }),
    });
    if (res.ok) {
      setForm({ title: "", description: "", severity: "MEDIUM", estimatedImpact: "" });
      setShowNew(false);
      await loadChanges();
    } else {
      const data = await res.json();
      setError(data.error || "Failed");
    }
  }

  async function transitionChange(changeId: string, status: string) {
    const res = await fetch(`/api/changes/${changeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      await loadChanges();
    } else {
      const data = await res.json();
      setError(data.error || "Transition failed");
    }
  }

  async function sendMagicLink(changeId: string) {
    const res = await fetch("/api/gateway/magic-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "CHANGE_CONFIRM", entityId: changeId }),
    });
    if (res.ok) {
      const data = await res.json();
      await navigator.clipboard.writeText(data.url);
      alert(`Magic link copied!\n\n${data.url}`);
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="flex items-center gap-3 text-sm text-muted">
        <svg className="h-5 w-5 animate-spin text-accent" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
        Loading changes...
      </div>
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted">Change Events</p>
          <h1 className="mt-0.5 text-2xl font-bold text-zinc-900">Change Ledger</h1>
          <p className="mt-1 text-sm text-muted">One-Way Valve: changes are logged and confirmed</p>
        </div>
        <button onClick={() => setShowNew(true)} className="btn-primary">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          Draft Change
        </button>
      </div>

      {error && <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {showNew && (
        <div className="mt-4 rounded-lg border border-card-border bg-card-bg p-4 space-y-3">
          <h3 className="text-sm font-medium text-zinc-900">Draft New Change</h3>
          <input placeholder="Change title *" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm" />
          <textarea placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm" rows={2} />
          <div className="grid grid-cols-2 gap-3">
            <select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })} className="rounded-md border border-zinc-300 px-3 py-2 text-sm">
              {["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <input type="number" placeholder="Estimated impact ($)" value={form.estimatedImpact} onChange={(e) => setForm({ ...form, estimatedImpact: e.target.value })} className="rounded-md border border-zinc-300 px-3 py-2 text-sm" />
          </div>
          <div className="flex gap-2">
            <button onClick={createChange} className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-800">Create Draft</button>
            <button onClick={() => setShowNew(false)} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700">Cancel</button>
          </div>
        </div>
      )}

      <div className="mt-6">
        <table className="w-full">
          <thead>
            <tr>
              <th>#</th>
              <th>Change</th>
              <th>Severity</th>
              <th>Impact</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {changes.map((c) => (
              <tr key={c.id}>
                <td className="font-mono text-xs text-zinc-500">{c.sequenceNum}</td>
                <td>
                  <span className="font-medium text-zinc-900">{c.title}</span>
                  {c.description && <p className="text-xs text-zinc-400 mt-0.5">{c.description}</p>}
                </td>
                <td><StatusBadge status={c.severity} /></td>
                <td className="font-mono text-sm">
                  {c.estimatedImpact ? `$${Number(c.estimatedImpact).toLocaleString()}` : "—"}
                </td>
                <td><StatusBadge status={c.status} /></td>
                <td>
                  <div className="flex gap-1">
                    {c.status === "DRAFT" && (
                      <button onClick={() => transitionChange(c.id, "RELEASED")} className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-500">Release</button>
                    )}
                    {c.status === "RELEASED" && (
                      <>
                        <button onClick={() => transitionChange(c.id, "CONFIRMED")} className="rounded bg-green-600 px-2 py-1 text-xs text-white hover:bg-green-500">Confirm</button>
                        <button onClick={() => sendMagicLink(c.id)} className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-50">Magic Link</button>
                      </>
                    )}
                    {(c.status === "CONFIRMED" || c.status === "LOGGED") && (
                      <span className="text-xs text-zinc-400">Finalized</span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {changes.length === 0 && (
              <tr><td colSpan={6} className="py-8 text-center text-sm text-zinc-400">No changes recorded yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
