"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useSyncProgram } from "@/components/layout/useSyncProgram";

// Must match prisma ExportType enum values
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
  const [lastExport, setLastExport] = useState<{ type: string; url: string; exportId?: string } | null>(null);

  // Email dispute pack modal
  const [emailTarget, setEmailTarget] = useState<{ type: string; exportId: string } | null>(null);
  const [emailTo, setEmailTo] = useState("");
  const [emailMessage, setEmailMessage] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  useSyncProgram();

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
      setLastExport({ type, url: data.signedUrl, exportId: data.id });
      if (data.signedUrl) window.open(data.signedUrl, "_blank");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setGenerating(null);
    }
  }

  async function sendExportEmail() {
    if (!emailTarget || !emailTo.trim()) return;
    setSendingEmail(true);
    setError("");
    try {
      const res = await fetch("/api/gateway/disputes/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          programId,
          exportId: emailTarget.exportId,
          recipientEmail: emailTo.trim(),
          message: emailMessage.trim() || undefined,
        }),
      });
      if (res.ok) {
        setEmailSent(true);
      } else {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "Failed to send email");
      }
    } catch {
      setError("Failed to send email");
    }
    setSendingEmail(false);
  }

  return (
    <div>
      <div>
        <p className="text-sm text-muted">Exports</p>
        <h1 className="text-2xl font-bold text-zinc-900">Export Center</h1>
        <p className="mt-1 text-sm text-zinc-500">Generate governance packs and dispute packets</p>
      </div>

      {error && <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {lastExport && (
        <div className="mt-4 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700 flex items-center justify-between">
          <span>
            Export generated successfully.{" "}
            <a href={lastExport.url} target="_blank" rel="noopener noreferrer" className="font-medium underline">
              Download PDF
            </a>
          </span>
          {lastExport.type === "DISPUTE_PACKET" && lastExport.exportId && (
            <button
              onClick={() => { setEmailTarget({ type: lastExport.type, exportId: lastExport.exportId! }); setEmailTo(""); setEmailMessage(""); setEmailSent(false); }}
              className="ml-3 rounded border border-green-600 px-2 py-1 text-xs font-medium text-green-700 hover:bg-green-100"
            >
              Email to Client
            </button>
          )}
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
              className="mt-4 w-full btn-primary disabled:opacity-50"
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

      {/* Email dispute pack modal */}
      {emailTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            {emailSent ? (
              <>
                <h3 className="text-lg font-semibold text-green-700">Email Sent</h3>
                <p className="mt-2 text-sm text-zinc-600">The dispute pack has been emailed to {emailTo}.</p>
                <div className="mt-4 flex justify-end">
                  <button onClick={() => setEmailTarget(null)} className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-800">Close</button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold text-zinc-900">Email Dispute Pack</h3>
                <p className="mt-1 text-sm text-zinc-500">Send the generated dispute pack PDF to a recipient.</p>
                <div className="mt-4 space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-zinc-700">Recipient email</label>
                    <input type="email" value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder="client@example.com" className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700">Message (optional)</label>
                    <textarea value={emailMessage} onChange={(e) => setEmailMessage(e.target.value)} rows={3} placeholder="Additional context for the recipient..." className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm" />
                  </div>
                </div>
                <div className="mt-5 flex gap-2 justify-end">
                  <button onClick={() => setEmailTarget(null)} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700">Cancel</button>
                  <button onClick={sendExportEmail} disabled={sendingEmail || !emailTo.trim()} className="rounded-md bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-500 disabled:opacity-50">
                    {sendingEmail ? "Sending..." : "Send Email"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
