"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import StatusBadge from "@/components/ui/StatusBadge";
import { useSyncProgram } from "@/components/layout/useSyncProgram";
import { useExtractionPipeline } from "@/hooks/useExtractionPipeline";
import ExtractionProgress from "@/components/ui/ExtractionProgress";

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

interface ProgramInfo {
  changeThreshold: string | null;
  currency: string;
}

export default function ChangesPage() {
  const { programId } = useParams<{ programId: string }>();
  const [changes, setChanges] = useState<Change[]>([]);
  const [programInfo, setProgramInfo] = useState<ProgramInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [selectedChange, setSelectedChange] = useState<Change | null>(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    title: "",
    description: "",
    severity: "MEDIUM",
    estimatedImpact: "",
    scheduleImpact: "",
  });

  const fileRef = useRef<HTMLInputElement>(null);

  useSyncProgram();

  const loadChangesRef = useRef<() => Promise<void>>(undefined);

  const extraction = useExtractionPipeline({
    programId,
    evidenceType: "CHANGE_ORDER",
    targetType: "CHANGE_ORDER",
    prepareApplyBody: async () => ({}),
    onSuccess: async () => { await loadChangesRef.current?.(); },
    onError: (msg) => setError(msg),
  });

  const loadChanges = useCallback(async () => {
    const [changesRes, programRes] = await Promise.all([
      fetch(`/api/changes?programId=${programId}`),
      fetch(`/api/programs/${programId}`),
    ]);
    if (changesRes.ok) setChanges(await changesRes.json());
    if (programRes.ok) {
      const d = await programRes.json();
      const p = d.program ?? d;
      setProgramInfo({ changeThreshold: p.changeThreshold, currency: p.currency });
    }
    setLoading(false);
  }, [programId]);
  loadChangesRef.current = loadChanges;

  useEffect(() => { loadChanges(); }, [loadChanges]);

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
      setForm({ title: "", description: "", severity: "MEDIUM", estimatedImpact: "", scheduleImpact: "" });
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
    if (res.ok) { await loadChanges(); setSelectedChange(null); }
    else {
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

  const threshold = programInfo?.changeThreshold ? Number(programInfo.changeThreshold) : null;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted">Change Events</p>
          <h1 className="mt-0.5 text-2xl font-bold text-zinc-900">Change Ledger</h1>
          <p className="mt-1 text-sm text-muted">One-Way Valve: changes are logged and confirmed</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => fileRef.current?.click()} disabled={extraction.status !== "idle"} className="btn-primary disabled:opacity-50">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
            Upload Change Order
          </button>
          <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.txt" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) extraction.run(f); e.target.value = ""; }} />
          <button onClick={() => setShowNew(true)} className="btn-secondary">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Draft Change
          </button>
        </div>
      </div>

      {/* Friction threshold banner */}
      {threshold !== null && (
        <div className="mt-4 flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5">
          <svg className="h-4 w-4 flex-shrink-0 text-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
          <p className="text-sm text-amber-800">
            <span className="font-semibold">Friction Threshold:</span>{" "}
            Changes under {programInfo?.currency} {threshold.toLocaleString()} are <span className="font-semibold">auto-logged</span>.
            Changes above require bilateral confirmation.
          </p>
        </div>
      )}

      {error && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {/* Extraction progress */}
      <ExtractionProgress status={extraction.status} progress={extraction.progress} error={extraction.error} onDismissError={extraction.reset} />

      {/* New change form */}
      {showNew && (
        <div className="mt-4 card space-y-3">
          <h3 className="text-sm font-semibold text-zinc-900">Draft New Change</h3>
          <input placeholder="Change title *" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="input" />
          <textarea placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="input" rows={2} />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">Severity</label>
              <select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })} className="input">
                {["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">Cost Impact ($)</label>
              <input type="number" placeholder="e.g., 25000" value={form.estimatedImpact} onChange={(e) => setForm({ ...form, estimatedImpact: e.target.value })} className="input" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">Schedule Impact (days)</label>
              <input type="number" placeholder="e.g., 5" value={form.scheduleImpact} onChange={(e) => setForm({ ...form, scheduleImpact: e.target.value })} className="input" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={createChange} className="btn-primary">Create Draft</button>
            <button onClick={() => setShowNew(false)} className="btn-secondary">Cancel</button>
          </div>
        </div>
      )}

      {/* Change cards */}
      <div className="mt-6 space-y-3">
        {changes.map((c) => {
          const isAutoLogged = threshold !== null && c.estimatedImpact && Number(c.estimatedImpact) < threshold;
          return (
            <div key={c.id} className="card card-hover">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <StatusBadge status={c.status} />
                  <span className="font-mono text-xs text-muted">#{c.sequenceNum}</span>
                  {isAutoLogged && (
                    <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-zinc-500">Auto-logged</span>
                  )}
                </div>
                <StatusBadge status={c.severity} />
              </div>

              <h3 className="mt-2 font-semibold text-zinc-900">{c.title}</h3>
              {c.description && <p className="mt-1 text-sm text-muted">{c.description}</p>}

              <div className="mt-3 flex items-center gap-4">
                {c.estimatedImpact && (
                  <div className="flex items-center gap-1.5">
                    <svg className="h-4 w-4 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" /></svg>
                    <span className={`text-sm font-semibold ${Number(c.estimatedImpact) > 0 ? "text-red-600" : "text-green-600"}`}>
                      +${Number(c.estimatedImpact).toLocaleString()}
                    </span>
                    <span className="text-xs text-muted">cost impact</span>
                  </div>
                )}
                <div className="text-xs text-muted">
                  {new Date(c.createdAt).toLocaleDateString()}
                </div>
              </div>

              {/* Actions */}
              <div className="mt-3 flex items-center gap-2 border-t border-card-border pt-3">
                {c.status === "DRAFT" && (
                  <button onClick={() => transitionChange(c.id, "RELEASED")} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500">Release</button>
                )}
                {c.status === "RELEASED" && (
                  <>
                    <button onClick={() => transitionChange(c.id, "CONFIRMED")} className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-500">Confirm</button>
                    <button onClick={() => sendMagicLink(c.id)} className="btn-secondary text-xs">Send Magic Link</button>
                  </>
                )}
                {(c.status === "CONFIRMED" || c.status === "LOGGED") && (
                  <span className="flex items-center gap-1 text-xs text-green-600">
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
                    Finalized
                  </span>
                )}
                <button onClick={() => setSelectedChange(c)} className="ml-auto text-xs font-medium text-accent hover:text-accent-text">View Details</button>
              </div>
            </div>
          );
        })}

        {changes.length === 0 && (
          <div className="card flex flex-col items-center py-12">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-light">
              <svg className="h-6 w-6 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 01-9 9" /></svg>
            </div>
            <p className="mt-3 font-medium text-zinc-900">No changes recorded yet</p>
            <p className="mt-1 text-sm text-muted">Upload a change order document or draft one manually</p>
            <div className="mt-4 flex gap-2">
              <button onClick={() => fileRef.current?.click()} disabled={extraction.status !== "idle"} className="btn-primary disabled:opacity-50">Upload Change Order</button>
              <button onClick={() => setShowNew(true)} className="btn-secondary">Draft Manually</button>
            </div>
          </div>
        )}
      </div>

      {/* Detail modal */}
      {selectedChange && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setSelectedChange(null)}>
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <StatusBadge status={selectedChange.status} />
                <span className="font-mono text-xs text-muted">#{selectedChange.sequenceNum}</span>
              </div>
              <button onClick={() => setSelectedChange(null)} className="text-muted hover:text-zinc-900">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <h3 className="mt-3 text-lg font-semibold text-zinc-900">{selectedChange.title}</h3>
            {selectedChange.description && <p className="mt-2 text-sm text-muted">{selectedChange.description}</p>}
            <div className="mt-4 grid grid-cols-2 gap-4">
              <div className="rounded-lg bg-zinc-50 p-3">
                <p className="text-xs text-muted">Cost Impact</p>
                <p className="mt-1 text-lg font-bold text-zinc-900">
                  {selectedChange.estimatedImpact ? `+$${Number(selectedChange.estimatedImpact).toLocaleString()}` : "None"}
                </p>
              </div>
              <div className="rounded-lg bg-zinc-50 p-3">
                <p className="text-xs text-muted">Severity</p>
                <div className="mt-1"><StatusBadge status={selectedChange.severity} /></div>
              </div>
            </div>
            <div className="mt-4 rounded-lg bg-zinc-50 p-3">
              <p className="text-xs text-muted">Created</p>
              <p className="mt-1 text-sm font-medium text-zinc-900">{new Date(selectedChange.createdAt).toLocaleString()}</p>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              {selectedChange.status === "RELEASED" && (
                <>
                  <button onClick={() => transitionChange(selectedChange.id, "CONFIRMED")} className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500">Confirm</button>
                </>
              )}
              <button onClick={() => setSelectedChange(null)} className="btn-secondary">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
