"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import StatusBadge from "@/components/ui/StatusBadge";
import { useSyncProgram } from "@/components/layout/useSyncProgram";
import { useExtractionPipeline } from "@/hooks/useExtractionPipeline";
import ExtractionProgress from "@/components/ui/ExtractionProgress";
import ContactSelector from "@/components/ui/ContactSelector";

interface Invoice {
  id: string;
  invoiceNumber: string | null;
  vendorName: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  totalAmount: string | null;
  currency: string;
  status: string;
  createdAt: string;
  _count?: { lineItems: number };
  reminderSchedule?: {
    id: string;
    isActive: boolean;
    nextSendAt: string | null;
    reminderCount: number;
    escalationTier: number;
  } | null;
}

export default function InvoicesPage() {
  const { programId } = useParams<{ programId: string }>();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({
    invoiceNumber: "",
    vendorName: "",
    invoiceDate: "",
    dueDate: "",
    totalAmount: "",
    currency: "USD",
  });
  const [file, setFile] = useState<File | null>(null);

  // Reminder modal
  const [reminderTarget, setReminderTarget] = useState<Invoice | null>(null);
  const [reminderEmail, setReminderEmail] = useState("");
  const [reminderFreq, setReminderFreq] = useState("14");
  const [savingReminder, setSavingReminder] = useState(false);

  // Dispute send modal
  const [disputeSendTarget, setDisputeSendTarget] = useState<Invoice | null>(null);
  const [disputeEmail, setDisputeEmail] = useState("");
  const [disputeMessage, setDisputeMessage] = useState("");
  const [sendingDispute, setSendingDispute] = useState(false);
  const [disputeSent, setDisputeSent] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const createdInvoiceIdRef = useRef<string | null>(null);
  const router = useRouter();

  useSyncProgram();

  const loadInvoicesRef = useRef<() => Promise<void>>(undefined);

  const extraction = useExtractionPipeline({
    programId,
    evidenceType: "INVOICE",
    targetType: "INVOICE",
    prepareApplyBody: async (_jobId, _extractedData) => {
      // Create an empty invoice to receive the extracted data
      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ programId }),
      });
      if (!res.ok) throw { step: "applying", message: "Failed to create invoice" };
      const invoice = await res.json();
      createdInvoiceIdRef.current = invoice.id;
      return { invoiceId: invoice.id };
    },
    onSuccess: async () => {
      await loadInvoicesRef.current?.();
      if (createdInvoiceIdRef.current) {
        router.push(`/programs/${programId}/invoices/${createdInvoiceIdRef.current}`);
      }
    },
    onError: (msg) => setError(msg),
  });

  const loadInvoices = useCallback(async () => {
    const res = await fetch(`/api/invoices?programId=${programId}`);
    if (res.ok) setInvoices(await res.json());
    setLoading(false);
  }, [programId]);
  loadInvoicesRef.current = loadInvoices;

  useEffect(() => {
    loadInvoices();
  }, [loadInvoices]);

  async function createInvoice() {
    setError("");
    setUploading(true);
    try {
      let evidenceFileId: string | undefined;

      // Upload file if provided
      if (file) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("type", "INVOICE");
        fd.append("programId", programId);
        const uploadRes = await fetch("/api/gateway/evidence", { method: "POST", body: fd });
        if (!uploadRes.ok) throw new Error("File upload failed");
        const evidence = await uploadRes.json();
        evidenceFileId = evidence.id;
      }

      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          programId,
          invoiceNumber: form.invoiceNumber || undefined,
          vendorName: form.vendorName || undefined,
          invoiceDate: form.invoiceDate || undefined,
          dueDate: form.dueDate || undefined,
          totalAmount: form.totalAmount ? parseFloat(form.totalAmount) : undefined,
          currency: form.currency,
          evidenceFileId,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      setForm({ invoiceNumber: "", vendorName: "", invoiceDate: "", dueDate: "", totalAmount: "", currency: "USD" });
      setFile(null);
      setShowNew(false);
      await loadInvoices();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setUploading(false);
    }
  }

  async function generateDisputePacket(invoiceId: string) {
    const res = await fetch("/api/gateway/disputes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invoiceId }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.signedUrl) window.open(data.signedUrl, "_blank");
      await loadInvoices();
    } else {
      setError("Failed to generate dispute packet");
    }
  }

  async function createReminderSchedule() {
    if (!reminderTarget || !reminderEmail.trim()) return;
    setSavingReminder(true);
    setError("");
    try {
      const res = await fetch("/api/gateway/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          programId,
          invoiceId: reminderTarget.id,
          recipientEmail: reminderEmail.trim(),
          frequencyDays: parseInt(reminderFreq) || 14,
        }),
      });
      if (res.ok) {
        setReminderTarget(null);
        setReminderEmail("");
        await loadInvoices();
      } else {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "Failed to create reminder");
      }
    } catch {
      setError("Failed to create reminder");
    }
    setSavingReminder(false);
  }

  async function toggleReminder(scheduleId: string, action: "pause" | "resume") {
    await fetch(`/api/gateway/reminders/${scheduleId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    await loadInvoices();
  }

  async function sendDisputeEmail() {
    if (!disputeSendTarget || !disputeEmail.trim()) return;
    setSendingDispute(true);
    setError("");
    try {
      // Find the latest dispute export for this invoice
      const exportsRes = await fetch(`/api/gateway/exports?programId=${programId}&type=DISPUTE_PACKET`);
      const exports = exportsRes.ok ? await exportsRes.json() : [];
      const latestExport = Array.isArray(exports) ? exports[0] : null;

      if (!latestExport) {
        setError("No dispute pack found. Generate one first.");
        setSendingDispute(false);
        return;
      }

      const res = await fetch("/api/gateway/disputes/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          programId,
          invoiceId: disputeSendTarget.id,
          exportId: latestExport.id,
          recipientEmail: disputeEmail.trim(),
          recipientName: undefined,
          message: disputeMessage.trim() || undefined,
        }),
      });

      if (res.ok) {
        setDisputeSent(true);
      } else {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "Failed to send dispute");
      }
    } catch {
      setError("Failed to send dispute");
    }
    setSendingDispute(false);
  }

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="flex items-center gap-3 text-sm text-muted">
        <svg className="h-5 w-5 animate-spin text-accent" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
        Loading invoices...
      </div>
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted">Reconciliation</p>
          <h1 className="mt-0.5 text-2xl font-bold text-zinc-900">Invoice Reconciliation</h1>
          <p className="mt-1 text-sm text-muted">Economic Defense: upload, map, flag, dispute</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => fileRef.current?.click()} disabled={extraction.status !== "idle"} className="btn-primary disabled:opacity-50">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
            Upload Invoice
          </button>
          <input ref={fileRef} type="file" accept=".pdf,.xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) extraction.run(f); e.target.value = ""; }} />
          <button onClick={() => setShowNew(true)} className="btn-secondary">
            Enter Manually
          </button>
        </div>
      </div>

      {error && <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {/* Extraction progress */}
      <ExtractionProgress status={extraction.status} progress={extraction.progress} error={extraction.error} onDismissError={extraction.reset} />

      {showNew && (
        <div className="mt-4 rounded-lg border border-card-border bg-card-bg p-4 space-y-3">
          <h3 className="text-sm font-medium text-zinc-900">New Invoice</h3>
          <div className="grid grid-cols-2 gap-3">
            <input placeholder="Invoice number" value={form.invoiceNumber} onChange={(e) => setForm({ ...form, invoiceNumber: e.target.value })} className="rounded-md border border-zinc-300 px-3 py-2 text-sm" />
            <input placeholder="Vendor name" value={form.vendorName} onChange={(e) => setForm({ ...form, vendorName: e.target.value })} className="rounded-md border border-zinc-300 px-3 py-2 text-sm" />
            <input type="date" value={form.invoiceDate} onChange={(e) => setForm({ ...form, invoiceDate: e.target.value })} className="rounded-md border border-zinc-300 px-3 py-2 text-sm" title="Invoice date" />
            <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className="rounded-md border border-zinc-300 px-3 py-2 text-sm" title="Due date" />
            <input type="number" placeholder="Total amount" value={form.totalAmount} onChange={(e) => setForm({ ...form, totalAmount: e.target.value })} className="rounded-md border border-zinc-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-500 mb-1">Attach invoice document</label>
            <input type="file" accept=".pdf,.xlsx,.xls,.csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
          </div>
          <div className="flex gap-2">
            <button onClick={createInvoice} disabled={uploading} className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-800 disabled:opacity-50">
              {uploading ? "Uploading..." : "Create Invoice"}
            </button>
            <button onClick={() => setShowNew(false)} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700">Cancel</button>
          </div>
        </div>
      )}

      <div className="mt-6">
        <table className="w-full">
          <thead>
            <tr>
              <th>Invoice #</th>
              <th>Vendor</th>
              <th>Date</th>
              <th>Due Date</th>
              <th>Amount</th>
              <th>Lines</th>
              <th>Status</th>
              <th>Reminders</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <tr key={inv.id}>
                <td>
                  <Link href={`/programs/${programId}/invoices/${inv.id}`} className="font-medium text-zinc-900 hover:underline">
                    {inv.invoiceNumber ?? "N/A"}
                  </Link>
                </td>
                <td className="text-sm">{inv.vendorName ?? "—"}</td>
                <td className="text-sm text-zinc-500">
                  {inv.invoiceDate ? new Date(inv.invoiceDate).toLocaleDateString() : "—"}
                </td>
                <td className="text-sm text-zinc-500">
                  {inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : "—"}
                </td>
                <td className="font-mono text-sm">
                  {inv.totalAmount ? `${inv.currency} ${Number(inv.totalAmount).toLocaleString()}` : "—"}
                </td>
                <td className="text-sm text-zinc-500">{inv._count?.lineItems ?? 0}</td>
                <td><StatusBadge status={inv.status} /></td>
                <td className="text-xs">
                  {inv.reminderSchedule ? (
                    <div className="flex flex-col gap-1">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${inv.reminderSchedule.isActive ? "bg-green-50 text-green-700" : "bg-zinc-100 text-zinc-500"}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${inv.reminderSchedule.isActive ? "bg-green-500" : "bg-zinc-400"}`} />
                        {inv.reminderSchedule.isActive ? "Active" : "Paused"}
                      </span>
                      <span className="text-zinc-400">
                        Tier {inv.reminderSchedule.escalationTier} · {inv.reminderSchedule.reminderCount} sent
                      </span>
                      <button
                        onClick={() => toggleReminder(inv.reminderSchedule!.id, inv.reminderSchedule!.isActive ? "pause" : "resume")}
                        className="text-left text-accent hover:underline"
                      >
                        {inv.reminderSchedule.isActive ? "Pause" : "Resume"}
                      </button>
                    </div>
                  ) : inv.dueDate ? (
                    <button onClick={() => { setReminderTarget(inv); setReminderEmail(""); setReminderFreq("14"); }} className="text-accent hover:underline">
                      Set up
                    </button>
                  ) : (
                    <span className="text-zinc-400">—</span>
                  )}
                </td>
                <td>
                  <div className="flex gap-1">
                    <Link href={`/programs/${programId}/invoices/${inv.id}`} className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-50">
                      Details
                    </Link>
                    {(inv.status === "FLAGGED" || inv.status === "MAPPED") && (
                      <>
                        <button onClick={() => generateDisputePacket(inv.id)} className="rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-500">
                          Dispute
                        </button>
                        <button onClick={() => { setDisputeSendTarget(inv); setDisputeEmail(""); setDisputeMessage(""); setDisputeSent(false); }} className="rounded border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50">
                          Send
                        </button>
                      </>
                    )}
                    {inv.status === "APPROVED" && (
                      <button
                        onClick={async () => {
                          try {
                            const res = await fetch("/api/gateway/certificate", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ programId, entityType: "INVOICE", entityId: inv.id }),
                            });
                            if (res.ok) {
                              const blob = await res.blob();
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement("a");
                              a.href = url;
                              a.download = `certificate-invoice-${inv.invoiceNumber ?? inv.id.slice(0, 8)}.pdf`;
                              a.click();
                              URL.revokeObjectURL(url);
                            }
                          } catch { /* silent */ }
                        }}
                        className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-50"
                        title="Download Certificate"
                      >
                        Certificate
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {invoices.length === 0 && (
              <tr><td colSpan={9} className="py-12 text-center">
                <p className="text-sm text-zinc-400">No invoices uploaded yet</p>
                <p className="mt-1 text-xs text-zinc-400">Upload an invoice PDF to auto-extract line items, or enter details manually.</p>
                <button onClick={() => fileRef.current?.click()} disabled={extraction.status !== "idle"} className="btn-primary mt-3 disabled:opacity-50">Upload Invoice</button>
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Reminder setup modal */}
      {reminderTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-zinc-900">Set Up Payment Reminders</h3>
            <p className="mt-1 text-sm text-zinc-500">
              Invoice {reminderTarget.invoiceNumber ?? "N/A"} — Due {reminderTarget.dueDate ? new Date(reminderTarget.dueDate).toLocaleDateString() : "N/A"}
            </p>
            <div className="mt-4 space-y-3">
              <ContactSelector
                programId={programId}
                value={reminderEmail}
                onChange={(email) => setReminderEmail(email)}
                label="Recipient email"
                placeholder="vendor@example.com"
              />
              <div>
                <label className="block text-sm font-medium text-zinc-700">Frequency (days)</label>
                <select value={reminderFreq} onChange={(e) => setReminderFreq(e.target.value)} className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm">
                  <option value="7">Every 7 days</option>
                  <option value="14">Every 14 days</option>
                  <option value="30">Every 30 days</option>
                </select>
              </div>
            </div>
            <div className="mt-5 flex gap-2 justify-end">
              <button onClick={() => setReminderTarget(null)} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700">Cancel</button>
              <button onClick={createReminderSchedule} disabled={savingReminder || !reminderEmail.trim()} className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-800 disabled:opacity-50">
                {savingReminder ? "Saving..." : "Create Schedule"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dispute send modal */}
      {disputeSendTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            {disputeSent ? (
              <>
                <h3 className="text-lg font-semibold text-green-700">Dispute Pack Sent</h3>
                <p className="mt-2 text-sm text-zinc-600">The dispute pack has been emailed to {disputeEmail}.</p>
                <div className="mt-4 flex justify-end">
                  <button onClick={() => setDisputeSendTarget(null)} className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-800">Close</button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold text-zinc-900">Email Dispute Pack</h3>
                <p className="mt-1 text-sm text-zinc-500">
                  Invoice {disputeSendTarget.invoiceNumber ?? "N/A"}
                </p>
                <div className="mt-4 space-y-3">
                  <ContactSelector
                    programId={programId}
                    value={disputeEmail}
                    onChange={(email) => setDisputeEmail(email)}
                    label="Recipient email"
                    placeholder="client@example.com"
                    contactType="CLIENT"
                  />
                  <div>
                    <label className="block text-sm font-medium text-zinc-700">Message (optional)</label>
                    <textarea value={disputeMessage} onChange={(e) => setDisputeMessage(e.target.value)} rows={3} placeholder="Additional context for the recipient..." className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm" />
                  </div>
                </div>
                <div className="mt-5 flex gap-2 justify-end">
                  <button onClick={() => setDisputeSendTarget(null)} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700">Cancel</button>
                  <button onClick={sendDisputeEmail} disabled={sendingDispute || !disputeEmail.trim()} className="rounded-md bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-500 disabled:opacity-50">
                    {sendingDispute ? "Sending..." : "Send Dispute Pack"}
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
