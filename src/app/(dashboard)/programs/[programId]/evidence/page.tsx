"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import StatusBadge from "@/components/ui/StatusBadge";

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

interface EventLogEntry {
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
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const loadEvidence = useCallback(async () => {
    // Fetch evidence files via the programs detail which includes them
    // For now we use a simple approach - the evidence is loaded from the gateway
    const res = await fetch(`/api/programs/${programId}`);
    if (res.ok) {
      // We'll show what we have; full evidence list would need a dedicated endpoint
    }
    setLoading(false);
  }, [programId]);

  useEffect(() => {
    loadEvidence();
  }, [loadEvidence]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("type", "OTHER");
      fd.append("programId", programId);
      const res = await fetch("/api/gateway/evidence", { method: "POST", body: fd });
      if (!res.ok) throw new Error("Upload failed");
      const evidence = await res.json();
      setEvidences((prev) => [evidence, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
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
        <label className={`cursor-pointer rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 ${uploading ? "opacity-50" : ""}`}>
          {uploading ? "Uploading..." : "Upload Evidence"}
          <input type="file" className="hidden" onChange={handleUpload} disabled={uploading} />
        </label>
      </div>

      {error && <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {/* Tabs */}
      <div className="mt-6 flex gap-1 border-b border-zinc-200">
        <button
          onClick={() => setTab("evidence")}
          className={`px-4 py-2 text-sm font-medium ${tab === "evidence" ? "border-b-2 border-zinc-900 text-zinc-900" : "text-zinc-500 hover:text-zinc-700"}`}
        >
          Evidence Files
        </button>
        <button
          onClick={() => setTab("audit")}
          className={`px-4 py-2 text-sm font-medium ${tab === "audit" ? "border-b-2 border-zinc-900 text-zinc-900" : "text-zinc-500 hover:text-zinc-700"}`}
        >
          Audit Log
        </button>
      </div>

      {tab === "evidence" && (
        <div className="mt-4">
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
        </div>
      )}

      {tab === "audit" && (
        <div className="mt-4">
          <p className="text-sm text-zinc-500">
            The event log is append-only. All state transitions, magic link views/confirms, evidence uploads, and exports are recorded.
          </p>
          <div className="mt-4 rounded-lg border border-card-border bg-card-bg p-4">
            <p className="text-xs text-zinc-400">
              Audit log entries are stored in the event_logs table with DB-level triggers preventing updates and deletes.
              Use the database directly or Prisma Studio to query the full audit trail.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
