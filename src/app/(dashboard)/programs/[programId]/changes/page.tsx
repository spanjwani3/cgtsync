"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import StatusBadge from "@/components/ui/StatusBadge";
import { useSyncProgram } from "@/components/layout/useSyncProgram";
import IngestionModal from "@/components/changes/IngestionModal";
import ImpactCard from "@/components/changes/ImpactCard";
import ShadowConfirmModal from "@/components/changes/ShadowConfirmModal";

interface Change {
  id: string;
  sequenceNum: number;
  title: string;
  description: string | null;
  severity: string;
  status: string;
  estimatedImpact: string | null;
  reasonCode: string | null;
  scheduleImpactDays: number | null;
  confirmationMode: string | null;
  counterpartyNote: string | null;
  releasedAt: string | null;
  confirmedAt: string | null;
  createdAt: string;
  baseline?: { title: string; version: number } | null;
}

interface ProgramInfo {
  changeThreshold: string | null;
  currency: string;
}

const REASON_LABELS: Record<string, string> = {
  SPONSOR_REQUEST: "Sponsor Request",
  VENDOR_ERROR: "Vendor Error",
  MATERIAL_DELAY: "Material Delay",
  REGULATORY_REQUIREMENT: "Regulatory Requirement",
  OTHER: "Other",
};

