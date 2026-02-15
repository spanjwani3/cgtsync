"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import StatusBadge from "@/components/ui/StatusBadge";

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

export default function EvidencePage() {
  const { programId } = useParams<{ programId: string }>();
  const [tab, setTab] = useState<"evidence" | "audit">("evidence");
  const [evidences, setEvidences] = useState<EvidenceItem[]>([]);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadType, setUploadType] = useState<string>("OTHER");
  const [error, setError] = useState("");

  const loadEvidence = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/gateway/evidence?programId=${programId}`);
      if (res.ok) {
        setEvidences(await res.json());
      }
    } catch {
      // silent — will show empty state
    }
    setLoading(false);
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

  useEffect(() => {
    loadEvidence();
  }, [loadEvidence]);

  useEffect(() => {
    if (tab === "audit" && auditEntries.length === 0) {
      loadAudit();
    }
  }, [tab, auditEntries.length, loadAudit]);

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

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">Evidence & Audit</h1>
          <p className="mt-1 text-sm text-zinc-500">All evidence files and audit trail for this program</p>
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
          onClick={() => setTab("audit")}
          className={`px-4 py-2 text-sm font-medium ${tab === "audit" ? "border-b-2 border-zinc-900 text-zinc-900" : "text-zinc-500 hover:text-zinc-700"}`}
        >
          Audit Log ({auditTotal || "..."})
        </button>
      </div>

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
                      {entry.entityType && (
                        <span className="text-zinc-400">{entry.entityType}</span>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-zinc-400">
                      <span>{entry.user?.email ?? "system"}</span>
                      <span>{new Date(entry.createdAt).toLocaleString()}</span>
                      {entry.ipAddress && entry.ipAddress !== "unknown" && (
                        <span>IP: {entry.ipAddress}</span>
                      )}
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
