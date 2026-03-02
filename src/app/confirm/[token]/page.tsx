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
  const [sentBy, setSentBy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [countered, setCountered] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const { timeLeft, expired } = useCountdown(link?.expiresAt);

  // Dynamic page title
  useEffect(() => {
    if (loading) {
      document.title = "CGT-Sync \u2014 Validating...";
    } else if (error) {
      document.title = "CGT-Sync \u2014 Link Error";
    } else if (entity) {
      const program = entity.program as Record<string, unknown> | undefined;
      const programName = (program?.name as string) || "";
      const scope = link?.scope === "CHANGE_CONFIRM" ? "Confirm Change Order" : "Confirm Baseline";
      document.title = programName ? `${scope} \u2014 ${programName} \u2014 CGT-Sync` : `${scope} \u2014 CGT-Sync`;
    }
  }, [loading, error, entity, link?.scope]);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/gateway/magic-link/${token}`);
        if (res.ok) {
          const data = await res.json();
          setLink(data.link);
          setEntity(data.entity);
          setSentBy(data.sentBy ?? null);
          if (data.link?.confirmedAt) setConfirmed(true);
        } else if (res.status === 404) {
          setError("expired");
        } else {
          setError("server");
        }
      } catch {
        setError("server");
      }
      setLoading(false);
    }
    load();
  }, [token]);

  async function handleConfirm() {
    const label = link?.scope === "CHANGE_CONFIRM" ? "change order" : "baseline";
    if (!window.confirm(`Are you sure you want to confirm this ${label}? This action cannot be undone.`)) return;
    setConfirming(true);
    try {
      const res = await fetch(`/api/gateway/magic-link/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm", note: note.trim() || undefined }),
      });
      if (res.ok) {
        setConfirmed(true);
      } else {
        try {
          const data = await res.json();
          setError(data.error || "Confirmation failed. Please try again.");
        } catch {
          setError("Confirmation failed. Please try again.");
        }
      }
    } catch {
      setError("Network error. Please check your connection and try again.");
    }
    setConfirming(false);
  }

  async function handleCounter() {
    if (!note.trim()) return;
    if (!window.confirm("Submit your counter response? The sponsor will be notified.")) return;
    setConfirming(true);
    try {
      const res = await fetch(`/api/gateway/magic-link/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "counter", note: note.trim() }),
      });
      if (res.ok) {
        setCountered(true);
      } else {
        try {
          const data = await res.json();
          setError(data.error || "Counter submission failed. Please try again.");
        } catch {
          setError("Counter submission failed. Please try again.");
        }
      }
    } catch {
      setError("Network error. Please check your connection and try again.");
    }
    setConfirming(false);
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex items-center gap-3 text-sm text-muted">
          <svg className="h-5 w-5 animate-spin text-accent" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Validating link...
        </div>
      </div>
    );
  }

  if (error) {
    const isExpiredError = error === "expired";
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="card w-full max-w-md p-8 text-center">
          <div className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full ${isExpiredError ? "bg-amber-50" : "bg-red-50"}`}>
            <svg className={`h-6 w-6 ${isExpiredError ? "text-warning" : "text-danger"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {isExpiredError ? (
                <><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></>
              ) : (
                <><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></>
              )}
            </svg>
          </div>
          <h1 className={`mt-4 text-lg font-semibold ${isExpiredError ? "text-amber-700" : "text-danger"}`}>
            {isExpiredError ? "Link Expired or Already Used" : "Something Went Wrong"}
          </h1>
          <p className="mt-2 text-sm text-muted">
            {isExpiredError
              ? "This confirmation link is no longer valid. It may have expired or already been used."
              : "We couldn\u2019t load this confirmation page. This is usually temporary."
            }
          </p>
          <div className="mt-6 space-y-3">
            {!isExpiredError && (
              <button
                onClick={() => window.location.reload()}
                className="btn-primary w-full h-10"
              >
                Try Again
              </button>
            )}
            <p className="text-xs text-muted">
              {isExpiredError
                ? "Please contact the person who sent you this link to request a new one."
                : "If this persists, contact the person who sent you this link."
              }
            </p>
          </div>
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
  const releasedAt = entity?.releasedAt as string | undefined;
  const entityStatus = entity?.status as string | undefined;

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
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className={`card w-full ${isBaselineScope && clauses.length > 0 ? "max-w-2xl" : "max-w-lg"} p-8 shadow-sm`}>
        {/* Header */}
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10">
            <svg className="h-5 w-5 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </div>
          <p className="text-[10px] font-semibold text-muted uppercase tracking-widest">CGT-Sync</p>
          <h1 className="mt-2 text-xl font-semibold text-foreground">
            {isChangeScope ? "Change Order Review" : "Baseline Review"}
          </h1>
          {programName && (
            <p className="mt-1 text-sm text-muted">
              {programName}{cdmoName ? ` \u2014 ${cdmoName}` : ""}
            </p>
          )}
        </div>

        {/* Context bar — release date, status, sender */}
        {entity && (
          <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted">
            {releasedAt && (
              <span>
                Sent {new Date(releasedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </span>
            )}
            {entityStatus && (
              <>
                {releasedAt && <span className="text-card-border">|</span>}
                <span className="inline-flex items-center gap-1">
                  <span className={`inline-block h-1.5 w-1.5 rounded-full ${
                    entityStatus === "RELEASED" ? "bg-blue-400" :
                    entityStatus === "CONFIRMED" ? "bg-green-500" :
                    entityStatus === "COUNTERED" ? "bg-amber-500" : "bg-zinc-400"
                  }`} />
                  {entityStatus === "RELEASED" ? "Awaiting your review" :
                   entityStatus === "CONFIRMED" ? "Confirmed" :
                   entityStatus === "COUNTERED" ? "Counter submitted" :
                   entityStatus}
                </span>
              </>
            )}
            {sentBy && (
              <>
                <span className="text-card-border">|</span>
                <span>From {sentBy}</span>
              </>
            )}
          </div>
        )}

        {/* ═══ CHANGE ORDER DETAILS ═══ */}
        {isChangeScope && (
          <div className="mt-6 space-y-4">
            {/* Change Order Header */}
            <div className="card bg-accent-light/20">
              <div className="flex items-start justify-between">
                <div>
                  {sequenceNum && (
                    <p className="text-xs font-medium text-muted uppercase">Change Order #{sequenceNum}</p>
                  )}
                  <h2 className="mt-1 text-base font-semibold text-foreground">{entityName}</h2>
                </div>
                {severity && (
                  <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold ${SEVERITY_COLORS[severity] ?? "bg-zinc-100 text-zinc-600"}`}>
                    {severity}
                  </span>
                )}
              </div>

              {description && (
                <p className="mt-3 text-sm text-muted leading-relaxed">{description}</p>
              )}

              {reasonCode && (
                <p className="mt-2 text-xs text-muted">
                  Reason: <span className="font-medium text-foreground">{REASON_LABELS[reasonCode] ?? reasonCode}</span>
                </p>
              )}
            </div>

            {/* Impact Cards */}
            {(estimatedImpact !== null || scheduleImpactDays != null) && (
              <div className="grid grid-cols-2 gap-3">
                {estimatedImpact !== null && (
                  <div className="card text-center">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted">Cost Impact</p>
                    <p className={`mt-1 text-2xl font-bold ${estimatedImpact > 0 ? "text-danger" : "text-success"}`}>
                      {estimatedImpact > 0 ? "+" : ""}${Math.abs(estimatedImpact).toLocaleString()}
                    </p>
                  </div>
                )}
                {scheduleImpactDays != null && (
                  <div className="card text-center">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted">Schedule Impact</p>
                    <p className="mt-1 text-2xl font-bold text-warning">
                      +{scheduleImpactDays} day{scheduleImpactDays !== 1 ? "s" : ""}
                    </p>
                  </div>
                )}
              </div>
            )}

            <div className="border-t border-card-border" />
          </div>
        )}

        {/* ═══ BASELINE CLAUSES — LINE-BY-LINE ═══ */}
        {isBaselineScope && clauses.length > 0 && (
          <div className="mt-6 space-y-4">
            {/* Baseline header */}
            <div className="card bg-accent-light/20">
              <div className="flex items-center justify-between">
                <div>
                  {baselineVersion && (
                    <p className="text-xs font-medium text-muted uppercase">Baseline v{baselineVersion}</p>
                  )}
                  <h2 className="mt-0.5 text-base font-semibold text-foreground">{entityName}</h2>
                </div>
                <span className="rounded-full bg-accent-light px-3 py-1 text-xs font-semibold text-accent-text">
                  {clauses.length} items
                </span>
              </div>
            </div>

            {/* Total value summary */}
            {(() => {
              const totalValue = clauses.reduce((sum, c) => sum + (Number(c.value) || 0), 0);
              if (totalValue <= 0) return null;
              return (
                <div className="card bg-zinc-50 text-center py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Total Contract Value</p>
                  <p className="mt-0.5 text-xl font-bold text-foreground">
                    ${totalValue.toLocaleString()}
                  </p>
                </div>
              );
            })()}

            {/* Summary counts + grouped clause cards */}
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
                  <div className="flex items-center gap-3 text-xs text-muted">
                    {deliverables.length > 0 && <span>{deliverables.length} Deliverable{deliverables.length !== 1 ? "s" : ""}</span>}
                    {assumptions.length > 0 && <><span className="text-card-border">|</span><span>{assumptions.length} Assumption{assumptions.length !== 1 ? "s" : ""}</span></>}
                    {exclusions.length > 0 && <><span className="text-card-border">|</span><span>{exclusions.length} Exclusion{exclusions.length !== 1 ? "s" : ""}</span></>}
                  </div>

                  {/* Grouped clause cards */}
                  {groups.map(group => (
                    <div key={group.label}>
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{group.label}</h3>
                      <div className="space-y-2">
                        {group.items.map((c, i) => (
                          <div key={i} className="card p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className={`inline-flex rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${TYPE_COLORS[c.type as string] ?? TYPE_COLORS.OTHER}`}>
                                    {c.type as string}
                                  </span>
                                  {c.clauseRef != null && (
                                    <span className="font-mono text-[10px] text-muted">#{c.clauseRef as string}</span>
                                  )}
                                </div>
                                <h4 className="mt-1 text-sm font-medium text-foreground">{c.title as string}</h4>
                                {c.description != null && (
                                  <p className="mt-0.5 text-xs text-muted line-clamp-2">{c.description as string}</p>
                                )}
                              </div>
                              {c.value != null && (
                                <div className="flex-shrink-0 text-right">
                                  <p className="text-sm font-bold text-foreground">
                                    {Number(c.value).toLocaleString()}
                                  </p>
                                  {c.unit != null && (
                                    <p className="text-[10px] text-muted">{c.unit as string}</p>
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

            <div className="border-t border-card-border" />
          </div>
        )}

        {/* Countdown timer */}
        {link && !isDone && (
          <div className={`mt-5 rounded-lg border p-3 text-center ${
            expired ? "border-red-200 bg-red-50" : "border-card-border bg-zinc-50"
          }`}>
            <div className={`flex items-center justify-center gap-1.5 text-xs ${expired ? "font-medium text-danger" : "text-muted"}`}>
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
              </svg>
              <span>{expired ? "This link has expired" : timeLeft}</span>
            </div>
            {link.singleUse && !expired && (
              <p className="mt-1 text-[10px] text-muted/70">This link can only be used once</p>
            )}
          </div>
        )}

        {/* Done states */}
        {confirmed && (
          <div className="mt-6 rounded-lg border border-green-200 bg-green-50 p-5 text-center">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-success">
              <svg className="h-5 w-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <p className="mt-3 text-sm font-semibold text-green-800">
              {isChangeScope ? "Change Order Approved" : "Baseline Confirmed"}
            </p>
            <p className="mt-1 text-xs text-green-700">
              Your confirmation of <span className="font-medium">{entityName}</span> has been recorded.
            </p>
            {note.trim() && (
              <p className="mt-2 text-xs text-green-600 italic">Your note was included with the confirmation.</p>
            )}
            <p className="mt-3 text-[10px] text-green-600">You can close this page. No further action is needed.</p>
          </div>
        )}

        {countered && (
          <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-5 text-center">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-warning">
              <svg className="h-5 w-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
            <p className="mt-3 text-sm font-semibold text-amber-800">Counter Response Recorded</p>
            <p className="mt-1 text-xs text-amber-700">
              Your counter for <span className="font-medium">{entityName}</span> has been sent to the sponsor.
            </p>
            <p className="mt-3 text-[10px] text-amber-600">The sponsor will review your response and may send a revised version. You can close this page.</p>
          </div>
        )}

        {/* Actions */}
        {!isDone && !expired && (
          <div className="mt-6 space-y-4">
            {/* Note textarea */}
            <div>
              <label className="block text-xs font-medium text-muted mb-1">
                Add a note (optional for confirm, required for counter)
              </label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={isChangeScope
                  ? "E.g., We agree to the cost but need more time for the schedule change..."
                  : "E.g., We agree to the terms. Section 3.2 pricing needs revision..."
                }
                className="input resize-none"
                rows={3}
              />
            </div>

            {/* Action buttons */}
            <div className="flex gap-3">
              <button
                onClick={handleConfirm}
                disabled={confirming}
                className="btn-primary h-11 flex-1"
              >
                {confirming ? (
                  <span className="flex items-center gap-2">
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                    Submitting...
                  </span>
                ) : isChangeScope ? "Approve Change" : "Confirm Baseline"}
              </button>
              <button
                onClick={handleCounter}
                disabled={confirming || !note.trim()}
                className="btn-secondary h-11 flex-1 disabled:opacity-50"
                title={!note.trim() ? "Add a note to explain your counter" : undefined}
              >
                Counter
              </button>
            </div>
            {!note.trim() && (
              <p className="text-center text-[10px] text-muted">
                To counter, add a note above explaining what needs to change
              </p>
            )}
          </div>
        )}

        {/* Expired state */}
        {!isDone && expired && (
          <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-center">
            <div className="mx-auto flex h-8 w-8 items-center justify-center rounded-full bg-amber-100">
              <svg className="h-4 w-4 text-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
            <p className="mt-2 text-sm font-medium text-amber-700">Link Expired</p>
            <p className="mt-1 text-xs text-amber-600">
              This confirmation link has expired. Please contact the person who sent it to request a new one.
            </p>
          </div>
        )}
      </div>

      {/* Trust footer */}
      <p className="fixed bottom-4 left-0 right-0 text-center text-[10px] text-muted/60">
        Secure confirmation page generated by CGT-Sync. Responses are recorded with a timestamp and cannot be modified.
      </p>
    </div>
  );
}
