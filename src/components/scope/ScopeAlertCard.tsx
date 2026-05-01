"use client";

import { useState } from "react";
import Link from "next/link";
import StatusBadge from "@/components/ui/StatusBadge";

interface ScopeAlert {
  id: string;
  title: string;
  description: string | null;
  transcriptExcerpt: string;
  matchSummary: string | null;
  confidence: string;
  recommendedAction: string;
  severity: string;
  estimatedImpact: string | null;
  scheduleImpactDays: number | null;
  speaker: string | null;
  status: string;
  resolvedAt: string | null;
  convertedChangeId: string | null;
  createdAt: string;
  matchedClause: {
    id: string;
    clauseRef: string | null;
    title: string;
    type: string;
    value: string | null;
    unit: string | null;
  } | null;
  convertedChange: {
    id: string;
    sequenceNum: number;
    title: string;
    status: string;
  } | null;
}

interface ScopeAlertCardProps {
  alert: ScopeAlert;
  programId: string;
  onResolve: (alertId: string, action: "DISMISS" | "CONVERT_TO_CHANGE") => Promise<void>;
}

const confidenceColors: Record<string, string> = {
  HIGH: "bg-red-100 text-red-700",
  MEDIUM: "bg-amber-100 text-amber-700",
  LOW: "bg-blue-100 text-blue-700",
};

const actionLabels: Record<string, string> = {
  INITIATE_CHANGE_ORDER: "Initiate Change Order",
  CLARIFY_WITH_SPONSOR: "Clarify with Sponsor",
  NO_ACTION: "No Action Needed",
  REVIEW: "Review Required",
};

export default function ScopeAlertCard({ alert, programId, onResolve }: ScopeAlertCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [resolving, setResolving] = useState(false);

  async function handleAction(action: "DISMISS" | "CONVERT_TO_CHANGE") {
    setResolving(true);
    await onResolve(alert.id, action);
    setResolving(false);
  }

  const isOpen = alert.status === "OPEN";

  return (
    <div className={`card border ${
      alert.status === "OPEN"
        ? alert.confidence === "HIGH"
          ? "border-red-200 bg-red-50/20"
          : "border-amber-200 bg-amber-50/20"
        : "border-card-border"
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={alert.severity} />
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${confidenceColors[alert.confidence] ?? "bg-zinc-100 text-zinc-600"}`}>
              {alert.confidence} confidence
            </span>
            {alert.status !== "OPEN" && (
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                alert.status === "CONVERTED" ? "bg-green-100 text-green-700" : "bg-zinc-100 text-zinc-500"
              }`}>
                {alert.status}
              </span>
            )}
          </div>
          <h3 className="mt-2 text-sm font-semibold text-zinc-900">{alert.title}</h3>
          {alert.description && (
            <p className="mt-1 text-xs text-muted line-clamp-2">{alert.description}</p>
          )}
        </div>

        {isOpen && (
          <div className="flex flex-shrink-0 items-center gap-2">
            <button
              onClick={() => handleAction("CONVERT_TO_CHANGE")}
              disabled={resolving}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-accent/90 disabled:opacity-50"
            >
              Create Change Order
            </button>
            <button
              onClick={() => handleAction("DISMISS")}
              disabled={resolving}
              className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-50"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* Key info row */}
      <div className="mt-3 flex items-center gap-4 flex-wrap text-xs text-muted">
        {alert.speaker && (
          <span>Speaker: <strong className="text-zinc-700">{alert.speaker}</strong></span>
        )}
        {alert.estimatedImpact && (
          <span>Impact: <strong className="text-zinc-700">${Number(alert.estimatedImpact).toLocaleString()}</strong></span>
        )}
        {alert.scheduleImpactDays && (
          <span>Schedule: <strong className="text-zinc-700">+{alert.scheduleImpactDays} days</strong></span>
        )}
        <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-[10px] font-medium">
          {actionLabels[alert.recommendedAction] ?? alert.recommendedAction}
        </span>
      </div>

      {/* Expandable details */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="mt-3 flex items-center gap-1 text-xs font-medium text-accent hover:text-accent/80"
      >
        <svg
          className={`h-3 w-3 transition-transform ${expanded ? "rotate-90" : ""}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        {expanded ? "Hide details" : "Show details"}
      </button>

      {expanded && (
        <div className="mt-3 space-y-3 border-t border-card-border pt-3">
          {/* Transcript excerpt */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Transcript Excerpt</p>
            <blockquote className="mt-1 border-l-2 border-amber-300 pl-3 text-xs italic text-zinc-600">
              &ldquo;{alert.transcriptExcerpt}&rdquo;
            </blockquote>
          </div>

          {/* Match summary */}
          {alert.matchSummary && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Baseline Match</p>
              <p className="mt-1 text-xs text-zinc-600">{alert.matchSummary}</p>
            </div>
          )}

          {/* Matched clause */}
          {alert.matchedClause && (
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Closest Baseline Clause</p>
              <p className="mt-1 text-xs font-medium text-zinc-700">
                {alert.matchedClause.clauseRef ? `[${alert.matchedClause.clauseRef}] ` : ""}
                {alert.matchedClause.title}
              </p>
              <div className="mt-1 flex items-center gap-2">
                <StatusBadge status={alert.matchedClause.type} />
                {alert.matchedClause.value && (
                  <span className="text-xs text-muted">
                    {Number(alert.matchedClause.value).toLocaleString()} {alert.matchedClause.unit}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Converted change link */}
          {alert.convertedChange && (
            <div className="rounded-lg border border-green-200 bg-green-50 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-green-700">Converted to Change Order</p>
              <Link
                href={`/programs/${programId}/changes`}
                className="mt-1 text-xs font-medium text-accent hover:underline"
              >
                CO-{alert.convertedChange.sequenceNum}: {alert.convertedChange.title} ({alert.convertedChange.status})
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
