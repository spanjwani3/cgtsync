"use client";

import { useEffect, useState } from "react";

interface EmailData {
  id: string;
  toAddress: string;
  fromEmail: string;
  fromName: string | null;
  subject: string | null;
  textBody: string | null;
  detectedType: string;
  status: string;
  receivedAt: string;
  processedAt: string | null;
}

interface EvidenceData {
  id: string;
  type: string;
  fileName: string;
  createdAt: string;
}

export default function EmailViewerModal({
  evidenceId,
  onClose,
}: {
  evidenceId: string;
  onClose: () => void;
}) {
  const [email, setEmail] = useState<EmailData | null>(null);
  const [evidence, setEvidence] = useState<EvidenceData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/gateway/evidence/${evidenceId}/email-view`,
        );
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(body.error ?? `HTTP ${res.status}`);
        } else {
          setEmail(body.email);
          setEvidence(body.evidence);
        }
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load email");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [evidenceId]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 sm:p-8 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-zinc-400 hover:text-zinc-600"
          aria-label="Close"
        >
          <svg
            className="h-5 w-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {loading && (
          <div className="p-12 text-center text-sm text-zinc-500">
            Loading email…
          </div>
        )}

        {error && (
          <div className="p-8">
            <p className="text-sm text-red-600">Could not load email: {error}</p>
            <button
              onClick={onClose}
              className="mt-4 btn-secondary text-xs"
            >
              Close
            </button>
          </div>
        )}

        {email && evidence && (
          <>
            {/* Header */}
            <div className="border-b border-zinc-200 px-6 py-5">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-accent-light text-accent">
                  <svg
                    className="h-5 w-5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                    <polyline points="22,6 12,13 2,6" />
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-lg font-semibold text-zinc-900">
                    {email.subject ?? "(no subject)"}
                  </h2>
                  <p className="mt-0.5 text-xs text-muted">
                    Received via inbound email · classified as{" "}
                    <span className="font-medium">{email.detectedType}</span>
                  </p>
                </div>
                <StatusPill status={email.status} />
              </div>
            </div>

            {/* Metadata grid */}
            <div className="border-b border-zinc-200 bg-zinc-50/60 px-6 py-4 text-sm">
              <Row label="From">
                <span className="font-medium text-zinc-900">
                  {email.fromName || email.fromEmail.split("@")[0]}
                </span>
                <span className="text-muted"> &lt;{email.fromEmail}&gt;</span>
              </Row>
              <Row label="To">
                <span className="font-mono text-xs text-zinc-700">
                  {email.toAddress}
                </span>
              </Row>
              <Row label="Received">
                <span className="text-zinc-700">
                  {new Date(email.receivedAt).toLocaleString()}
                </span>
                {email.processedAt && (
                  <span className="ml-2 text-xs text-muted">
                    (processed{" "}
                    {Math.round(
                      (new Date(email.processedAt).getTime() -
                        new Date(email.receivedAt).getTime()) /
                        1000,
                    )}
                    s later)
                  </span>
                )}
              </Row>
            </div>

            {/* Body */}
            <div className="max-h-[60vh] overflow-y-auto px-6 py-5">
              {email.textBody ? (
                <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-zinc-800">
                  {email.textBody}
                </pre>
              ) : (
                <p className="text-sm italic text-muted">(empty body)</p>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-zinc-200 bg-zinc-50/60 px-6 py-3 text-xs text-muted">
              <span className="font-mono">{evidence.fileName}</span>
              <span>Evidence id: {evidence.id.slice(0, 8)}…</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3 py-1">
      <span className="w-20 shrink-0 text-xs uppercase tracking-wide text-zinc-500">
        {label}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    ROUTED: "bg-green-100 text-green-700",
    PROCESSING: "bg-blue-100 text-blue-700",
    NEEDS_REVIEW: "bg-amber-100 text-amber-700",
    FAILED: "bg-red-100 text-red-700",
    RECEIVED: "bg-zinc-100 text-zinc-700",
  };
  const cls = styles[status] ?? "bg-zinc-100 text-zinc-700";
  return (
    <span
      className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      {status}
    </span>
  );
}
