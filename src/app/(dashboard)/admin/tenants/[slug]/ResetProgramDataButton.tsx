"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface WipeCounts {
  baselines: number;
  baselineClauses: number;
  changes: number;
  invoices: number;
  invoiceLineItems: number;
  evidences: number;
  exports: number;
  extractionJobs: number;
  commitmentTerms: number;
  emailLogs: number;
  magicLinksFromEmailLogs: number;
  reminderSchedules: number;
  programContacts: number;
  scopeAnalyses: number;
  scopeAlerts: number;
  inboundEmails: number;
  eventLogs: number;
  ingestAddresses: number;
}

interface Props {
  programId: string;
  programName: string;
}

export default function ResetProgramDataButton({ programId, programName }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [counts, setCounts] = useState<WipeCounts | null>(null);
  const [orgMemberCount, setOrgMemberCount] = useState<number>(0);
  const [confirmName, setConfirmName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ before: WipeCounts; after: WipeCounts } | null>(null);

  async function openModal() {
    setOpen(true);
    setLoading(true);
    setError(null);
    setCounts(null);
    setDone(null);
    setConfirmName("");
    try {
      const res = await fetch(
        `/api/admin/programs/${encodeURIComponent(programId)}/wipe-data`,
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      setCounts(body.counts as WipeCounts);
      setOrgMemberCount(typeof body.orgMemberCount === "number" ? body.orgMemberCount : 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load counts");
    } finally {
      setLoading(false);
    }
  }

  async function handleApply() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/programs/${encodeURIComponent(programId)}/wipe-data`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmName: confirmName.trim() }),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      setDone({ before: body.before as WipeCounts, after: body.after as WipeCounts });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Wipe failed");
    } finally {
      setLoading(false);
    }
  }

  function close() {
    setOpen(false);
    setCounts(null);
    setDone(null);
    setConfirmName("");
    setError(null);
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="rounded border border-red-200 bg-white px-2 py-1 text-[11px] font-medium text-red-700 hover:bg-red-50"
      >
        Reset data
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl">
            {done ? (
              <DoneView before={done.before} after={done.after} onClose={close} />
            ) : (
              <PreviewView
                programName={programName}
                counts={counts}
                orgMemberCount={orgMemberCount}
                loading={loading}
                error={error}
                confirmName={confirmName}
                setConfirmName={setConfirmName}
                onCancel={close}
                onApply={handleApply}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}

function PreviewView({
  programName,
  counts,
  orgMemberCount,
  loading,
  error,
  confirmName,
  setConfirmName,
  onCancel,
  onApply,
}: {
  programName: string;
  counts: WipeCounts | null;
  orgMemberCount: number;
  loading: boolean;
  error: string | null;
  confirmName: string;
  setConfirmName: (v: string) => void;
  onCancel: () => void;
  onApply: () => void;
}) {
  const total = counts
    ? counts.baselines +
      counts.baselineClauses +
      counts.changes +
      counts.invoices +
      counts.invoiceLineItems +
      counts.evidences +
      counts.exports +
      counts.extractionJobs +
      counts.commitmentTerms +
      counts.emailLogs +
      counts.magicLinksFromEmailLogs +
      counts.reminderSchedules +
      counts.programContacts +
      counts.scopeAnalyses +
      counts.scopeAlerts +
      counts.inboundEmails
    : 0;

  const canApply = !!counts && confirmName.trim() === programName && !loading;

  return (
    <>
      <h2 className="text-lg font-semibold text-zinc-900">Reset program data</h2>
      <p className="mt-1 text-sm text-zinc-700">
        Wipes <strong>{programName}</strong>&apos;s data — baselines, invoices,
        evidence, scope alerts, etc.{" "}
        <strong>All login users keep their access.</strong> The program shell,
        organization, branding, and ingest addresses stay intact.
      </p>

      {loading && !counts && (
        <p className="mt-4 text-sm text-muted">Loading counts…</p>
      )}

      {counts && (
        <div className="mt-4 space-y-1 rounded border border-zinc-200 bg-zinc-50 p-3 text-xs">
          <Row label="Baselines + clauses" n={counts.baselines + counts.baselineClauses} />
          <Row label="Changes" n={counts.changes} />
          <Row label="Invoices + line items" n={counts.invoices + counts.invoiceLineItems} />
          <Row label="Evidence files" n={counts.evidences} />
          <Row label="Exports" n={counts.exports} />
          <Row label="Extraction jobs" n={counts.extractionJobs} />
          <Row label="Commitment terms" n={counts.commitmentTerms} />
          <Row label="Email logs + magic links" n={counts.emailLogs + counts.magicLinksFromEmailLogs} />
          <Row label="Reminder schedules" n={counts.reminderSchedules} />
          <Row label="Program contacts" n={counts.programContacts} />
          <Row label="Scope analyses + alerts" n={counts.scopeAnalyses + counts.scopeAlerts} />
          <Row label="Inbound emails" n={counts.inboundEmails} />
          <div className="mt-2 border-t border-zinc-200 pt-2 font-semibold text-zinc-900">
            Total rows: {total}
          </div>
          <div className="mt-1 text-zinc-500">
            Preserved: program row, organization, all login users (
            {orgMemberCount} member{orgMemberCount === 1 ? "" : "s"}), branding,{" "}
            {counts.ingestAddresses} ingest address
            {counts.ingestAddresses === 1 ? "" : "es"},{" "}
            {counts.eventLogs} event log
            {counts.eventLogs === 1 ? "" : "s"} (audit trail is append-only).
          </div>
        </div>
      )}

      {counts && (
        <>
          <p className="mt-4 text-xs text-zinc-700">
            Type the program name to confirm:{" "}
            <span className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-zinc-900">
              {programName}
            </span>
          </p>
          <input
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            placeholder={programName}
            className="input mt-2 font-mono text-xs"
            disabled={loading}
          />
        </>
      )}

      {error && (
        <div className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          {error}
        </div>
      )}

      <div className="mt-4 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          className="btn-secondary disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onApply}
          disabled={!canApply}
          className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          {loading ? "Wiping…" : "Wipe data"}
        </button>
      </div>
    </>
  );
}

function DoneView({
  before,
  after,
  onClose,
}: {
  before: WipeCounts;
  after: WipeCounts;
  onClose: () => void;
}) {
  const totalBefore =
    before.baselines +
    before.changes +
    before.invoices +
    before.evidences +
    before.scopeAlerts +
    before.emailLogs;
  return (
    <>
      <h2 className="text-lg font-semibold text-zinc-900">Done</h2>
      <p className="mt-1 text-sm text-zinc-700">
        Wiped {totalBefore} rows across the major tables. Program shell intact.
      </p>
      <div className="mt-4 space-y-1 rounded border border-zinc-200 bg-zinc-50 p-3 text-xs">
        <Row label="Baselines (after)" n={after.baselines} />
        <Row label="Changes (after)" n={after.changes} />
        <Row label="Invoices (after)" n={after.invoices} />
        <Row label="Evidence (after)" n={after.evidences} />
        <Row label="Scope alerts (after)" n={after.scopeAlerts} />
        <Row label="Email logs (after)" n={after.emailLogs} />
        <Row label="Event logs (preserved — audit trail)" n={after.eventLogs} />
        <Row label="Ingest addresses (preserved)" n={after.ingestAddresses} />
      </div>
      <div className="mt-4 flex justify-end">
        <button type="button" onClick={onClose} className="btn-primary">
          Close
        </button>
      </div>
    </>
  );
}

function Row({ label, n }: { label: string; n: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-zinc-600">{label}</span>
      <span className="font-mono text-zinc-900">{n}</span>
    </div>
  );
}
