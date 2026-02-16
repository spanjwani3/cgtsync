"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import { useSyncProgram } from "@/components/layout/useSyncProgram";
import { useExtractionPipeline } from "@/hooks/useExtractionPipeline";
import ExtractionProgress from "@/components/ui/ExtractionProgress";

const TERM_TYPES = [
  "RESERVATION_FEE",
  "COMMITMENT_DATE",
  "PAYMENT_MILESTONE",
  "CANCELLATION_WINDOW",
  "PENALTY_RULE",
  "MATERIAL_ORDER_TRIGGER",
] as const;

interface CommitmentTerm {
  id: string;
  programId: string;
  termType: string;
  label: string;
  dateOrOffset: string | null;
  deadlineAt: string | null;
  costOrPercent: string | null;
  conditions: string | null;
  excerpt: string | null;
  page: number | null;
  confidence: number | null;
  evidenceId: string | null;
  baselineId: string | null;
  sortOrder: number;
  createdAt: string;
  evidence?: { fileName: string } | null;
}

function daysUntil(deadline: string): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(deadline);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function deadlineColor(deadline: string | null, alertDays: number): string {
  if (!deadline) return "text-zinc-400";
  const days = daysUntil(deadline);
  if (days < 0) return "text-red-700";
  if (days <= alertDays) return "text-red-600";
  if (days <= alertDays * 2) return "text-amber-600";
  return "text-zinc-700";
}

function termTypeLabel(type: string): string {
  return type.replace(/_/g, " ");
}

function termTypeBadgeColor(type: string): string {
  switch (type) {
    case "RESERVATION_FEE": return "bg-purple-100 text-purple-700";
    case "COMMITMENT_DATE": return "bg-blue-100 text-blue-700";
    case "PAYMENT_MILESTONE": return "bg-green-100 text-green-700";
    case "CANCELLATION_WINDOW": return "bg-amber-100 text-amber-700";
    case "PENALTY_RULE": return "bg-red-100 text-red-700";
    case "MATERIAL_ORDER_TRIGGER": return "bg-orange-100 text-orange-700";
    default: return "bg-zinc-100 text-zinc-700";
  }
}

