"use client";

import { useState, useRef } from "react";

export default function ShadowConfirmModal({
  changeId,
  programId,
  onConfirmed,
  onClose,
}: {
  changeId: string;
  programId: string;
  onConfirmed: () => void;
  onClose: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setUploading(true);
    setError("");
    try {
      // Upload evidence
      const fd = new FormData();
      fd.append("file", file);
      fd.append("type", "EMAIL_APPROVAL");
      fd.append("programId", programId);
      const uploadRes = await fetch("/api/gateway/evidence", { method: "POST", body: fd });
      if (!uploadRes.ok) throw new Error("Upload failed");
      const evidence = await uploadRes.json();

      // Shadow confirm the change
      const res = await fetch(`/api/changes/${changeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmationMode: "SHADOW",
          shadowEvidenceId: evidence.id,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Confirmation failed");
      }

      onConfirmed();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-zinc-900">Confirm with Evidence</h3>
        <p className="mt-2 text-sm text-muted">
          Upload an email or document where the CDMO agreed to this change.
          The system will mark it as <span className="font-medium text-green-700">Confirmed (Shadow)</span> and lock it into the ledger.
        </p>

        {error && (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">{error}</div>
        )}

        <div
          className="mt-4 flex cursor-pointer flex-col items-center rounded-lg border-2 border-dashed border-zinc-300 bg-zinc-50 p-6 transition-colors hover:border-accent hover:bg-accent-light/10"
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? (
            <>
              <svg className="h-8 w-8 animate-spin text-accent" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
              <p className="mt-2 text-sm text-muted">Uploading and confirming...</p>
            </>
          ) : (
            <>
              <svg className="h-8 w-8 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
              <p className="mt-2 text-sm font-medium text-zinc-700">Click to upload evidence</p>
              <p className="mt-0.5 text-xs text-muted">PDF or image of email/approval</p>
            </>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
        </div>

        <div className="mt-4 flex justify-end">
          <button onClick={onClose} disabled={uploading} className="btn-secondary">Cancel</button>
        </div>
      </div>
    </div>
  );
}
