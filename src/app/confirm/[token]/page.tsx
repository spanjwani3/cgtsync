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

  const scopeLabel = link?.scope === "BASELINE_CONFIRM" ? "Baseline Confirmation" : "Change Confirmation";
  const isChangeScope = link?.scope === "CHANGE_CONFIRM";
  const entityName = entity?.title as string ?? "Item";
  const program = entity?.program as Record<string, unknown> | undefined;
  const programName = program?.name as string ?? "";
  const cdmoName = program?.cdmoName as string ?? "";

  // Change-specific fields
  const severity = entity?.severity as string | undefined;
  const estimatedImpact = entity?.estimatedImpact ? Number(entity.estimatedImpact) : null;
  const description = entity?.description as string | undefined;
  const scheduleImpactDays = entity?.scheduleImpactDays as number | undefined;
  const reasonCode = entity?.reasonCode as string | undefined;

  const isDone = confirmed || countered;

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-4">
      <div className="w-full max-w-lg rounded-lg border border-zinc-200 bg-white p-8 shadow-sm">
        {/* Header */}
        <div className="text-center">
          <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider">CGT-Sync</p>
          <h1 className="mt-2 text-xl font-semibold text-zinc-900">{scopeLabel}</h1>
          {programName && (
            <p className="mt-1 text-sm text-zinc-500">
              {programName}{cdmoName ? ` — ${cdmoName}` : ""}
            </p>
          )}
        </div>

        {/* Entity details */}
        <div className="mt-6 rounded-md border border-zinc-200 bg-zinc-50 p-4">
          <div className="flex items-start justify-between">
            <h2 className="text-sm font-medium text-zinc-900">{entityName}</h2>
            {severity && (
              <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${SEVERITY_COLORS[severity] ?? "bg-zinc-100 text-zinc-600"}`}>
                {severity}
              </span>
            )}
          </div>

          {/* Change-specific details */}
          {isChangeScope && (
            <div className="mt-3 space-y-3">
              {description && (
                <p className="text-sm text-zinc-600">{description}</p>
              )}

              <div className="grid grid-cols-2 gap-3">
                {estimatedImpact !== null && (
                  <div className="rounded-md bg-white border border-zinc-200 p-2.5">
                    <p className="text-[10px] font-medium text-zinc-400 uppercase">Estimated Impact</p>
                    <p className={`mt-0.5 text-lg font-bold ${estimatedImpact > 0 ? "text-red-600" : "text-green-600"}`}>
                      ${estimatedImpact.toLocaleString()}
                    </p>
                  </div>
                )}
                {scheduleImpactDays != null && (
                  <div className="rounded-md bg-white border border-zinc-200 p-2.5">
                    <p className="text-[10px] font-medium text-zinc-400 uppercase">Schedule Impact</p>
                    <p className="mt-0.5 text-lg font-bold text-zinc-900">+{scheduleImpactDays} days</p>
                  </div>
                )}
              </div>

              {reasonCode && (
                <p className="text-xs text-zinc-500">
                  Reason: <span className="font-medium text-zinc-700">{REASON_LABELS[reasonCode] ?? reasonCode}</span>
                </p>
              )}
            </div>
          )}

          {/* Baseline clauses */}
          {entity?.clauses ? (
            <div className="mt-3">
              <p className="text-xs font-medium text-zinc-500">Clauses:</p>
              <ul className="mt-1 space-y-1">
                {(entity.clauses as Array<Record<string, unknown>>).map((c, i) => (
                  <li key={i} className="text-xs text-zinc-600">
                    {c.clauseRef ? `${c.clauseRef}: ` : ""}{c.title as string}
                    {c.value ? ` — ${Number(c.value).toLocaleString()} ${c.unit ?? ""}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

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
                Add a note for the sponsor (optional for confirm, required for counter)
              </label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="E.g., We agree to the terms but suggest adjusting the timeline..."
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
                {confirming ? "Submitting..." : "Confirm"}
              </button>
              <button
                onClick={handleCounter}
                disabled={confirming || !note.trim()}
                className="flex h-11 flex-1 items-center justify-center rounded-md border-2 border-amber-500 bg-amber-50 text-sm font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
              >
                Counter
              </button>
            </div>
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
