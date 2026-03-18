"use client";

import { useState, useEffect } from "react";

interface IngestAddress {
  id: string;
  address: string;
  label: string | null;
  isActive: boolean;
  createdAt: string;
}

interface IngestSetupProps {
  programId: string;
}

export default function IngestSetup({ programId }: IngestSetupProps) {
  const [address, setAddress] = useState<IngestAddress | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch(`/api/gateway/ingest-addresses?programId=${programId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const active = data?.addresses?.find((a: IngestAddress) => a.isActive);
        setAddress(active ?? null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [programId]);

  async function handleCreate() {
    setCreating(true);
    try {
      const res = await fetch("/api/gateway/ingest-addresses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ programId }),
      });
      if (res.ok) {
        const data = await res.json();
        setAddress(data.address);
      }
    } catch {
      // silently fail
    }
    setCreating(false);
  }

  async function handleDeactivate() {
    if (!address) return;
    const res = await fetch(`/api/gateway/ingest-addresses/${address.id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setAddress(null);
    }
  }

  function handleCopy() {
    if (!address) return;
    navigator.clipboard.writeText(address.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) {
    return <div className="text-xs text-muted">Loading...</div>;
  }

  if (!address) {
    return (
      <div className="card border-dashed border-zinc-300">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-blue-50">
            <svg className="h-5 w-5 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
              <polyline points="22,6 12,13 2,6" />
            </svg>
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-zinc-900">Email-In Ingestion</h3>
            <p className="mt-1 text-xs text-muted">
              Get a dedicated email address for this program. Forward meeting notes, change orders, or invoices — they&apos;ll be automatically classified and processed.
            </p>
            <button
              onClick={handleCreate}
              disabled={creating}
              className="mt-3 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-accent/90 disabled:opacity-50"
            >
              {creating ? "Setting up..." : "Set Up Email Ingestion"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-green-50">
            <svg className="h-5 w-5 text-green-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
              <polyline points="22,6 12,13 2,6" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-zinc-900">Email-In Ingestion</h3>
            <p className="mt-1 text-xs text-muted">Forward documents to this address for automatic processing</p>
          </div>
        </div>
        <button
          onClick={handleDeactivate}
          className="rounded-lg border border-zinc-200 px-2 py-1 text-[10px] font-medium text-zinc-500 transition-colors hover:bg-zinc-50 hover:text-red-600"
        >
          Deactivate
        </button>
      </div>

      <div className="mt-3 flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
        <code className="flex-1 text-sm font-medium text-zinc-700">{address.address}</code>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 rounded-md bg-white px-2 py-1 text-xs font-medium text-zinc-600 shadow-sm transition-colors hover:bg-zinc-100"
        >
          {copied ? (
            <>
              <svg className="h-3.5 w-3.5 text-green-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Copied!
            </>
          ) : (
            <>
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              Copy
            </>
          )}
        </button>
      </div>

      <div className="mt-3 rounded-lg bg-blue-50 p-3">
        <p className="text-xs font-medium text-blue-800">How to use:</p>
        <ul className="mt-1 space-y-1 text-xs text-blue-700">
          <li>Add this address to your Teams/Zoom meeting invite for automatic transcript capture</li>
          <li>Set up an Outlook/Gmail forwarding rule to auto-forward meeting recaps</li>
          <li>Forward change orders or invoices directly for processing</li>
        </ul>
      </div>
    </div>
  );
}
