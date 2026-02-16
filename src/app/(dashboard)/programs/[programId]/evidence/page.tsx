"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import StatusBadge from "@/components/ui/StatusBadge";
import { useSyncProgram } from "@/components/layout/useSyncProgram";

const EVIDENCE_TYPES = [
  "INVOICE",
  "SOW_MSA",
  "EMAIL_APPROVAL",
  "TRANSCRIPT",
  "CHANGE_ORDER",
  "DISPUTE_PACKET",
  "EXPORT_PACK",
  "OTHER",
] as const;

const TARGET_TYPE_MAP: Record<string, string> = {
  INVOICE: "INVOICE",
  SOW_MSA: "BASELINE",
  CHANGE_ORDER: "CHANGE_ORDER",
};

interface EvidenceItem {
  id: string;
  type: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  sha256Hash: string;
  finalized: boolean;
  finalizedAt: string | null;
  retainUntil: string | null;
  deletedAt: string | null;
  createdAt: string;
}

interface ExtractionJob {
  id: string;
  evidenceId: string;
  programId: string;
  targetType: string;
  status: string;
  extractedData: Record<string, unknown> | null;
  errorMessage: string | null;
  confidence: number | null;
  processingTimeMs: number | null;
  tokensUsed: number | null;
  modelUsed: string | null;
  createdAt: string;
  completedAt: string | null;
  evidence?: { fileName: string; type: string };
}

interface AuditEntry {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  createdAt: string;
  user?: { email: string } | null;
}

interface BaselineOption {
  id: string;
  title: string;
  version: number;
  status: string;
}

interface InvoiceOption {
  id: string;
  invoiceNumber: string | null;
  vendorName: string | null;
  status: string;
  createdAt: string;
}