export default function ChangesPage() {
  const { programId } = useParams<{ programId: string }>();
  const [changes, setChanges] = useState<Change[]>([]);
  const [programInfo, setProgramInfo] = useState<ProgramInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [showIngestion, setShowIngestion] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [selectedChange, setSelectedChange] = useState<Change | null>(null);
  const [shadowTarget, setShadowTarget] = useState<Change | null>(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    title: "",
    description: "",
    severity: "MEDIUM",
    estimatedImpact: "",
    scheduleImpact: "",
    reasonCode: "",
  });

  // Release gate: require reason code, cost impact, and schedule impact before releasing
  const [releaseGate, setReleaseGate] = useState<{ changeId: string; reasonCode: string; estimatedImpact: string; scheduleImpactDays: string } | null>(null);

  // Email confirmation modal
  const [emailTarget, setEmailTarget] = useState<Change | null>(null);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [confirmMessage, setConfirmMessage] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailSent, setEmailSent] = useState<string | null>(null);

  const impactKeyRef = useRef(0);

  useSyncProgram();

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

  useEffect(() => { loadChanges(); }, [loadChanges]);

  function refreshAll() {
    loadChanges();
    impactKeyRef.current += 1;
  }

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
        scheduleImpactDays: form.scheduleImpact ? parseInt(form.scheduleImpact) : undefined,
        reasonCode: form.reasonCode || undefined,
      }),
    });
    if (res.ok) {
      setForm({ title: "", description: "", severity: "MEDIUM", estimatedImpact: "", scheduleImpact: "", reasonCode: "" });
      setShowNew(false);
      refreshAll();
    } else {
      const data = await res.json();
      setError(data.error || "Failed");
    }
  }

  async function releaseChange(changeId: string) {
    const change = changes.find((c) => c.id === changeId);
    if (!change) return;

    // Gate: require reason code, cost impact, and schedule impact before releasing
    const missingReason = !change.reasonCode;
    const missingImpact = !change.estimatedImpact;
    const missingDays = change.scheduleImpactDays == null;
    if (missingReason || missingImpact || missingDays) {
      setReleaseGate({
        changeId,
        reasonCode: change.reasonCode ?? "",
        estimatedImpact: change.estimatedImpact ?? "",
        scheduleImpactDays: change.scheduleImpactDays?.toString() ?? "",
      });
      return;
    }

    await transitionChange(changeId, "RELEASED");
  }

  async function submitReleaseGate() {
    if (!releaseGate || !releaseGate.reasonCode || !releaseGate.estimatedImpact || !releaseGate.scheduleImpactDays) return;
    setError("");

    // First PATCH all required fields
    const patchRes = await fetch(`/api/changes/${releaseGate.changeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reasonCode: releaseGate.reasonCode,
        estimatedImpact: parseFloat(releaseGate.estimatedImpact),
        scheduleImpactDays: parseInt(releaseGate.scheduleImpactDays),
      }),
    });
    if (!patchRes.ok) {
      const d = await patchRes.json().catch(() => ({}));
      setError(d.error ?? "Failed to update change fields");
      return;
    }

    // Then transition to RELEASED
    const transRes = await fetch(`/api/changes/${releaseGate.changeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "RELEASED" }),
    });
    if (transRes.ok) {
      setReleaseGate(null);
      refreshAll();
      setSelectedChange(null);
    } else {
      const d = await transRes.json().catch(() => ({}));
      setError(d.error ?? "Release failed");
    }
  }

  async function transitionChange(changeId: string, status: string) {
    const res = await fetch(`/api/changes/${changeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      refreshAll();
      setSelectedChange(null);
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

  async function sendChangeConfirmationEmail(changeId: string) {
    if (!confirmEmail.trim()) return;
    setSendingEmail(true);
    setError("");
    try {
      const res = await fetch("/api/gateway/confirmation/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          programId,
          entityType: "CHANGE",
          entityId: changeId,
          recipientEmail: confirmEmail.trim(),
          message: confirmMessage.trim() || undefined,
        }),
      });
      if (res.ok) {
        setEmailSent(confirmEmail.trim());
        setConfirmEmail("");
        setConfirmMessage("");
      } else {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "Failed to send confirmation email");
      }
    } catch {
      setError("Failed to send confirmation email");
    }
    setSendingEmail(false);
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
        <button onClick={() => setShowIngestion(true)} className="btn-primary">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          Log Change Event
        </button>
      </div>

      {/* Impact card */}
      <div className="mt-4">
        <ImpactCard programId={programId} key={impactKeyRef.current} />
      </div>

      {/* Friction threshold banner */}
      {threshold !== null && (
        <div className="mt-4 flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5">
          <svg className="h-4 w-4 flex-shrink-0 text-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
          <p className="text-sm text-amber-800">
            <span className="font-semibold">Friction Threshold:</span>{" "}
            Changes under {programInfo?.currency} {threshold.toLocaleString()} are <span className="font-semibold text-green-700">auto-logged</span>.
            Changes above require <span className="font-semibold text-amber-700">bilateral confirmation</span>.
          </p>
        </div>
      )}

      {error && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {/* Manual draft form */}
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
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">Reason Code</label>
              <select value={form.reasonCode} onChange={(e) => setForm({ ...form, reasonCode: e.target.value })} className="input">
                <option value="">Select...</option>
                {Object.entries(REASON_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
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
          const impact = c.estimatedImpact ? Number(c.estimatedImpact) : null;
          const isAutoLogged = threshold !== null && impact !== null && impact < threshold;
          const needsConfirmation = threshold !== null && impact !== null && impact >= threshold;
          return (
            <div key={c.id} className="card card-hover">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <StatusBadge status={c.status} confirmationMode={c.confirmationMode} />
                  <span className="font-mono text-xs text-muted">#{c.sequenceNum}</span>
                  {c.status === "LOGGED" && isAutoLogged && (
                    <span className="rounded-md bg-green-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-green-600">Auto-logged</span>
                  )}
                  {c.reasonCode && (
                    <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500">
                      {REASON_LABELS[c.reasonCode] ?? c.reasonCode}
                    </span>
                  )}
                </div>
                <StatusBadge status={c.severity} />
              </div>

              <h3 className="mt-2 font-semibold text-zinc-900">{c.title}</h3>
              {c.description && <p className="mt-1 text-sm text-muted line-clamp-2">{c.description}</p>}
              {c.counterpartyNote && c.status === "COUNTERED" && (
                <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase text-amber-600">Counterparty Note</p>
                  <p className="mt-0.5 text-xs text-amber-800">{c.counterpartyNote}</p>
                </div>
              )}

              <div className="mt-3 flex items-center gap-4">
                {impact !== null && (
                  <div className="flex items-center gap-1.5">
                    <svg className="h-4 w-4 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" /></svg>
                    <span className={`text-sm font-semibold ${impact > 0 ? "text-red-600" : "text-green-600"}`}>
                      +${impact.toLocaleString()}
                    </span>
                  </div>
                )}
                {c.scheduleImpactDays != null && (
                  <span className="text-xs text-zinc-500">+{c.scheduleImpactDays} days</span>
                )}
                <div className="text-xs text-muted">
                  {new Date(c.createdAt).toLocaleDateString()}
                </div>
              </div>

              {/* Actions */}
              <div className="mt-3 flex items-center gap-2 border-t border-card-border pt-3">
                {c.status === "DRAFT" && (
                  isAutoLogged ? (
                    <button onClick={() => releaseChange(c.id)} className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-500">
                      Auto-Log
                    </button>
                  ) : needsConfirmation ? (
                    <button onClick={() => releaseChange(c.id)} className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-500">
                      Request Confirmation
                    </button>
                  ) : (
                    <button onClick={() => releaseChange(c.id)} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500">
                      Release
                    </button>
                  )
                )}
                {c.status === "RELEASED" && (
                  <>
                    <button onClick={() => { setEmailTarget(c); setEmailSent(null); }} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500">
                      Email for Confirmation
                    </button>
                    <button onClick={() => sendMagicLink(c.id)} className="text-xs font-medium text-accent hover:text-accent-text">
                      Copy Link
                    </button>
                    <button onClick={() => setShadowTarget(c)} className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-500">
                      Confirm with Evidence
                    </button>
                  </>
                )}
                {c.status === "COUNTERED" && (
                  <>
                    <button onClick={() => transitionChange(c.id, "RELEASED")} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500">
                      Re-release
                    </button>
                    <button onClick={() => sendMagicLink(c.id)} className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-500">
                      Send New Link
                    </button>
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
            <p className="mt-1 text-sm text-muted">Upload a meeting transcript, email, or change order to get started</p>
            <div className="mt-4 flex gap-2">
              <button onClick={() => setShowIngestion(true)} className="btn-primary">Log Change Event</button>
              <button onClick={() => setShowNew(true)} className="btn-secondary">Draft Manually</button>
            </div>
          </div>
        )}
      </div>

      {/* Detail modal */}
      {selectedChange && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => { setSelectedChange(null); setReleaseGate(null); }}>
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <StatusBadge status={selectedChange.status} confirmationMode={selectedChange.confirmationMode} />
                <span className="font-mono text-xs text-muted">#{selectedChange.sequenceNum}</span>
              </div>
              <button onClick={() => { setSelectedChange(null); setReleaseGate(null); }} className="text-muted hover:text-zinc-900">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <h3 className="mt-3 text-lg font-semibold text-zinc-900">{selectedChange.title}</h3>
            {selectedChange.description && <p className="mt-2 text-sm text-muted whitespace-pre-line">{selectedChange.description}</p>}
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
              {selectedChange.scheduleImpactDays != null && (
                <div className="rounded-lg bg-zinc-50 p-3">
                  <p className="text-xs text-muted">Schedule Impact</p>
                  <p className="mt-1 text-sm font-semibold text-zinc-900">+{selectedChange.scheduleImpactDays} days</p>
                </div>
              )}
              {selectedChange.reasonCode && (
                <div className="rounded-lg bg-zinc-50 p-3">
                  <p className="text-xs text-muted">Reason Code</p>
                  <p className="mt-1 text-sm font-semibold text-zinc-900">{REASON_LABELS[selectedChange.reasonCode] ?? selectedChange.reasonCode}</p>
                </div>
              )}
            </div>
            <div className="mt-4 rounded-lg bg-zinc-50 p-3">
              <p className="text-xs text-muted">Created</p>
              <p className="mt-1 text-sm font-medium text-zinc-900">{new Date(selectedChange.createdAt).toLocaleString()}</p>
            </div>

            {/* Counterparty note */}
            {selectedChange.counterpartyNote && (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs font-semibold text-amber-600 uppercase">Counterparty Note</p>
                <p className="mt-1 text-sm text-amber-800 whitespace-pre-line">{selectedChange.counterpartyNote}</p>
              </div>
            )}

            {/* Release gate: require Days + Dollars + Reason before releasing */}
            {releaseGate && releaseGate.changeId === selectedChange.id && (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-3">
                <p className="text-sm font-medium text-amber-800">Cost impact, schedule impact, and reason code are required before releasing.</p>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted">Cost Impact ($) *</label>
                    <input
                      type="number"
                      value={releaseGate.estimatedImpact}
                      onChange={(e) => setReleaseGate({ ...releaseGate, estimatedImpact: e.target.value })}
                      placeholder="e.g., 25000"
                      className="input"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted">Schedule Impact (days) *</label>
                    <input
                      type="number"
                      value={releaseGate.scheduleImpactDays}
                      onChange={(e) => setReleaseGate({ ...releaseGate, scheduleImpactDays: e.target.value })}
                      placeholder="e.g., 5"
                      className="input"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted">Reason Code *</label>
                    <select
                      value={releaseGate.reasonCode}
                      onChange={(e) => setReleaseGate({ ...releaseGate, reasonCode: e.target.value })}
                      className="input"
                    >
                      <option value="">Select reason...</option>
                      {Object.entries(REASON_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={submitReleaseGate} disabled={!releaseGate.reasonCode || !releaseGate.estimatedImpact || !releaseGate.scheduleImpactDays} className="btn-primary disabled:opacity-50">
                    Release
                  </button>
                  <button onClick={() => setReleaseGate(null)} className="btn-secondary">Cancel</button>
                </div>
              </div>
            )}

            <div className="mt-6 flex justify-end gap-2">
              {selectedChange.status === "DRAFT" && !releaseGate && (
                <button onClick={() => releaseChange(selectedChange.id)} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500">
                  Release
                </button>
              )}
              {selectedChange.status === "RELEASED" && (
                <>
                  <button onClick={() => { setEmailTarget(selectedChange); setEmailSent(null); setSelectedChange(null); }} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500">
                    Email for Confirmation
                  </button>
                  <button onClick={() => sendMagicLink(selectedChange.id)} className="text-sm font-medium text-accent hover:text-accent-text">
                    Copy Link
                  </button>
                  <button onClick={() => { setSelectedChange(null); setShadowTarget(selectedChange); }} className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500">
                    Confirm with Evidence
                  </button>
                </>
              )}
              {selectedChange.status === "COUNTERED" && (
                <>
                  <button onClick={() => { transitionChange(selectedChange.id, "RELEASED"); }} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500">
                    Re-release
                  </button>
                  <button onClick={() => sendMagicLink(selectedChange.id)} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500">
                    Send New Link
                  </button>
                </>
              )}
              <button onClick={() => { setSelectedChange(null); setReleaseGate(null); }} className="btn-secondary">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Email confirmation modal */}
      {emailTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => { setEmailTarget(null); setEmailSent(null); }}>
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-zinc-900">Email for Confirmation</h3>
            <p className="mt-2 text-sm text-muted">Send a confirmation email to your CDMO counterparty for this change order.</p>
            <div className="mt-4 rounded-lg bg-zinc-50 p-3">
              <p className="text-xs text-muted">Change #{emailTarget.sequenceNum}</p>
              <p className="font-medium text-zinc-900">{emailTarget.title}</p>
              <div className="mt-1 flex gap-3 text-xs text-muted">
                <span>{emailTarget.severity}</span>
                {emailTarget.estimatedImpact && <span>${Number(emailTarget.estimatedImpact).toLocaleString()}</span>}
              </div>
            </div>

            {emailSent ? (
              <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-3">
                <p className="text-sm font-medium text-green-800">Confirmation email sent to {emailSent}</p>
                <p className="mt-1 text-xs text-green-600">They will receive a link to review and approve or decline.</p>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                <div>
                  <label className="text-xs font-medium text-zinc-600">Recipient Email *</label>
                  <input
                    type="email"
                    value={confirmEmail}
                    onChange={(e) => setConfirmEmail(e.target.value)}
                    placeholder="counterparty@cdmo.com"
                    className="input mt-1 w-full"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-600">Message (optional)</label>
                  <textarea
                    value={confirmMessage}
                    onChange={(e) => setConfirmMessage(e.target.value)}
                    placeholder="Please review and confirm this change order..."
                    rows={2}
                    className="input mt-1 w-full resize-none"
                  />
                </div>
              </div>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => { setEmailTarget(null); setEmailSent(null); }} className="btn-secondary">
                {emailSent ? "Close" : "Cancel"}
              </button>
              {!emailSent && (
                <button
                  onClick={() => sendChangeConfirmationEmail(emailTarget.id)}
                  disabled={!confirmEmail.trim() || sendingEmail}
                  className="btn-primary disabled:opacity-50"
                >
                  {sendingEmail ? "Sending..." : "Send Email"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Ingestion modal */}
      {showIngestion && (
        <IngestionModal
          programId={programId}
          onDone={() => { setShowIngestion(false); refreshAll(); }}
          onClose={() => setShowIngestion(false)}
          onDraftManually={() => setShowNew(true)}
        />
      )}

      {/* Shadow confirmation modal */}
      {shadowTarget && (
        <ShadowConfirmModal
          changeId={shadowTarget.id}
          programId={programId}
          onConfirmed={() => { setShadowTarget(null); refreshAll(); }}
          onClose={() => setShadowTarget(null)}
        />
      )}
    </div>
  );
}