export default function TimelinePage() {
  const { programId } = useParams<{ programId: string }>();
  const [terms, setTerms] = useState<CommitmentTerm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [alertDays, setAlertDays] = useState(30);
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [formType, setFormType] = useState<string>("COMMITMENT_DATE");
  const [formLabel, setFormLabel] = useState("");
  const [formDate, setFormDate] = useState("");
  const [formOffset, setFormOffset] = useState("");
  const [formCost, setFormCost] = useState("");
  const [formConditions, setFormConditions] = useState("");
  const [saving, setSaving] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);

  useSyncProgram();

  const loadRef = useRef<() => Promise<void>>(undefined);

  const extraction = useExtractionPipeline({
    programId,
    evidenceType: "SOW_MSA",
    targetType: "TERMS",
    prepareApplyBody: async () => ({}),
    onSuccess: async () => { await loadRef.current?.(); },
    onError: (msg) => setError(msg),
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/commitment-terms?programId=${programId}`);
      if (res.ok) {
        const data = await res.json();
        setTerms(data.terms);
      }
    } catch {
      // silent
    }
    setLoading(false);
  }, [programId]);
  loadRef.current = load;

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/commitment-terms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          programId,
          termType: formType,
          label: formLabel,
          dateOrOffset: formDate || formOffset || null,
          deadlineAt: formDate || null,
          costOrPercent: formCost || null,
          conditions: formConditions || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create term");

      setFormLabel("");
      setFormDate("");
      setFormOffset("");
      setFormCost("");
      setFormConditions("");
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create term");
    } finally {
      setSaving(false);
    }
  }

  // Split terms by timeline position
  const now = new Date();
  const upcoming = terms.filter((t) => {
    if (!t.deadlineAt) return false;
    return new Date(t.deadlineAt) >= now;
  });
  const overdue = terms.filter((t) => {
    if (!t.deadlineAt) return false;
    return new Date(t.deadlineAt) < now;
  });
  const undated = terms.filter((t) => !t.deadlineAt);
  const alerts = terms.filter((t) => {
    if (!t.deadlineAt) return false;
    const days = daysUntil(t.deadlineAt);
    return days >= 0 && days <= alertDays;
  });

  if (loading) return <div className="py-8 text-sm text-zinc-500">Loading timeline...</div>;

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted">Timeline</p>
          <h1 className="text-2xl font-bold text-zinc-900">Commitment Timeline</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Track deadlines, obligations, and financial commitments
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-zinc-500">
            <label htmlFor="alertDays">Alert window:</label>
            <input
              id="alertDays"
              type="number"
              min={1}
              max={365}
              value={alertDays}
              onChange={(e) => setAlertDays(Math.max(1, parseInt(e.target.value) || 30))}
              className="w-16 rounded border border-zinc-300 px-2 py-1 text-xs"
            />
            <span>days</span>
          </div>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={extraction.status !== "idle"}
            className="btn-primary disabled:opacity-50"
          >
            Extract from Contract
          </button>
          <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.txt" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) extraction.run(f); e.target.value = ""; }} />
          <button
            onClick={() => setShowForm(!showForm)}
            className="btn-secondary"
          >
            {showForm ? "Cancel" : "Add Term"}
          </button>
        </div>
      </div>

      {error && <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {/* Extraction progress */}
      <ExtractionProgress status={extraction.status} progress={extraction.progress} error={extraction.error} onDismissError={extraction.reset} />

      {/* Manual create form */}
      {showForm && (
        <form onSubmit={handleCreate} className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1">Term Type</label>
              <select
                value={formType}
                onChange={(e) => setFormType(e.target.value)}
                className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
              >
                {TERM_TYPES.map((t) => (
                  <option key={t} value={t}>{termTypeLabel(t)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1">Label</label>
              <input
                type="text"
                value={formLabel}
                onChange={(e) => setFormLabel(e.target.value)}
                required
                placeholder="e.g. Batch 1 order confirmation deadline"
                className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1">Deadline Date</label>
              <input
                type="date"
                value={formDate}
                onChange={(e) => setFormDate(e.target.value)}
                className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1">Or Offset</label>
              <input
                type="text"
                value={formOffset}
                onChange={(e) => setFormOffset(e.target.value)}
                placeholder="e.g. +90 days from signing"
                className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1">Cost / Percent</label>
              <input
                type="text"
                value={formCost}
                onChange={(e) => setFormCost(e.target.value)}
                placeholder="e.g. $150,000 or 2% per week"
                className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">Conditions</label>
            <input
              type="text"
              value={formConditions}
              onChange={(e) => setFormConditions(e.target.value)}
              placeholder="e.g. If sponsor cancels after material order"
              className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving || !formLabel}
              className="btn-primary disabled:opacity-50"
            >
              {saving ? "Creating..." : "Create Term"}
            </button>
          </div>
        </form>
      )}

      {/* Red flag alerts */}
      {alerts.length > 0 && (
        <div className="mt-6">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-red-700">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" />
            Alerts — {alerts.length} term{alerts.length > 1 ? "s" : ""} within {alertDays} days
          </h2>
          <div className="mt-3 space-y-2">
            {alerts.map((t) => (
              <div key={t.id} className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-3">
                <span className={`mt-0.5 inline-block rounded px-2 py-0.5 text-xs font-medium ${termTypeBadgeColor(t.termType)}`}>
                  {termTypeLabel(t.termType)}
                </span>
                <div className="flex-1">
                  <p className="text-sm font-medium text-zinc-900">{t.label}</p>
                  <div className="mt-1 flex items-center gap-3 text-xs">
                    <span className="font-medium text-red-600">
                      {t.deadlineAt ? `${daysUntil(t.deadlineAt)} days left — ${new Date(t.deadlineAt).toLocaleDateString()}` : "-"}
                    </span>
                    {t.costOrPercent ? <span className="font-mono text-zinc-600">{t.costOrPercent}</span> : null}
                  </div>
                  {t.conditions ? <p className="mt-1 text-xs text-zinc-500">{t.conditions}</p> : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Overdue */}
      {overdue.length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm font-semibold text-red-800">Overdue ({overdue.length})</h2>
          <div className="mt-3">
            <TermTable terms={overdue} alertDays={alertDays} />
          </div>
        </div>
      )}

      {/* Upcoming */}
      <div className="mt-6">
        <h2 className="text-sm font-semibold text-zinc-700">Upcoming ({upcoming.length})</h2>
        {upcoming.length > 0 ? (
          <div className="mt-3">
            <TermTable terms={upcoming} alertDays={alertDays} />
          </div>
        ) : (
          <p className="mt-3 text-sm text-zinc-400">No upcoming terms with set deadlines.</p>
        )}
      </div>

      {/* Undated / relative offset */}
      {undated.length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm font-semibold text-zinc-500">Undated / Relative ({undated.length})</h2>
          <div className="mt-3">
            <TermTable terms={undated} alertDays={alertDays} />
          </div>
        </div>
      )}

      {terms.length === 0 && !showForm && (
        <div className="mt-8 text-center">
          <p className="text-sm text-zinc-400">No commitment terms yet.</p>
          <p className="mt-2 text-xs text-zinc-400">
            Upload a SOW or MSA to extract terms automatically, or add them manually.
          </p>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={extraction.status !== "idle"}
            className="btn-primary mt-3 disabled:opacity-50"
          >
            Extract from Contract
          </button>
        </div>
      )}
    </div>
  );
}

function TermTable({ terms, alertDays }: { terms: CommitmentTerm[]; alertDays: number }) {
  return (
    <table className="w-full">
      <thead>
        <tr className="text-left text-xs text-zinc-500">
          <th className="pb-2 font-medium">Type</th>
          <th className="pb-2 font-medium">Label</th>
          <th className="pb-2 font-medium">Deadline</th>
          <th className="pb-2 font-medium">Cost/Percent</th>
          <th className="pb-2 font-medium">Conditions</th>
          <th className="pb-2 font-medium">Source</th>
        </tr>
      </thead>
      <tbody>
        {terms.map((t) => (
          <tr key={t.id} className="border-t border-zinc-100">
            <td className="py-2">
              <span className={`rounded px-2 py-0.5 text-xs font-medium ${termTypeBadgeColor(t.termType)}`}>
                {termTypeLabel(t.termType)}
              </span>
            </td>
            <td className="py-2 text-sm text-zinc-900">{t.label}</td>
            <td className={`py-2 text-sm font-medium ${deadlineColor(t.deadlineAt, alertDays)}`}>
              {t.deadlineAt
                ? `${new Date(t.deadlineAt).toLocaleDateString()} (${daysUntil(t.deadlineAt)}d)`
                : t.dateOrOffset ?? "-"}
            </td>
            <td className="py-2 text-sm font-mono text-zinc-600">{t.costOrPercent ?? "-"}</td>
            <td className="py-2 text-xs text-zinc-500 max-w-[200px] truncate" title={t.conditions ?? ""}>
              {t.conditions ?? "-"}
            </td>
            <td className="py-2 text-xs text-zinc-400">
              {t.evidence?.fileName ?? (t.evidenceId ? "Evidence" : "Manual")}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
