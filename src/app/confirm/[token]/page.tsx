"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";

interface LinkData {
  id: string;
  scope: string;
  expiresAt: string;
  singleUse: boolean;
  confirmedAt: string | null;
}

const SEVERITY_COLORS: Record<string, string> = {
  LOW: "bg-green-50 text-green-700 border-green-200",
  MEDIUM: "bg-amber-50 text-amber-700 border-amber-200",
  HIGH: "bg-orange-100 text-orange-700 border-orange-200",
  CRITICAL: "bg-red-100 text-red-700 border-red-200",
};

const REASON_LABELS: Record<string, string> = {
  SPONSOR_REQUEST: "Sponsor Request",
  VENDOR_ERROR: "Vendor Error",
  MATERIAL_DELAY: "Material Delay",
  REGULATORY_REQUIREMENT: "Regulatory Requirement",
  OTHER: "Other",
};

const TYPE_COLORS: Record<string, string> = {
  PRICING: "bg-blue-50 text-blue-700 border-blue-200",
  TIMELINE: "bg-purple-50 text-purple-700 border-purple-200",
  SCOPE: "bg-teal-50 text-teal-700 border-teal-200",
  PAYMENT_TERMS: "bg-emerald-50 text-emerald-700 border-emerald-200",
  QUALITY: "bg-amber-50 text-amber-700 border-amber-200",
  REGULATORY: "bg-orange-50 text-orange-700 border-orange-200",
  IP: "bg-pink-50 text-pink-700 border-pink-200",
  OTHER: "bg-zinc-100 text-zinc-600 border-zinc-200",
};

const CATEGORY_MAP: Record<string, string> = {
  PRICING: "Deliverable", SCOPE: "Deliverable", TIMELINE: "Deliverable",
  QUALITY: "Assumption", REGULATORY: "Assumption",
  PAYMENT_TERMS: "Assumption", IP: "Exclusion",
  OTHER: "Deliverable",
};

function useCountdown(expiresAt: string | undefined) {
  const [timeLeft, setTimeLeft] = useState("");
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (!expiresAt) return;
    function tick() {
      const ms = new Date(expiresAt!).getTime() - Date.now();
      if (ms <= 0) {
        setTimeLeft("Expired");
        setExpired(true);
        return;
      }
      const h = Math.floor(ms / 3_600_000);
      const m = Math.floor((ms % 3_600_000) / 60_000);
      setTimeLeft(h > 0 ? `${h}h ${m}m remaining` : `${m}m remaining`);
      setExpired(false);
    }
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [expiresAt]);

  return { timeLeft, expired };
}

