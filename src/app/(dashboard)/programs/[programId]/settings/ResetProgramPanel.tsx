"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface ResetCounts {
  baselines: number;
  changes: number;
  invoices: number;
  evidence: number;
  extractionJobs: number;
  commitmentTerms: number;
  exports: number;
  emailLogs: number;
  reminderSchedules: number;
  scopeAnalyses: number;
  scopeAlerts: number;
  inboundEmails: number;
}

export default function ResetProgramPanel({
  programId,
  programName,
}: {
  programId: string;
  programName: string;
}) {
  const router = useRouter();
  const [showDetails, setShowDetails] = useState(false);
  const [typed, setTyped] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<ResetCounts | null>(null);

  const canReset = typed.trim() === programName;

  async function handleReset() {
    if (!canReset) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/programs/${programId}/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmName: typed.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
        setSubmitting(false);
        return;
      }
      setSuccess(body.counts as ResetCounts);
      setSubmitting(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reset failed");
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="mt-4">
        <h3 className="font-semibold text-zinc-900">Program reset complete</h3>
        <p className="mt-1 text-sm text-muted">
          {programName} now has no baseline, change, invoice, or evidence data.
          Configuration (ingest address, contacts) was retained.
        </p>
        <table className="mt-4 w-full max-w-md text-sm">
          <tbody>
            {Object.entries(success).map(([key, value]) => (
              <tr key={key} className="border-b border-zinc-100">
                <td className="py-1.5 text-zinc-700">{key}</td>
                <td className="py-1.5 text-right font-mono text-zinc-900">
                  {value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Link
          href={`/programs/${programId}/cockpit`}
          className="btn-secondary mt-6 inline-block"
        >
          Back to cockpit
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-4">
      <h3 className="font-semibold text-zinc-900">Reset program data</h3>
      <p className="mt-2 text-sm text-zinc-700">
        Permanently deletes all baselines, changes, invoices, evidence, scope
        analyses, extraction jobs, commitment terms, exports, email logs,
        reminder schedules, and inbound emails for this program. The program
        shell, ingest email address, and program contacts are kept so you don't
        have to reconfigure them.
      </p>
      <button
        type="button"
        onClick={() => setShowDetails((s) => !s)}
        className="mt-2 text-xs text-accent-text underline"
      >
        {showDetails ? "Hide details" : "Show details"}
      </button>
      {showDetails && (
        <div className="mt-2 rounded border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-700">
          <p className="font-medium">Tables purged (programId = this program):</p>
          <ul className="mt-1 list-inside list-disc">
            <li>baselines (cascades to baseline_clauses)</li>
            <li>changes</li>
            <li>invoices (cascades to invoice_line_items)</li>
            <li>evidences (hard delete; ignores deletedAt)</li>
            <li>extraction_jobs</li>
            <li>commitment_terms</li>
            <li>exports</li>
            <li>email_logs</li>
            <li>reminder_schedules</li>
            <li>scope_analyses (cascades to scope candidates)</li>
            <li>scope_alerts</li>
            <li>inbound_emails</li>
          </ul>
          <p className="mt-2 font-medium">Tables retained:</p>
          <ul className="mt-1 list-inside list-disc">
            <li>program shell (id, name, cdmo, etc.)</li>
            <li>ingest_addresses (so inbound email keeps working)</li>
            <li>program_contacts (configuration, not data)</li>
            <li>org_members (org-level)</li>
            <li>event_logs (audit trail of what happened pre-reset)</li>
          </ul>
        </div>
      )}

      <p className="mt-4 text-xs text-zinc-700">
        This action cannot be undone. Type the program name{" "}
        <span className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-zinc-900">
          {programName}
        </span>{" "}
        to confirm.
      </p>
      <input
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        placeholder={programName}
        className="input mt-2 max-w-md"
        disabled={submitting}
      />
      {error && (
        <div className="mt-3 max-w-md rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          {error}
        </div>
      )}
      <div className="mt-4">
        <button
          type="button"
          onClick={handleReset}
          disabled={!canReset || submitting}
          className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          {submitting ? "Resetting…" : "Permanently reset program"}
        </button>
      </div>
    </div>
  );
}
