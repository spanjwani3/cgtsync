"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import StatusBadge from "@/components/ui/StatusBadge";

interface Invoice {
  id: string;
  invoiceNumber: string | null;
  vendorName: string | null;
  invoiceDate: string | null;
  totalAmount: string | null;
  currency: string;
  status: string;
  createdAt: string;
  _count?: { lineItems: number };
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
    totalAmount: "",
    currency: "USD",
  });
  const [file, setFile] = useState<File | null>(null);

  const loadInvoices = useCallback(async () => {
    const res = await fetch(`/api/invoices?programId=${programId}`);
    if (res.ok) setInvoices(await res.json());
    setLoading(false);
  }, [programId]);

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
          totalAmount: form.totalAmount ? parseFloat(form.totalAmount) : undefined,
          currency: form.currency,
          evidenceFileId,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      setForm({ invoiceNumber: "", vendorName: "", invoiceDate: "", totalAmount: "", currency: "USD" });
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

  if (loading) return <div className="py-8 text-sm text-zinc-500">Loading invoices...</div>;

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">Invoice Reconciliation</h1>
          <p className="mt-1 text-sm text-zinc-500">Economic Defense: upload, map, flag, dispute</p>
        </div>
        <button onClick={() => setShowNew(true)} className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800">
          Upload Invoice
        </button>
      </div>

      {error && <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {showNew && (
        <div className="mt-4 rounded-lg border border-card-border bg-card-bg p-4 space-y-3">
          <h3 className="text-sm font-medium text-zinc-900">New Invoice</h3>
          <div className="grid grid-cols-2 gap-3">
            <input placeholder="Invoice number" value={form.invoiceNumber} onChange={(e) => setForm({ ...form, invoiceNumber: e.target.value })} className="rounded-md border border-zinc-300 px-3 py-2 text-sm" />
            <input placeholder="Vendor name" value={form.vendorName} onChange={(e) => setForm({ ...form, vendorName: e.target.value })} className="rounded-md border border-zinc-300 px-3 py-2 text-sm" />
            <input type="date" value={form.invoiceDate} onChange={(e) => setForm({ ...form, invoiceDate: e.target.value })} className="rounded-md border border-zinc-300 px-3 py-2 text-sm" />
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
              <th>Amount</th>
              <th>Lines</th>
              <th>Status</th>
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
                <td className="font-mono text-sm">
                  {inv.totalAmount ? `${inv.currency} ${Number(inv.totalAmount).toLocaleString()}` : "—"}
                </td>
                <td className="text-sm text-zinc-500">{inv._count?.lineItems ?? 0}</td>
                <td><StatusBadge status={inv.status} /></td>
                <td>
                  <div className="flex gap-1">
                    <Link href={`/programs/${programId}/invoices/${inv.id}`} className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-50">
                      Details
                    </Link>
                    {(inv.status === "FLAGGED" || inv.status === "MAPPED") && (
                      <button onClick={() => generateDisputePacket(inv.id)} className="rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-500">
                        Dispute
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {invoices.length === 0 && (
              <tr><td colSpan={7} className="py-8 text-center text-sm text-zinc-400">No invoices uploaded yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
