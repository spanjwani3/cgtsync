"use client";

import { useState } from "react";
import { useParams } from "next/navigation";

const EXPORT_TYPES = [
  { type: "BASELINE_PACK", label: "Baseline Pack", description: "All baselines with clauses and status" },
  { type: "CHANGE_LEDGER_PACK", label: "Change Ledger Pack", description: "Complete change ledger with severity and impact" },
  { type: "INVOICE_REVIEW_PACK", label: "Invoice Review Pack", description: "All invoices with line items and flags" },
  { type: "DISPUTE_PACKET", label: "Dispute Packet", description: "Flagged line items with evidence references" },
  { type: "WEEKLY_GOVERNANCE_PACK", label: "Weekly Governance Pack", description: "Last 7 days: changes, flags, and timeline" },
];

export default function ExportsPage() {
  const { programId } = useParams<{ programId: string }>();
  const [generating, setGenerating] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [lastExport, setLastExport] = useState<{ type: string; url: string } | null>(null);

  async function generateExport(type: string) {
    setGenerating(type);
    setError("");
    setLastExport(null);
    try {
      const res = await fetch("/api/gateway/exports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ programId, type }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Export failed");
      const data = await res.json();
      setLastExport({ type, url: data.signedUrl });
      if (data.signedUrl) window.open(data.signedUrl, "_blank");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setGenerating(null);
    }
  }

  return (
    <div>
      <div>
        <h1 className="text-xl font-semibold text-zinc-900">Export Center</h1>
        <p className="mt-1 text-sm text-zinc-500">Generate governance packs and dispute packets</p>
      </div>

      {error && <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {lastExport && (
        <div className="mt-4 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700">
          Export generated successfully.{" "}
          <a href={lastExport.url} target="_blank" rel="noopener noreferrer" className="font-medium underline">
            Download PDF
          </a>
        </div>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {EXPORT_TYPES.map((exp) => (
          <div key={exp.type} className="rounded-lg border border-card-border bg-card-bg p-5">
            <h3 className="font-medium text-zinc-900">{exp.label}</h3>
            <p className="mt-1 text-sm text-zinc-500">{exp.description}</p>
            <button
              onClick={() => generateExport(exp.type)}
              disabled={generating !== null}
              className="mt-4 w-full rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {generating === exp.type ? "Generating..." : "Generate PDF"}
            </button>
          </div>
        ))}
      </div>

      <div className="mt-8 rounded-lg border border-card-border bg-card-bg p-5">
        <h3 className="text-sm font-medium text-zinc-700">About Exports</h3>
        <ul className="mt-2 space-y-1 text-sm text-zinc-500">
          <li>All exports are generated server-side with SHA-256 hash verification</li>
          <li>PDFs are stored in private Supabase storage with signed URL access</li>
          <li>Each export generation is logged in the immutable event log</li>
          <li>Signed URLs expire after 5 minutes for security</li>
        </ul>
      </div>
    </div>
  );
}
