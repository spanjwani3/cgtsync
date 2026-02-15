"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import StatusBadge from "@/components/ui/StatusBadge";

interface LineItem {
  id: string;
  description: string;
  quantity: string | null;
  unitPrice: string | null;
  amount: string;
  flag: string;
  flagNote: string | null;
  clause?: { title: string; clauseRef: string | null; value: string | null } | null;
  change?: { title: string; sequenceNum: number } | null;
}

interface Invoice {
  id: string;
  invoiceNumber: string | null;
  vendorName: string | null;
  invoiceDate: string | null;
  totalAmount: string | null;
  currency: string;
  status: string;
  lineItems: LineItem[];
}

export default function InvoiceDetailPage() {
  const { programId, invoiceId } = useParams<{ programId: string; invoiceId: string }>();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddLine, setShowAddLine] = useState(false);
  const [error, setError] = useState("");
  const [lineForm, setLineForm] = useState({
    description: "",
    quantity: "",
    unitPrice: "",
    amount: "",
    clauseId: "",
    changeId: "",
  });
  const [clauses, setClauses] = useState<Array<{ id: string; title: string; clauseRef: string | null; value: string | null }>>([]);
  const [changes, setChanges] = useState<Array<{ id: string; title: string; sequenceNum: number }>>([]);
  const [flaggingId, setFlaggingId] = useState<string | null>(null);

  const loadInvoice = useCallback(async () => {
    const res = await fetch(`/api/invoices/${invoiceId}`);
    if (res.ok) setInvoice(await res.json());
    setLoading(false);
  }, [invoiceId]);

  useEffect(() => {
    loadInvoice();
    // Load clauses and changes for mapping
    fetch(`/api/baselines?programId=${programId}`).then(async (res) => {
      if (res.ok) {
        const baselines = await res.json();
        const allClauses: typeof clauses = [];
        for (const b of baselines) {
          if (b.status === "LOCKED" || b.status === "CONFIRMED") {
            const cRes = await fetch(`/api/baselines/${b.id}`);
            if (cRes.ok) {
              const detail = await cRes.json();
              allClauses.push(...(detail.clauses ?? []));
            }
          }
        }
        setClauses(allClauses);
      }
    });
    fetch(`/api/changes?programId=${programId}`).then(async (res) => {
      if (res.ok) setChanges(await res.json());
    });
  }, [loadInvoice, programId]);

  async function addLineItem() {
    if (!lineForm.description || !lineForm.amount) return;
    setError("");
    const res = await fetch(`/api/invoices/${invoiceId}/line-items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: lineForm.description,
        quantity: lineForm.quantity ? parseFloat(lineForm.quantity) : undefined,
        unitPrice: lineForm.unitPrice ? parseFloat(lineForm.unitPrice) : undefined,
        amount: parseFloat(lineForm.amount),
        clauseId: lineForm.clauseId || undefined,
        changeId: lineForm.changeId || undefined,
      }),
    });
    if (res.ok) {
      setLineForm({ description: "", quantity: "", unitPrice: "", amount: "", clauseId: "", changeId: "" });
      setShowAddLine(false);
      await loadInvoice();
    } else {
      const data = await res.json();
      setError(data.error || "Failed to add line item");
    }
  }

  async function updateStatus(status: string) {
    const res = await fetch(`/api/invoices/${invoiceId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) await loadInvoice();
  }

  const FLAG_OPTIONS = ["NONE", "RATE_MISMATCH", "SCOPE_CREEP", "UNAPPROVED_CHANGE", "DUPLICATE", "MISSING_BASELINE", "OTHER"] as const;

  async function updateFlag(lineItemId: string, flag: string) {
    setFlaggingId(lineItemId);
    const flagNote = flag === "NONE" ? null : prompt("Flag note (optional):");
    const res = await fetch(`/api/invoices/${invoiceId}/line-items`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lineItemId, flag, flagNote }),
    });
    if (res.ok) await loadInvoice();
    setFlaggingId(null);
  }

  if (loading) return <div className="py-8 text-sm text-zinc-500">Loading invoice...</div>;
  if (!invoice) return <div className="py-8 text-sm text-red-500">Invoice not found</div>;

  const flaggedCount = invoice.lineItems.filter((li) => li.flag !== "NONE").length;
  const lineTotal = invoice.lineItems.reduce((sum, li) => sum + Number(li.amount), 0);

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">
            Invoice: {invoice.invoiceNumber ?? "N/A"}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            {invoice.vendorName ?? "Unknown vendor"} · {invoice.currency} {invoice.totalAmount ? Number(invoice.totalAmount).toLocaleString() : "N/A"}
          </p>
        </div>
        <StatusBadge status={invoice.status} />
      </div>

      {error && <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {/* Summary cards */}
      <div className="mt-6 grid grid-cols-4 gap-4">
        <div className="rounded-lg border border-card-border bg-card-bg p-4">
          <p className="text-xs font-medium text-zinc-500">Line Items</p>
          <p className="mt-1 text-2xl font-semibold text-zinc-900">{invoice.lineItems.length}</p>
        </div>
        <div className="rounded-lg border border-card-border bg-card-bg p-4">
          <p className="text-xs font-medium text-zinc-500">Flagged</p>
          <p className={`mt-1 text-2xl font-semibold ${flaggedCount > 0 ? "text-red-600" : "text-green-600"}`}>{flaggedCount}</p>
        </div>
        <div className="rounded-lg border border-card-border bg-card-bg p-4">
          <p className="text-xs font-medium text-zinc-500">Line Total</p>
          <p className="mt-1 text-2xl font-semibold text-zinc-900">{invoice.currency} {lineTotal.toLocaleString()}</p>
        </div>
        <div className="rounded-lg border border-card-border bg-card-bg p-4">
          <p className="text-xs font-medium text-zinc-500">Variance</p>
          <p className={`mt-1 text-2xl font-semibold ${
            invoice.totalAmount && Math.abs(lineTotal - Number(invoice.totalAmount)) > 0.01 ? "text-red-600" : "text-green-600"
          }`}>
            {invoice.totalAmount ? `${invoice.currency} ${(lineTotal - Number(invoice.totalAmount)).toLocaleString()}` : "—"}
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="mt-4 flex gap-2">
        <button onClick={() => setShowAddLine(true)} className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800">
          Add Line Item
        </button>
        {invoice.status === "UPLOADED" && invoice.lineItems.length > 0 && (
          <button onClick={() => updateStatus("MAPPED")} className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500">
            Mark as Mapped
          </button>
        )}
        {invoice.status === "MAPPED" && flaggedCount > 0 && (
          <button onClick={() => updateStatus("FLAGGED")} className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-500">
            Mark as Flagged
          </button>
        )}
        {(invoice.status === "MAPPED" || invoice.status === "FLAGGED") && (
          <button onClick={() => updateStatus("APPROVED")} className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-500">
            Approve
          </button>
        )}
      </div>

      {/* Add line item form */}
      {showAddLine && (
        <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4 space-y-3">
          <h3 className="text-sm font-medium text-zinc-900">Add Line Item</h3>
          <input placeholder="Description *" value={lineForm.description} onChange={(e) => setLineForm({ ...lineForm, description: e.target.value })} className="block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm" />
          <div className="grid grid-cols-3 gap-3">
            <input type="number" placeholder="Quantity" value={lineForm.quantity} onChange={(e) => setLineForm({ ...lineForm, quantity: e.target.value })} className="rounded-md border border-zinc-300 px-3 py-2 text-sm" />
            <input type="number" placeholder="Unit price" value={lineForm.unitPrice} onChange={(e) => setLineForm({ ...lineForm, unitPrice: e.target.value })} className="rounded-md border border-zinc-300 px-3 py-2 text-sm" />
            <input type="number" placeholder="Amount *" value={lineForm.amount} onChange={(e) => setLineForm({ ...lineForm, amount: e.target.value })} className="rounded-md border border-zinc-300 px-3 py-2 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Map to Baseline Clause</label>
              <select value={lineForm.clauseId} onChange={(e) => setLineForm({ ...lineForm, clauseId: e.target.value })} className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm">
                <option value="">— None —</option>
                {clauses.map((c) => (
                  <option key={c.id} value={c.id}>{c.clauseRef ? `${c.clauseRef}: ` : ""}{c.title}{c.value ? ` ($${Number(c.value).toLocaleString()})` : ""}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Map to Change Order</label>
              <select value={lineForm.changeId} onChange={(e) => setLineForm({ ...lineForm, changeId: e.target.value })} className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm">
                <option value="">— None —</option>
                {changes.map((c) => (
                  <option key={c.id} value={c.id}>#{c.sequenceNum}: {c.title}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={addLineItem} className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-800">Add</button>
            <button onClick={() => setShowAddLine(false)} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700">Cancel</button>
          </div>
        </div>
      )}

      {/* Line items table */}
      <div className="mt-6">
        <table className="w-full">
          <thead>
            <tr>
              <th>Description</th>
              <th>Qty</th>
              <th>Unit Price</th>
              <th>Amount</th>
              <th>Mapped To</th>
              <th>Flag</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lineItems.map((li) => (
              <tr key={li.id} className={li.flag !== "NONE" ? "bg-red-50/50" : ""}>
                <td className="font-medium text-zinc-900">{li.description}</td>
                <td className="font-mono text-sm">{li.quantity ?? "—"}</td>
                <td className="font-mono text-sm">{li.unitPrice ? `$${Number(li.unitPrice).toLocaleString()}` : "—"}</td>
                <td className="font-mono text-sm font-medium">${Number(li.amount).toLocaleString()}</td>
                <td className="text-xs">
                  {li.clause && <span className="text-blue-600">{li.clause.clauseRef ?? li.clause.title}</span>}
                  {li.change && <span className="text-purple-600">Change #{li.change.sequenceNum}</span>}
                  {!li.clause && !li.change && <span className="text-zinc-400">Unmapped</span>}
                </td>
                <td>
                  <div className="flex items-center gap-1">
                    <select
                      value={li.flag}
                      onChange={(e) => updateFlag(li.id, e.target.value)}
                      disabled={flaggingId === li.id}
                      className={`rounded border px-1.5 py-0.5 text-xs ${
                        li.flag !== "NONE" ? "border-red-300 bg-red-50 text-red-700" : "border-zinc-200 text-zinc-500"
                      }`}
                    >
                      {FLAG_OPTIONS.map((f) => (
                        <option key={f} value={f}>{f === "NONE" ? "OK" : f.replace(/_/g, " ")}</option>
                      ))}
                    </select>
                  </div>
                  {li.flagNote && <p className="mt-0.5 text-xs text-red-600">{li.flagNote}</p>}
                </td>
              </tr>
            ))}
            {invoice.lineItems.length === 0 && (
              <tr><td colSpan={6} className="py-8 text-center text-sm text-zinc-400">No line items. Add items to begin reconciliation.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
