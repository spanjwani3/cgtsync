"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import StatusBadge from "@/components/ui/StatusBadge";
import TranscriptUpload from "@/components/scope/TranscriptUpload";
import ScopeAlertCard from "@/components/scope/ScopeAlertCard";
import IngestSetup from "@/components/scope/IngestSetup";
import SpendVsEnvelope from "@/components/scope/SpendVsEnvelope";
import { useSyncProgram } from "@/components/layout/useSyncProgram";

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
  analysisJob: {
    id: string;
    meetingTitle: string | null;
    meetingDate: string | null;
    source: string;
  } | null;
}

interface ScopeAnalysis {
  id: string;
  meetingTitle: string | null;
  meetingDate: string | null;
  source: string;
  status: string;
  alertCount: number;
  summary: string | null;
  createdAt: string;
  _count: { alerts: number };
  evidence: { fileName: string; type: string } | null;
}

interface AlertStats {
  total: number;
  open: number;
  converted: number;
  dismissed: number;
}

export default function ScopeMonitorPage() {
  const { programId } = useParams<{ programId: string }>();
  const [alerts, setAlerts] = useState<ScopeAlert[]>([]);
  const [analyses, setAnalyses] = useState<ScopeAnalysis[]>([]);
  const [stats, setStats] = useState<AlertStats>({ total: 0, open: 0, converted: 0, dismissed: 0 });
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("OPEN");
  const [showUpload, setShowUpload] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  useSyncProgram(null);

  const load = useCallback(async () => {
    const [alertsRes, analysesRes] = await Promise.all([
      fetch(`/api/gateway/scope-alerts?programId=${programId}${statusFilter ? `&status=${statusFilter}` : ""}`),
      fetch(`/api/gateway/scope-analysis?programId=${programId}`),
    ]);

    if (alertsRes.ok) {
      const data = await alertsRes.json();
      setAlerts(data.alerts ?? []);
      setStats(data.stats ?? { total: 0, open: 0, converted: 0, dismissed: 0 });
    }
    if (analysesRes.ok) {
      const data = await analysesRes.json();
      setAnalyses(data.analyses ?? []);
    }
    setLoading(false);
  }, [programId, statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAnalyze(text: string) {
    setAnalyzing(true);
    try {
      const res = await fetch("/api/gateway/scope-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ programId, text }),
      });
      if (res.ok) {
        setShowUpload(false);
        setStatusFilter("OPEN");
        await load();
      } else {
        const err = await res.json().catch(() => null);
        alert(err?.error ?? "Failed to run scope analysis");
      }
    } catch {
      alert("Failed to run scope analysis");
    }
    setAnalyzing(false);
  }

  async function handleResolve(alertId: string, action: "DISMISS" | "CONVERT_TO_CHANGE") {
    const res = await fetch(`/api/gateway/scope-alerts/${alertId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (res.ok) {
      await load();
    } else {
      const err = await res.json().catch(() => null);
      alert(err?.error ?? "Failed to resolve alert");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex items-center gap-3 text-sm text-muted">
          <svg className="h-5 w-5 animate-spin text-accent" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Loading scope monitor...
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted">Scope Monitor</p>
          <h1 className="mt-0.5 text-2xl font-bold text-zinc-900">Scope Creep Detection</h1>
          <p className="mt-1 text-sm text-muted">
            Analyze meeting transcripts against your locked baseline to detect out-of-scope work
          </p>
        </div>
        <button
          onClick={() => setShowUpload(true)}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-accent/90"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Analyze Transcript
        </button>
      </div>

      {/* Stats cards */}
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="card">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Open Alerts</p>
          <p className={`mt-2 text-2xl font-bold ${stats.open > 0 ? "text-amber-600" : "text-zinc-900"}`}>
            {stats.open}
          </p>
        </div>
        <div className="card">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Converted to CO</p>
          <p className="mt-2 text-2xl font-bold text-green-600">{stats.converted}</p>
        </div>
        <div className="card">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Dismissed</p>
          <p className="mt-2 text-2xl font-bold text-zinc-400">{stats.dismissed}</p>
        </div>
        <div className="card">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Analyses Run</p>
          <p className="mt-2 text-2xl font-bold text-zinc-900">{analyses.length}</p>
        </div>
      </div>

      {/* Spend vs SOW Envelope — answers "where are we against plan?" for both sponsor and CDMO */}
      <div className="mt-6">
        <SpendVsEnvelope programId={programId} />
      </div>

      {/* Filter tabs */}
      <div className="mt-6 flex items-center gap-2">
        {[
          { key: "OPEN", label: "Open", count: stats.open },
          { key: "", label: "All", count: stats.total },
          { key: "CONVERTED", label: "Converted", count: stats.converted },
          { key: "DISMISSED", label: "Dismissed", count: stats.dismissed },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setStatusFilter(tab.key)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              statusFilter === tab.key
                ? "bg-accent text-white"
                : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
            }`}
          >
            {tab.label} ({tab.count})
          </button>
        ))}
      </div>

      {/* Alerts list */}
      <div className="mt-4 space-y-3">
        {alerts.length === 0 ? (
          <div className="card flex flex-col items-center py-12">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-50">
              <svg className="h-6 w-6 text-green-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <p className="mt-3 text-sm font-medium text-zinc-700">
              {statusFilter === "OPEN" ? "No open scope alerts" : "No scope alerts found"}
            </p>
            <p className="mt-1 text-xs text-muted">
              {statusFilter === "OPEN"
                ? "Analyze a meeting transcript to detect potential scope creep"
                : "Try a different filter"}
            </p>
          </div>
        ) : (
          alerts.map((alert) => (
            <ScopeAlertCard
              key={alert.id}
              alert={alert}
              programId={programId}
              onResolve={handleResolve}
            />
          ))
        )}
      </div>

      {/* Analysis History */}
      {analyses.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-zinc-900">Analysis History</h2>
          <div className="mt-3 space-y-2">
            {analyses.map((a) => (
              <div key={a.id} className="card flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <StatusBadge status={a.status} />
                  <div>
                    <p className="text-sm font-medium text-zinc-700">
                      {a.meetingTitle ?? a.evidence?.fileName ?? "Pasted transcript"}
                    </p>
                    <p className="text-xs text-muted">
                      {a.meetingDate
                        ? new Date(a.meetingDate).toLocaleDateString()
                        : new Date(a.createdAt).toLocaleDateString()}{" "}
                      · {a.source}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      a.alertCount > 0 ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"
                    }`}
                  >
                    {a.alertCount} alert{a.alertCount !== 1 ? "s" : ""}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Email-In Ingestion Setup */}
      <div className="mt-8">
        <IngestSetup programId={programId} />
      </div>

      {/* Upload modal */}
      {showUpload && (
        <TranscriptUpload
          onAnalyze={handleAnalyze}
          onClose={() => setShowUpload(false)}
          analyzing={analyzing}
        />
      )}
    </div>
  );
}