export default function EvidencePage() {
  const { programId } = useParams<{ programId: string }>();
  const [tab, setTab] = useState<"evidence" | "extractions" | "audit">("evidence");
  const [evidences, setEvidences] = useState<EvidenceItem[]>([]);
  const [jobs, setJobs] = useState<ExtractionJob[]>([]);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState<string | null>(null);
  const [uploadType, setUploadType] = useState<string>("OTHER");
  const [error, setError] = useState("");
  const [selectedJob, setSelectedJob] = useState<ExtractionJob | null>(null);

  // Apply modal state
  const [applyJob, setApplyJob] = useState<ExtractionJob | null>(null);
  const [baselines, setBaselines] = useState<BaselineOption[]>([]);
  const [invoices, setInvoices] = useState<InvoiceOption[]>([]);
  const [selectedEntityId, setSelectedEntityId] = useState("");
  const [applying, setApplying] = useState(false);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useSyncProgram();

  const loadEvidence = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/gateway/evidence?programId=${programId}`);
      if (res.ok) {
        setEvidences(await res.json());
      }
    } catch {
      // silent
    }
    setLoading(false);
  }, [programId]);

  const loadJobs = useCallback(async () => {
    try {
      const res = await fetch(`/api/gateway/extraction?programId=${programId}`);
      if (res.ok) {
        const data = await res.json();
        setJobs(data.jobs);
        return data.jobs as ExtractionJob[];
      }
    } catch {
      // silent
    }
    return [];
  }, [programId]);

  const loadAudit = useCallback(async () => {
    try {
      const res = await fetch(`/api/gateway/audit?programId=${programId}&limit=100`);
      if (res.ok) {
        const data = await res.json();
        setAuditEntries(data.entries);
        setAuditTotal(data.total);
      }
    } catch {
      // silent
    }
  }, [programId]);

  // Stop polling when no PENDING/PROCESSING jobs
  const startPolling = useCallback(() => {
    if (pollingRef.current) return;
    pollingRef.current = setInterval(async () => {
      const currentJobs = await loadJobs();
      const active = currentJobs.filter((j: ExtractionJob) => j.status === "PENDING" || j.status === "PROCESSING");
      if (active.length === 0 && pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    }, 2000);
  }, [loadJobs]);

  useEffect(() => {
    loadEvidence();
  }, [loadEvidence]);

  useEffect(() => {
    if (tab === "extractions") {
      loadJobs();
    }
  }, [tab, loadJobs]);

  useEffect(() => {
    if (tab === "audit" && auditEntries.length === 0) {
      loadAudit();
    }
  }, [tab, auditEntries.length, loadAudit]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("type", uploadType);
      fd.append("programId", programId);
      const res = await fetch("/api/gateway/evidence", { method: "POST", body: fd });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Upload failed");
      }
      await loadEvidence();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  async function viewFile(evidenceId: string) {
    const res = await fetch(`/api/gateway/evidence/${evidenceId}`);
    if (res.ok) {
      const data = await res.json();
      if (data.signedUrl) window.open(data.signedUrl, "_blank");
    }
  }

  async function finalizeEvidence(evidenceId: string) {
    const res = await fetch(`/api/gateway/evidence/${evidenceId}`, { method: "POST" });
    if (res.ok) {
      setEvidences((prev) =>
        prev.map((ev) => (ev.id === evidenceId ? { ...ev, finalized: true, finalizedAt: new Date().toISOString() } : ev))
      );
    }
  }

  async function triggerExtraction(evidence: EvidenceItem) {
    const targetType = TARGET_TYPE_MAP[evidence.type];
    if (!targetType) {
      const choice = window.prompt(
        "Choose extraction type: BASELINE, INVOICE, CHANGE_ORDER, or TERMS",
        "BASELINE"
      );
      if (!choice || !["BASELINE", "INVOICE", "CHANGE_ORDER", "TERMS"].includes(choice.toUpperCase())) return;
      return doExtract(evidence.id, choice.toUpperCase());
    }
    return doExtract(evidence.id, targetType);
  }

  async function doExtract(evidenceId: string, targetType: string) {
    setExtracting(evidenceId);
    setError("");
    try {
      // Step 1: Create PENDING job
      const createRes = await fetch("/api/gateway/extraction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ evidenceId, targetType }),
      });
      const createData = await createRes.json();
      if (!createRes.ok) throw new Error(createData.error ?? "Failed to create job");

      const jobId = createData.job.id;
      setTab("extractions");
      await loadJobs();

      // Step 2: Trigger run
      const runRes = await fetch(`/api/gateway/extraction/${jobId}/run`, { method: "POST" });
      const runData = await runRes.json();
      if (!runRes.ok) throw new Error(runData.error ?? "Extraction failed");

      // Refresh
      await loadJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Extraction failed");
      await loadJobs();
    } finally {
      setExtracting(null);
    }
  }

  // Load baselines/invoices for apply dropdown
  async function openApplyModal(job: ExtractionJob) {
    setApplyJob(job);
    setSelectedEntityId("");
    setError("");

    if (job.targetType === "BASELINE") {
      try {
        const res = await fetch(`/api/baselines?programId=${programId}`);
        if (res.ok) {
          const data = await res.json();
          setBaselines(data.filter((b: BaselineOption) => b.status === "DRAFT"));
        }
      } catch {
        // silent
      }
    } else if (job.targetType === "INVOICE") {
      try {
        const res = await fetch(`/api/invoices?programId=${programId}`);
        if (res.ok) {
          const data = await res.json();
          setInvoices(data);
        }
      } catch {
        // silent
      }
    }
  }

  async function handleApply() {
    if (!applyJob) return;
    setApplying(true);
    setError("");
    try {
      const bodyObj: Record<string, string> = {};
      if (applyJob.targetType === "BASELINE") {
        if (!selectedEntityId) { setError("Select a baseline"); setApplying(false); return; }
        bodyObj.baselineId = selectedEntityId;
      } else if (applyJob.targetType === "INVOICE") {
        if (!selectedEntityId) { setError("Select an invoice"); setApplying(false); return; }
        bodyObj.invoiceId = selectedEntityId;
      }
      // CHANGE_ORDER: no entity needed, auto-infers programId

      const res = await fetch(`/api/gateway/extraction/${applyJob.id}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyObj),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Apply failed");

      setApplyJob(null);
      setError("");
      await loadAudit();
      alert(`Applied ${data.createdCount} item(s) from extraction.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Apply failed");
    } finally {
      setApplying(false);
    }
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function statusColor(status: string): string {
    switch (status) {
      case "COMPLETED": return "text-green-600";
      case "FAILED": return "text-red-600";
      case "PROCESSING": return "text-amber-600";
      case "PENDING": return "text-blue-500";
      default: return "text-zinc-400";
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">Evidence & Extraction</h1>
          <p className="mt-1 text-sm text-zinc-500">Upload documents and extract structured data with AI</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={uploadType}
            onChange={(e) => setUploadType(e.target.value)}
            className="rounded-md border border-zinc-300 px-2 py-2 text-sm"
          >
            {EVIDENCE_TYPES.map((t) => (
              <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
            ))}
          </select>
          <label className={`cursor-pointer rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 ${uploading ? "opacity-50" : ""}`}>
            {uploading ? "Uploading..." : "Upload Evidence"}
            <input type="file" className="hidden" onChange={handleUpload} disabled={uploading} />
          </label>
        </div>
      </div>

      {error && <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="mt-6 flex gap-1 border-b border-zinc-200">
        <button
          onClick={() => setTab("evidence")}
          className={`px-4 py-2 text-sm font-medium ${tab === "evidence" ? "border-b-2 border-zinc-900 text-zinc-900" : "text-zinc-500 hover:text-zinc-700"}`}
        >
          Evidence Files ({evidences.length})
        </button>
        <button
          onClick={() => setTab("extractions")}
          className={`px-4 py-2 text-sm font-medium ${tab === "extractions" ? "border-b-2 border-zinc-900 text-zinc-900" : "text-zinc-500 hover:text-zinc-700"}`}
        >
          Extractions ({jobs.length || "..."})
        </button>
        <button
          onClick={() => setTab("audit")}
          className={`px-4 py-2 text-sm font-medium ${tab === "audit" ? "border-b-2 border-zinc-900 text-zinc-900" : "text-zinc-500 hover:text-zinc-700"}`}
        >
          Audit Log ({auditTotal || "..."})
        </button>
      </div>

      {/* Evidence Files Tab */}
      {tab === "evidence" && (
        <div className="mt-4">
          {loading ? (
            <p className="py-8 text-center text-sm text-zinc-400">Loading evidence...</p>
          ) : (
            <table className="w-full">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Type</th>
                  <th>Size</th>
                  <th>SHA-256</th>
                  <th>Status</th>
                  <th>Uploaded</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {evidences.map((ev) => (
                  <tr key={ev.id}>
                    <td className="font-medium text-zinc-900">{ev.fileName}</td>
                    <td><StatusBadge status={ev.type} /></td>
                    <td className="text-sm text-zinc-500">{formatBytes(ev.fileSize)}</td>
                    <td className="font-mono text-xs text-zinc-400" title={ev.sha256Hash}>{ev.sha256Hash.slice(0, 12)}...</td>
                    <td>{ev.finalized ? <span className="text-xs text-green-600 font-medium">Finalized</span> : <span className="text-xs text-zinc-400">Pending</span>}</td>
                    <td className="text-xs text-zinc-500">{new Date(ev.createdAt).toLocaleString()}</td>
                    <td>
                      <div className="flex gap-1">
                        <button onClick={() => viewFile(ev.id)} className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-50">View</button>
                        {!ev.finalized && (
                          <button onClick={() => finalizeEvidence(ev.id)} className="rounded bg-purple-600 px-2 py-1 text-xs text-white hover:bg-purple-500">Finalize</button>
                        )}
                        <button
                          onClick={() => triggerExtraction(ev)}
                          disabled={extracting === ev.id}
                          className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-500 disabled:opacity-50"
                        >
                          {extracting === ev.id ? "Extracting..." : "Extract"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {evidences.length === 0 && (
                  <tr><td colSpan={7} className="py-8 text-center text-sm text-zinc-400">No evidence files uploaded to this program yet</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Extractions Tab */}
      {tab === "extractions" && (
        <div className="mt-4">
          {jobs.length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-400">No extraction jobs yet. Click &ldquo;Extract&rdquo; on an evidence file to start.</p>
          ) : (
            <div className="space-y-3">
              {jobs.map((job) => (
                <div key={job.id} className="rounded-md border border-zinc-200 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-medium text-zinc-900">{job.evidence?.fileName ?? "Unknown file"}</span>
                      <span className="ml-2 rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600">{job.targetType.replace(/_/g, " ")}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`text-sm font-medium ${statusColor(job.status)}`}>
                        {job.status === "PROCESSING" ? "Processing..." : job.status === "PENDING" ? "Queued" : job.status}
                      </span>
                      {job.confidence !== null && (
                        <span className="text-xs text-zinc-400">
                          {Math.round(Number(job.confidence) * 100)}% confidence
                        </span>
                      )}
                    </div>
                  </div>

                  {job.errorMessage && (
                    <div className="mt-2 rounded bg-red-50 px-3 py-2 text-xs text-red-700">
                      {job.errorMessage}
                      <p className="mt-1 text-red-500">You can manually create the items via the Baseline/Invoice/Change pages.</p>
                    </div>
                  )}

                  <div className="mt-2 flex items-center gap-4 text-xs text-zinc-400">
                    <span>{new Date(job.createdAt).toLocaleString()}</span>
                    {job.processingTimeMs ? <span>{(job.processingTimeMs / 1000).toFixed(1)}s</span> : null}
                    {job.tokensUsed ? <span>{job.tokensUsed.toLocaleString()} tokens</span> : null}
                    {job.modelUsed ? <span>{job.modelUsed}</span> : null}
                  </div>

                  {job.status === "COMPLETED" && (
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={() => setSelectedJob(selectedJob?.id === job.id ? null : job)}
                        className="rounded border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50"
                      >
                        {selectedJob?.id === job.id ? "Hide Preview" : "Preview Data"}
                      </button>
                      <button
                        onClick={() => openApplyModal(job)}
                        className="rounded bg-green-600 px-3 py-1.5 text-xs text-white hover:bg-green-500"
                      >
                        Apply to {job.targetType === "BASELINE" ? "Baseline" : job.targetType === "INVOICE" ? "Invoice" : job.targetType === "TERMS" ? "Timeline" : "Change Ledger"}
                      </button>
                    </div>
                  )}

                  {selectedJob?.id === job.id && job.extractedData && (
                    <div className="mt-3">
                      <ExtractionPreview data={job.extractedData} targetType={job.targetType} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Apply Modal */}
      {applyJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-zinc-900">
              Apply Extraction
            </h3>
            <p className="mt-1 text-sm text-zinc-500">
              {applyJob.targetType === "BASELINE"
                ? "Select a DRAFT baseline to add extracted clauses to:"
                : applyJob.targetType === "INVOICE"
                ? "Select an invoice to add extracted line items to:"
                : applyJob.targetType === "TERMS"
                ? "This will import extracted commitment terms into the program timeline."
                : "This will create a new Change entry in the program ledger."}
            </p>

            {applyJob.targetType === "BASELINE" && (
              <select
                value={selectedEntityId}
                onChange={(e) => setSelectedEntityId(e.target.value)}
                className="mt-3 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
              >
                <option value="">-- Select Baseline --</option>
                {baselines.map((b) => (
                  <option key={b.id} value={b.id}>
                    v{b.version} — {b.title} ({b.status})
                  </option>
                ))}
              </select>
            )}

            {applyJob.targetType === "INVOICE" && (
              <select
                value={selectedEntityId}
                onChange={(e) => setSelectedEntityId(e.target.value)}
                className="mt-3 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
              >
                <option value="">-- Select Invoice --</option>
                {invoices.map((inv) => (
                  <option key={inv.id} value={inv.id}>
                    {inv.invoiceNumber ?? "No #"} — {inv.vendorName ?? "Unknown vendor"} ({inv.status})
                  </option>
                ))}
              </select>
            )}

            {baselines.length === 0 && applyJob.targetType === "BASELINE" && (
              <p className="mt-2 text-xs text-amber-600">No DRAFT baselines found. Create one first in the Assumption Locker.</p>
            )}
            {invoices.length === 0 && applyJob.targetType === "INVOICE" && (
              <p className="mt-2 text-xs text-amber-600">No invoices found. Create one first in the Invoice page.</p>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => { setApplyJob(null); setError(""); }}
                className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
              >
                Cancel
              </button>
              <button
                onClick={handleApply}
                disabled={applying || (applyJob.targetType !== "CHANGE_ORDER" && applyJob.targetType !== "TERMS" && !selectedEntityId)}
                className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-50"
              >
                {applying ? "Applying..." : "Apply"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Audit Log Tab */}
      {tab === "audit" && (
        <div className="mt-4">
          {auditEntries.length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-400">No audit entries found for this program.</p>
          ) : (
            <div className="space-y-1">
              {auditEntries.map((entry) => (
                <div key={entry.id} className="flex items-start gap-3 rounded-md border px-3 py-2 text-xs">
                  <span className="mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full bg-zinc-400" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-zinc-900">{entry.action.replace(/_/g, " ")}</span>
                      {entry.entityType ? (
                        <span className="text-zinc-400">{entry.entityType}</span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-zinc-400">
                      <span>{entry.user?.email ?? "system"}</span>
                      <span>{new Date(entry.createdAt).toLocaleString()}</span>
                      {entry.ipAddress && entry.ipAddress !== "unknown" ? (
                        <span>IP: {entry.ipAddress}</span>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
              {auditTotal > auditEntries.length && (
                <p className="py-2 text-center text-xs text-zinc-400">
                  Showing {auditEntries.length} of {auditTotal} entries
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ExtractionPreview({ data, targetType }: { data: Record<string, unknown>; targetType: string }) {
  if (targetType === "BASELINE") {
    const clauses = (data.clauses as Array<Record<string, unknown>>) ?? [];
    return (
      <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
        {data.documentTitle ? <p className="mb-2 text-sm font-medium text-zinc-900">{String(data.documentTitle)}</p> : null}
        {data.summary ? <p className="mb-3 text-xs text-zinc-500">{String(data.summary)}</p> : null}
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-zinc-500">
              <th className="pb-1">Ref</th>
              <th className="pb-1">Type</th>
              <th className="pb-1">Title</th>
              <th className="pb-1">Value</th>
              <th className="pb-1">Conf</th>
              <th className="pb-1">Excerpt</th>
            </tr>
          </thead>
          <tbody>
            {clauses.map((c, i) => (
              <tr key={i} className="border-t border-zinc-200">
                <td className="py-1 text-zinc-500">{String(c.clauseRef ?? "-")}</td>
                <td className="py-1"><span className="rounded bg-zinc-200 px-1.5 py-0.5 text-xs">{String(c.type ?? "OTHER")}</span></td>
                <td className="py-1 text-zinc-900">{String(c.title ?? "")}</td>
                <td className="py-1 font-mono">{c.value != null ? `${String(c.value)} ${String(c.unit ?? "")}` : "-"}</td>
                <td className="py-1">{c.confidence != null ? `${Math.round(Number(c.confidence) * 100)}%` : "-"}</td>
                <td className="py-1 text-zinc-400 max-w-[200px] truncate" title={String(c.excerpt ?? "")}>{String(c.excerpt ?? "-")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {clauses.length === 0 && <p className="text-xs text-zinc-400">No clauses extracted</p>}
      </div>
    );
  }

  if (targetType === "INVOICE") {
    const lineItems = (data.lineItems as Array<Record<string, unknown>>) ?? [];
    return (
      <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
        <div className="mb-3 grid grid-cols-4 gap-2 text-xs">
          <div><span className="text-zinc-500">Invoice #:</span> <span className="font-medium">{String(data.invoiceNumber ?? "-")}</span></div>
          <div><span className="text-zinc-500">Vendor:</span> <span className="font-medium">{String(data.vendorName ?? "-")}</span></div>
          <div><span className="text-zinc-500">Date:</span> <span className="font-medium">{String(data.invoiceDate ?? "-")}</span></div>
          <div><span className="text-zinc-500">Total:</span> <span className="font-medium font-mono">{data.totalAmount != null ? Number(data.totalAmount).toLocaleString() : "-"}</span></div>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-zinc-500">
              <th className="pb-1">Description</th>
              <th className="pb-1 text-right">Qty</th>
              <th className="pb-1 text-right">Unit Price</th>
              <th className="pb-1 text-right">Amount</th>
              <th className="pb-1 text-right">Conf</th>
            </tr>
          </thead>
          <tbody>
            {lineItems.map((li, i) => (
              <tr key={i} className="border-t border-zinc-200">
                <td className="py-1 text-zinc-900">{String(li.description ?? "")}</td>
                <td className="py-1 text-right font-mono">{li.quantity != null ? String(li.quantity) : "-"}</td>
                <td className="py-1 text-right font-mono">{li.unitPrice != null ? Number(li.unitPrice).toLocaleString() : "-"}</td>
                <td className="py-1 text-right font-mono font-medium">{li.amount != null ? Number(li.amount).toLocaleString() : "-"}</td>
                <td className="py-1 text-right">{li.confidence != null ? `${Math.round(Number(li.confidence) * 100)}%` : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {lineItems.length === 0 && <p className="text-xs text-zinc-400">No line items extracted</p>}
      </div>
    );
  }

  if (targetType === "CHANGE_ORDER") {
    return (
      <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs">
        <p className="font-medium text-zinc-900">{String(data.changeTitle ?? "Untitled Change")}</p>
        {data.description ? <p className="mt-1 text-zinc-600">{String(data.description)}</p> : null}
        <div className="mt-2 flex gap-4">
          <span><span className="text-zinc-500">Severity:</span> <span className="font-medium">{String(data.severity ?? "-")}</span></span>
          <span><span className="text-zinc-500">Impact:</span> <span className="font-mono font-medium">{data.estimatedImpact != null ? Number(data.estimatedImpact).toLocaleString() : "-"}</span></span>
          <span><span className="text-zinc-500">Effective:</span> <span>{String(data.effectiveDate ?? "-")}</span></span>
          <span><span className="text-zinc-500">Conf:</span> <span>{data.confidence != null ? `${Math.round(Number(data.confidence) * 100)}%` : "-"}</span></span>
        </div>
        {data.excerpt ? <p className="mt-2 text-zinc-400 italic">&ldquo;{String(data.excerpt)}&rdquo;</p> : null}
        {data.summary ? <p className="mt-2 text-zinc-500">{String(data.summary)}</p> : null}
      </div>
    );
  }

  if (targetType === "TERMS") {
    const terms = (data.terms as Array<Record<string, unknown>>) ?? [];
    return (
      <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
        {data.documentTitle ? <p className="mb-2 text-sm font-medium text-zinc-900">{String(data.documentTitle)}</p> : null}
        {data.summary ? <p className="mb-3 text-xs text-zinc-500">{String(data.summary)}</p> : null}
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-zinc-500">
              <th className="pb-1">Type</th>
              <th className="pb-1">Label</th>
              <th className="pb-1">Date/Offset</th>
              <th className="pb-1">Cost/Percent</th>
              <th className="pb-1">Conf</th>
              <th className="pb-1">Excerpt</th>
            </tr>
          </thead>
          <tbody>
            {terms.map((t, i) => (
              <tr key={i} className="border-t border-zinc-200">
                <td className="py-1"><span className="rounded bg-zinc-200 px-1.5 py-0.5 text-xs">{String(t.termType ?? "-").replace(/_/g, " ")}</span></td>
                <td className="py-1 text-zinc-900">{String(t.label ?? "")}</td>
                <td className="py-1 font-mono">{String(t.dateOrOffset ?? "-")}</td>
                <td className="py-1 font-mono">{String(t.costOrPercent ?? "-")}</td>
                <td className="py-1">{t.confidence != null ? `${Math.round(Number(t.confidence) * 100)}%` : "-"}</td>
                <td className="py-1 text-zinc-400 max-w-[200px] truncate" title={String(t.excerpt ?? "")}>{String(t.excerpt ?? "-")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {terms.length === 0 && <p className="text-xs text-zinc-400">No terms extracted</p>}
      </div>
    );
  }

  // Fallback: raw JSON
  return (
    <pre className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-700 overflow-auto max-h-60">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}
