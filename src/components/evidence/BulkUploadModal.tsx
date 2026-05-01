"use client";

import { useState, useRef } from "react";

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

interface FileEntry {
  file: File;
  type: string;
  originalDate: string;
  description: string;
}

interface BulkUploadModalProps {
  programId: string;
  onClose: () => void;
  onComplete: () => void;
}

export default function BulkUploadModal({ programId, onClose, onComplete }: BulkUploadModalProps) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, fileName: "" });
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function addFiles(fileList: FileList | File[]) {
    const newEntries: FileEntry[] = Array.from(fileList).map((f) => ({
      file: f,
      type: "OTHER",
      originalDate: "",
      description: "",
    }));
    setFiles((prev) => [...prev, ...newEntries]);
  }

  function updateFile(index: number, field: keyof FileEntry, value: string) {
    setFiles((prev) => prev.map((f, i) => (i === index ? { ...f, [field]: value } : f)));
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(true);
  }

  function canUpload(): boolean {
    return files.length > 0 && files.every((f) => f.type && f.originalDate);
  }

  async function handleUploadAll() {
    if (!canUpload()) return;
    setUploading(true);
    setError("");
    let successCount = 0;

    for (let i = 0; i < files.length; i++) {
      const entry = files[i];
      setProgress({ current: i + 1, total: files.length, fileName: entry.file.name });
      try {
        const fd = new FormData();
        fd.append("file", entry.file);
        fd.append("type", entry.type);
        fd.append("programId", programId);
        fd.append("originalDate", new Date(entry.originalDate).toISOString());

        const res = await fetch("/api/gateway/evidence", { method: "POST", body: fd });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error ?? `Upload failed for ${entry.file.name}`);
        }
        successCount++;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed");
        setUploading(false);
        return;
      }
    }

    setUploading(false);
    if (successCount === files.length) {
      onComplete();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[80vh] overflow-y-auto rounded-xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-zinc-900">Backload Historical Evidence</h3>
        <p className="mt-1 text-sm text-zinc-500">
          Upload historical documents with their original dates preserved.
        </p>

        {error && (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}

        {/* Drop Zone */}
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={() => setDragOver(false)}
          className={`mt-4 flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors ${
            dragOver ? "border-blue-400 bg-blue-50" : "border-zinc-300 bg-zinc-50"
          }`}
        >
          <svg className="h-8 w-8 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <p className="mt-2 text-sm text-zinc-600">Drag & drop files here, or</p>
          <button
            onClick={() => inputRef.current?.click()}
            className="mt-2 rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800"
          >
            Browse Files
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }}
          />
          <p className="mt-2 text-xs text-zinc-400">PDF, DOCX, XLSX, PNG, JPG, EML supported</p>
        </div>

        {/* File List */}
        {files.length > 0 && (
          <div className="mt-4 space-y-3">
            {files.map((entry, i) => (
              <div key={i} className="rounded-md border border-zinc-200 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-zinc-900 truncate max-w-[300px]">
                    {entry.file.name}
                  </span>
                  <button
                    onClick={() => removeFile(i)}
                    className="text-xs text-zinc-400 hover:text-red-500"
                    disabled={uploading}
                  >
                    Remove
                  </button>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-xs text-zinc-500">Type *</label>
                    <select
                      value={entry.type}
                      onChange={(e) => updateFile(i, "type", e.target.value)}
                      className="mt-0.5 w-full rounded-md border border-zinc-300 px-2 py-1.5 text-xs"
                      disabled={uploading}
                    >
                      {EVIDENCE_TYPES.map((t) => (
                        <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-zinc-500">Original Date *</label>
                    <input
                      type="date"
                      value={entry.originalDate}
                      onChange={(e) => updateFile(i, "originalDate", e.target.value)}
                      className="mt-0.5 w-full rounded-md border border-zinc-300 px-2 py-1.5 text-xs"
                      disabled={uploading}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-zinc-500">Description</label>
                    <input
                      type="text"
                      value={entry.description}
                      onChange={(e) => updateFile(i, "description", e.target.value)}
                      placeholder="Optional note"
                      className="mt-0.5 w-full rounded-md border border-zinc-300 px-2 py-1.5 text-xs"
                      disabled={uploading}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Progress */}
        {uploading && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-zinc-500">
              <span>Uploading {progress.current} of {progress.total}: {progress.fileName}</span>
              <span>{Math.round((progress.current / progress.total) * 100)}%</span>
            </div>
            <div className="mt-1 h-2 w-full rounded-full bg-zinc-200">
              <div
                className="h-2 rounded-full bg-zinc-900 transition-all"
                style={{ width: `${(progress.current / progress.total) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Validation warning */}
        {files.length > 0 && !canUpload() && !uploading && (
          <p className="mt-3 text-xs text-amber-600">
            All files must have a type and original date before uploading.
          </p>
        )}

        {/* Actions */}
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={uploading}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleUploadAll}
            disabled={!canUpload() || uploading}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {uploading ? "Uploading..." : `Upload ${files.length} File${files.length !== 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}
