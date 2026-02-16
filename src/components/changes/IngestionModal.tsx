"use client";

import { useState, useRef } from "react";
import { useExtractionPipeline } from "@/hooks/useExtractionPipeline";
import { useExtractionPipelineWithReview } from "@/hooks/useExtractionPipelineWithReview";
import ExtractionProgress from "@/components/ui/ExtractionProgress";
import CandidateReviewTable from "./CandidateReviewTable";

type EntryMode = "pick" | "meeting" | "email" | "document";

export default function IngestionModal({
  programId,
  onDone,
  onClose,
  onDraftManually,
}: {
  programId: string;
  onDone: () => void;
  onClose: () => void;
  onDraftManually: () => void;
}) {
  const [mode, setMode] = useState<EntryMode>("pick");
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const emailFileRef = useRef<HTMLInputElement>(null);
  const docFileRef = useRef<HTMLInputElement>(null);
  const meetingFileRef = useRef<HTMLInputElement>(null);

  // Transcript pipeline (multi-candidate with review)
  const transcript = useExtractionPipelineWithReview({
    programId,
    evidenceType: "TRANSCRIPT",
    targetType: "CHANGE_TRANSCRIPT",
    onSuccess: async () => { onDone(); },
    onError: () => {},
  });

  // Email pipeline (auto-apply)
  const email = useExtractionPipeline({
    programId,
    evidenceType: "EMAIL_APPROVAL",
    targetType: "CHANGE_EMAIL",
    prepareApplyBody: async () => ({}),
    onSuccess: async () => { onDone(); },
    onError: () => {},
  });

  // Document pipeline (auto-apply)
  const doc = useExtractionPipeline({
    programId,
    evidenceType: "CHANGE_ORDER",
    targetType: "CHANGE_ORDER",
    prepareApplyBody: async () => ({}),
    onSuccess: async () => { onDone(); },
    onError: () => {},
  });

  const isBusy =
    transcript.status !== "idle" && transcript.status !== "reviewing" && transcript.status !== "error" && transcript.status !== "done" ||
    email.status !== "idle" && email.status !== "error" && email.status !== "done" ||
    doc.status !== "idle" && doc.status !== "error" && doc.status !== "done";

  function handlePasteSubmit() {
    if (!pasteText.trim()) return;
    const blob = new File([pasteText], "meeting-notes.txt", { type: "text/plain" });
    transcript.run(blob);
  }

  // Extract candidates from transcript data
  const candidates = transcript.extractedData?.candidates as Array<{
    changeTitle: string;
    description?: string | null;
    severity?: string;
    estimatedImpact?: number | null;
    scheduleImpactDays?: number | null;
    speaker?: string | null;
    confidence: number;
  }> | undefined;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => !isBusy && onClose()}>
      <div className="w-full max-w-2xl rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-card-border px-6 py-4">
          <h3 className="text-lg font-semibold text-zinc-900">
            {mode === "pick" ? "Log Change Event" : mode === "meeting" ? "From Meeting" : mode === "email" ? "From Email" : "From Document"}
          </h3>
          {!isBusy && (
            <button onClick={onClose} className="text-muted hover:text-zinc-900">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          )}
        </div>

        <div className="p-6">
          {/* ─── Pick entry mode ─── */}
          {mode === "pick" && (
            <div>
              <p className="text-sm text-muted">How do you want to capture this change?</p>
              <div className="mt-4 grid grid-cols-3 gap-3">
                {/* Meeting */}
                <button
                  onClick={() => setMode("meeting")}
                  className="flex flex-col items-center rounded-lg border border-card-border p-4 text-center transition-all hover:border-accent hover:bg-accent-light/10"
                >
                  <svg className="h-8 w-8 text-purple-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                  <p className="mt-2 text-sm font-medium text-zinc-900">From Meeting</p>
                  <p className="mt-0.5 text-xs text-muted">Upload transcript or paste notes</p>
                </button>
                {/* Email */}
                <button
                  onClick={() => setMode("email")}
                  className="flex flex-col items-center rounded-lg border border-card-border p-4 text-center transition-all hover:border-accent hover:bg-accent-light/10"
                >
                  <svg className="h-8 w-8 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>
                  <p className="mt-2 text-sm font-medium text-zinc-900">From Email</p>
                  <p className="mt-0.5 text-xs text-muted">Upload email thread PDF</p>
                </button>
                {/* Document */}
                <button
                  onClick={() => setMode("document")}
                  className="flex flex-col items-center rounded-lg border border-card-border p-4 text-center transition-all hover:border-accent hover:bg-accent-light/10"
                >
                  <svg className="h-8 w-8 text-teal-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
                  <p className="mt-2 text-sm font-medium text-zinc-900">From Document</p>
                  <p className="mt-0.5 text-xs text-muted">Upload formal change order</p>
                </button>
              </div>
              <div className="mt-4 text-center">
                <button onClick={() => { onClose(); onDraftManually(); }} className="text-xs font-medium text-accent hover:text-accent-text">
                  Or draft manually
                </button>
              </div>
            </div>
          )}

          {/* ─── Meeting mode ─── */}
          {mode === "meeting" && transcript.status === "idle" && (
            <div>
              <div className="flex gap-2 mb-4">
                <button
                  onClick={() => setPasteMode(false)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${!pasteMode ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-600"}`}
                >
                  Upload File
                </button>
                <button
                  onClick={() => setPasteMode(true)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${pasteMode ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-600"}`}
                >
                  Paste Notes
                </button>
              </div>

              {!pasteMode ? (
                <div
                  className="flex cursor-pointer flex-col items-center rounded-lg border-2 border-dashed border-zinc-300 bg-zinc-50 p-8 transition-colors hover:border-accent hover:bg-accent-light/10"
                  onClick={() => meetingFileRef.current?.click()}
                >
                  <svg className="h-10 w-10 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                  <p className="mt-3 text-sm font-medium text-zinc-700">Upload a meeting transcript</p>
                  <p className="mt-1 text-xs text-muted">Teams, Zoom, or text files</p>
                  <input ref={meetingFileRef} type="file" accept=".pdf,.doc,.docx,.txt,.vtt,.srt" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) transcript.run(f); e.target.value = ""; }} />
                </div>
              ) : (
                <div>
                  <textarea
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                    placeholder="Paste your meeting notes here..."
                    className="input h-40 resize-none"
                    rows={6}
                  />
                  <button
                    onClick={handlePasteSubmit}
                    disabled={!pasteText.trim()}
                    className="btn-primary mt-3 disabled:opacity-50"
                  >
                    Extract Changes
                  </button>
                </div>
              )}

              <button onClick={() => setMode("pick")} className="mt-4 text-xs text-muted hover:text-zinc-700">
                &larr; Back
              </button>
            </div>
          )}

          {/* Meeting: extracting */}
          {mode === "meeting" && (transcript.status === "uploading" || transcript.status === "extracting") && (
            <div className="py-4">
              <ExtractionProgress status={transcript.status === "uploading" ? "uploading" : "extracting"} progress={transcript.progress} error={null} />
            </div>
          )}

          {/* Meeting: review candidates */}
          {mode === "meeting" && transcript.status === "reviewing" && candidates && (
            <CandidateReviewTable
              candidates={candidates}
              onApply={(indices) => transcript.applySelected(indices)}
              applying={false}
            />
          )}

          {/* Meeting: applying */}
          {mode === "meeting" && transcript.status === "applying" && (
            <div className="py-4">
              <ExtractionProgress status="applying" progress={transcript.progress} error={null} />
            </div>
          )}

          {/* Meeting: done */}
          {mode === "meeting" && transcript.status === "done" && (
            <div className="py-4">
              <ExtractionProgress status="done" progress={transcript.progress} error={null} />
            </div>
          )}

          {/* Meeting: error */}
          {mode === "meeting" && transcript.status === "error" && (
            <div className="py-4">
              <ExtractionProgress status="error" progress="" error={transcript.error} onDismissError={() => transcript.reset()} />
              <button onClick={() => setMode("pick")} className="mt-3 text-xs text-muted hover:text-zinc-700">
                &larr; Try a different source
              </button>
            </div>
          )}

          {/* ─── Email mode ─── */}
          {mode === "email" && email.status === "idle" && (
            <div>
              <p className="text-sm text-muted mb-4">Upload a PDF of the email thread where the vendor proposed a change.</p>
              <div
                className="flex cursor-pointer flex-col items-center rounded-lg border-2 border-dashed border-zinc-300 bg-zinc-50 p-8 transition-colors hover:border-accent hover:bg-accent-light/10"
                onClick={() => emailFileRef.current?.click()}
              >
                <svg className="h-10 w-10 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>
                <p className="mt-3 text-sm font-medium text-zinc-700">Upload email thread</p>
                <p className="mt-1 text-xs text-muted">PDF, image, or text</p>
                <input ref={emailFileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.txt" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) email.run(f); e.target.value = ""; }} />
              </div>
              <button onClick={() => setMode("pick")} className="mt-4 text-xs text-muted hover:text-zinc-700">
                &larr; Back
              </button>
            </div>
          )}

          {mode === "email" && email.status !== "idle" && (
            <div className="py-4">
              <ExtractionProgress status={email.status} progress={email.progress} error={email.error} onDismissError={() => email.reset()} />
              {email.status === "error" && (
                <button onClick={() => setMode("pick")} className="mt-3 text-xs text-muted hover:text-zinc-700">
                  &larr; Try a different source
                </button>
              )}
            </div>
          )}

          {/* ─── Document mode ─── */}
          {mode === "document" && doc.status === "idle" && (
            <div>
              <p className="text-sm text-muted mb-4">Upload a formal Change Order document from the CDMO.</p>
              <div
                className="flex cursor-pointer flex-col items-center rounded-lg border-2 border-dashed border-zinc-300 bg-zinc-50 p-8 transition-colors hover:border-accent hover:bg-accent-light/10"
                onClick={() => docFileRef.current?.click()}
              >
                <svg className="h-10 w-10 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                <p className="mt-3 text-sm font-medium text-zinc-700">Upload change order</p>
                <p className="mt-1 text-xs text-muted">PDF or document file</p>
                <input ref={docFileRef} type="file" accept=".pdf,.doc,.docx,.txt" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) doc.run(f); e.target.value = ""; }} />
              </div>
              <button onClick={() => setMode("pick")} className="mt-4 text-xs text-muted hover:text-zinc-700">
                &larr; Back
              </button>
            </div>
          )}

          {mode === "document" && doc.status !== "idle" && (
            <div className="py-4">
              <ExtractionProgress status={doc.status} progress={doc.progress} error={doc.error} onDismissError={() => doc.reset()} />
              {doc.status === "error" && (
                <button onClick={() => setMode("pick")} className="mt-3 text-xs text-muted hover:text-zinc-700">
                  &larr; Try a different source
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