export default function ConfirmPage() {
  const { token } = useParams<{ token: string }>();
  const [link, setLink] = useState<LinkData | null>(null);
  const [entity, setEntity] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [countered, setCountered] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const { timeLeft, expired } = useCountdown(link?.expiresAt);

  useEffect(() => {
    async function load() {
      const res = await fetch(`/api/gateway/magic-link/${token}`);
      if (res.ok) {
        const data = await res.json();
        setLink(data.link);
        setEntity(data.entity);
        if (data.link?.confirmedAt) setConfirmed(true);
      } else {
        setError("This link is invalid, expired, or has already been used.");
      }
      setLoading(false);
    }
    load();
  }, [token]);

  async function handleConfirm() {
    setConfirming(true);
    const res = await fetch(`/api/gateway/magic-link/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "confirm", note: note.trim() || undefined }),
    });
    if (res.ok) {
      setConfirmed(true);
    } else {
      const data = await res.json();
      setError(data.error || "Confirmation failed");
    }
    setConfirming(false);
  }

  async function handleCounter() {
    if (!note.trim()) return;
    setConfirming(true);
    const res = await fetch(`/api/gateway/magic-link/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "counter", note: note.trim() }),
    });
    if (res.ok) {
      setCountered(true);
    } else {
      const data = await res.json();
      setError(data.error || "Counter submission failed");
    }
    setConfirming(false);
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50">
        <p className="text-sm text-zinc-500">Validating link...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50">
        <div className="w-full max-w-md rounded-lg border border-red-200 bg-white p-8 text-center">
          <h1 className="text-lg font-semibold text-red-700">Link Error</h1>
          <p className="mt-2 text-sm text-zinc-600">{error}</p>
        </div>
      </div>
    );
  }

  const isChangeScope = link?.scope === "CHANGE_CONFIRM";
  const isBaselineScope = link?.scope === "BASELINE_CONFIRM";
  const entityName = entity?.title as string ?? "Item";
  const program = entity?.program as Record<string, unknown> | undefined;
  const programName = program?.name as string ?? "";
  const cdmoName = program?.cdmoName as string ?? "";

  // Change-specific fields
  const sequenceNum = entity?.sequenceNum as number | undefined;
  const severity = entity?.severity as string | undefined;
  const estimatedImpact = entity?.estimatedImpact ? Number(entity.estimatedImpact) : null;
  const description = entity?.description as string | undefined;
  const scheduleImpactDays = entity?.scheduleImpactDays as number | undefined;
  const reasonCode = entity?.reasonCode as string | undefined;

  // Baseline-specific fields
  const clauses = (entity?.clauses as Array<Record<string, unknown>> | undefined) ?? [];
  const baselineVersion = entity?.version as number | undefined;

  const isDone = confirmed || countered;

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-4">
      <div className={`w-full ${isBaselineScope && clauses.length > 0 ? "max-w-2xl" : "max-w-lg"} rounded-lg border border-zinc-200 bg-white p-8 shadow-sm`}>
        {/* Header */}
        <div className="text-center">
          <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider">CGT-Sync</p>
          <h1 className="mt-2 text-xl font-semibold text-zinc-900">
            {isChangeScope ? "Change Order Confirmation" : "Baseline Confirmation"}
          </h1>
          {programName && (
            <p className="mt-1 text-sm text-zinc-500">
              {programName}{cdmoName ? ` — ${cdmoName}` : ""}
            </p>
          )}
        </div>

        {/* ═══ CHANGE ORDER DETAILS ═══ */}
        {isChangeScope && (
          <div className="mt-6 space-y-4">
            {/* Change Order Header */}
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-5">
              <div className="flex items-start justify-between">
                <div>
                  {sequenceNum && (
                    <p className="text-xs font-medium text-zinc-400 uppercase">Change Order #{sequenceNum}</p>
                  )}
                  <h2 className="mt-1 text-base font-semibold text-zinc-900">{entityName}</h2>
                </div>
                {severity && (
                  <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold ${SEVERITY_COLORS[severity] ?? "bg-zinc-100 text-zinc-600"}`}>
                    {severity}
                  </span>
                )}
              </div>

              {description && (
                <p className="mt-3 text-sm text-zinc-600 leading-relaxed">{description}</p>
              )}

              {reasonCode && (
                <p className="mt-2 text-xs text-zinc-500">
                  Reason: <span className="font-medium text-zinc-700">{REASON_LABELS[reasonCode] ?? reasonCode}</span>
                </p>
              )}
            </div>

            {/* Impact Cards */}
            {(estimatedImpact !== null || scheduleImpactDays != null) && (
              <div className="grid grid-cols-2 gap-3">
                {estimatedImpact !== null && (
                  <div className={`rounded-lg border-2 p-4 text-center ${estimatedImpact > 0 ? "border-red-200 bg-red-50" : "border-green-200 bg-green-50"}`}>
                    <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Cost Impact</p>
                    <p className={`mt-1 text-2xl font-bold ${estimatedImpact > 0 ? "text-red-600" : "text-green-600"}`}>
                      {estimatedImpact > 0 ? "+" : ""}${Math.abs(estimatedImpact).toLocaleString()}
                    </p>
                  </div>
                )}
                {scheduleImpactDays != null && (
                  <div className="rounded-lg border-2 border-amber-200 bg-amber-50 p-4 text-center">
                    <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Schedule Impact</p>
                    <p className="mt-1 text-2xl font-bold text-amber-700">
                      +{scheduleImpactDays} day{scheduleImpactDays !== 1 ? "s" : ""}
                    </p>
                  </div>
                )}
              </div>
            )}

            <div className="border-t border-zinc-200" />
          </div>
        )}

        {/* ═══ BASELINE CLAUSES — LINE-BY-LINE ═══ */}
        {isBaselineScope && clauses.length > 0 && (
          <div className="mt-6 space-y-4">
            {/* Baseline header */}
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3">
              <div className="flex items-center justify-between">
                <div>
                  {baselineVersion && (
                    <p className="text-xs font-medium text-zinc-400 uppercase">Baseline v{baselineVersion}</p>
                  )}
                  <h2 className="mt-0.5 text-base font-semibold text-zinc-900">{entityName}</h2>
                </div>
                <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700">
                  {clauses.length} items
                </span>
              </div>
            </div>

            {/* Summary counts */}
            {(() => {
              const deliverables = clauses.filter(c => {
                const cat = CATEGORY_MAP[c.type as string] ?? "Deliverable";
                return cat === "Deliverable";
              });
              const assumptions = clauses.filter(c => {
                const cat = CATEGORY_MAP[c.type as string] ?? "Deliverable";
                return cat === "Assumption";
              });
              const exclusions = clauses.filter(c => {
                const cat = CATEGORY_MAP[c.type as string] ?? "Deliverable";
                return cat === "Exclusion";
              });

              const groups = [
                { label: "Deliverables", items: deliverables },
                { label: "Assumptions", items: assumptions },
                { label: "Exclusions", items: exclusions },
              ].filter(g => g.items.length > 0);

              return (
                <div className="space-y-4">
                  {/* Summary bar */}
                  <div className="flex items-center gap-3 text-xs text-zinc-500">
                    {deliverables.length > 0 && <span>{deliverables.length} Deliverable{deliverables.length !== 1 ? "s" : ""}</span>}
                    {assumptions.length > 0 && <><span className="text-zinc-300">|</span><span>{assumptions.length} Assumption{assumptions.length !== 1 ? "s" : ""}</span></>}
                    {exclusions.length > 0 && <><span className="text-zinc-300">|</span><span>{exclusions.length} Exclusion{exclusions.length !== 1 ? "s" : ""}</span></>}
                  </div>

                  {/* Grouped clause cards */}
                  {groups.map(group => (
                    <div key={group.label}>
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">{group.label}</h3>
                      <div className="space-y-2">
                        {group.items.map((c, i) => (
                          <div key={i} className="rounded-lg border border-zinc-200 bg-white p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className={`inline-flex rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${TYPE_COLORS[c.type as string] ?? TYPE_COLORS.OTHER}`}>
                                    {c.type as string}
                                  </span>
                                  {c.clauseRef != null && (
                                    <span className="font-mono text-[10px] text-zinc-400">#{c.clauseRef as string}</span>
                                  )}
                                </div>
                                <h4 className="mt-1 text-sm font-medium text-zinc-900">{c.title as string}</h4>
                                {c.description != null && (
                                  <p className="mt-0.5 text-xs text-zinc-500 line-clamp-2">{c.description as string}</p>
                                )}
                              </div>
                              {c.value != null && (
                                <div className="flex-shrink-0 text-right">
                                  <p className="text-sm font-bold text-zinc-900">
                                    {Number(c.value).toLocaleString()}
                                  </p>
                                  {c.unit != null && (
                                    <p className="text-[10px] text-zinc-400">{c.unit as string}</p>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}

            <div className="border-t border-zinc-200" />
          </div>
        )}

        {/* Countdown timer */}
        {link && (
          <p className={`mt-3 text-center text-xs ${expired ? "font-medium text-red-600" : "text-zinc-400"}`}>
            {expired ? "This link has expired" : timeLeft}
            {link.singleUse && !expired && " · Single use"}
          </p>
        )}

        {/* Done states */}
        {confirmed && (
          <div className="mt-6 rounded-md border border-green-200 bg-green-50 p-4 text-center">
            <p className="text-sm font-medium text-green-700">Confirmed</p>
            <p className="mt-1 text-xs text-green-600">This action has been confirmed and recorded.</p>
          </div>
        )}

        {countered && (
          <div className="mt-6 rounded-md border border-amber-200 bg-amber-50 p-4 text-center">
            <p className="text-sm font-medium text-amber-700">Response Recorded</p>
            <p className="mt-1 text-xs text-amber-600">Your note has been sent to the sponsor for review.</p>
          </div>
        )}

        {/* Actions */}
        {!isDone && !expired && (
          <div className="mt-6 space-y-4">
            {/* Note textarea */}
            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1">
                Add a note (optional for confirm, required for counter)
              </label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={isChangeScope
                  ? "E.g., We agree to the cost but need more time for the schedule change..."
                  : "E.g., We agree to the terms. Section 3.2 pricing needs revision..."
                }
                className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                rows={3}
              />
            </div>

            {/* Action buttons */}
            <div className="flex gap-3">
              <button
                onClick={handleConfirm}
                disabled={confirming}
                className="flex h-11 flex-1 items-center justify-center rounded-md bg-green-600 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-50"
              >
                {confirming ? "Submitting..." : isChangeScope ? "Approve Change" : "Confirm Baseline"}
              </button>
              <button
                onClick={handleCounter}
                disabled={confirming || !note.trim()}
                className="flex h-11 flex-1 items-center justify-center rounded-md border-2 border-amber-500 bg-amber-50 text-sm font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                title={!note.trim() ? "Add a note to explain your counter" : undefined}
              >
                Counter
              </button>
            </div>
            {!note.trim() && (
              <p className="text-center text-[10px] text-zinc-400">
                To counter, add a note above explaining what needs to change
              </p>
            )}
          </div>
        )}

        {/* Expired state */}
        {!isDone && expired && (
          <div className="mt-6 rounded-md border border-red-200 bg-red-50 p-4 text-center">
            <p className="text-sm font-medium text-red-700">Link Expired</p>
            <p className="mt-1 text-xs text-red-600">This confirmation link has expired. Please contact the sponsor for a new link.</p>
          </div>
        )}
      </div>
    </div>
  );
}
