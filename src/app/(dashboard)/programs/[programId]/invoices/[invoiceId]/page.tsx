"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import StatusBadge from "@/components/ui/StatusBadge";
import { useSyncProgram } from "@/components/layout/useSyncProgram";

interface LineItem {
  id: string;
  description: string;
  quantity: string | null;
  unitPrice: string | null;
  amount: string;
  flag: string;
  flagNote: string | null;
  clause?: { title: string; clauseRef: string | null; value: string | null; type?: string } | null;
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

const FLAG_OPTIONS = ["NONE", "RATE_MISMATCH", "SCOPE_CREEP", "UNAPPROVED_CHANGE", "DUPLICATE", "MISSING_BASELINE", "ASSUMPTION_VIOLATION", "OTHER"] as const;

const FLAG_LABELS: Record<string, string> = {
  NONE: "Clean",
  RATE_MISMATCH: "Rate Mismatch",
  SCOPE_CREEP: "Scope Creep",
  UNAPPROVED_CHANGE: "Unapproved Change",
  DUPLICATE: "Duplicate",
  MISSING_BASELINE: "Missing Baseline",
  ASSUMPTION_VIOLATION: "Assumption Violation",
  OTHER: "Other",
};

export default function InvoiceDetailPage() {
  const { programId, invoiceId } = useParams<{ programId: string; invoiceId: string }>();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddLine, setShowAddLine] = useState(false);
  const [error, setError] = useState("");
  const [lineForm, setLineForm] = useState({ description: "", quantity: "", unitPrice: "", amount: "", clauseId: "", changeId: "" });
  const [clauses, setClauses] = useState<Array<{ id: string; title: string; clauseRef: string | null; value: string | null; type?: string }>>([]);
  const [changes, setChanges] = useState<Array<{ id: string; title: string; sequenceNum: number }>>([]);
  const [flaggingId, setFlaggingId] = useState<string | null>(null);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);

  useSyncProgram();

  const loadInvoice = useCallback(async () => {
    const res = await fetch(`/api/invoices/${invoiceId}`);
    if (res.ok) setInvoice(await res.json());
    setLoading(false);
  }, [invoiceId]);

  useEffect(() => {
    loadInvoice();
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

  async function generateDispute() {
    const res = await fetch("/api/gateway/disputes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invoiceId }),
    });
    if (res.ok) {
      alert("Forensic dispute packet generated and saved to Evidence Log.");
      await loadInvoice();
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="flex items-center gap-3 text-sm text-muted">
        <svg className="h-5 w-5 animate-spin text-accent" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
        Loading invoice...
      </div>
    </div>
  );
  if (!invoice) return <div className="py-8 text-sm text-red-500">Invoice not found</div>;

  const flaggedItems = invoice.lineItems.filter((li) => li.flag !== "NONE");
  const lineTotal = invoice.lineItems.reduce((sum, li) => sum + Number(li.amount), 0);
  const selectedLine = selectedLineId ? invoice.lineItems.find((li) => li.id === selectedLineId) : null;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted">Reconciliation / Invoice Detail</p>
          <h1 className="mt-0.5 text-2xl font-bold text-zinc-900">Invoice: {invoice.invoiceNumber ?? "N/A"}</h1>
          <p className="mt-1 text-sm text-muted">
            {invoice.vendorName ?? "Unknown vendor"} · {invoice.currency} {invoice.totalAmount ? Number(invoice.totalAmount).toLocaleString() : "N/A"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={invoice.status} />
          {flaggedItems.length > 0 && (
            <button onClick={generateDispute} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500">
              Generate Dispute Packet
            </button>
          )}
        </div>
      </div>

      {error && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {/* Summary cards */}
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="card">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Line Items</p>
          <p className="mt-2 text-2xl font-bold text-zinc-900">{invoice.lineItems.length}</p>
        </div>
        <div className="card">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Flagged</p>
          <p className={`mt-2 text-2xl font-bold ${flaggedItems.length > 0 ? "text-red-600" : "text-green-600"}`}>
            {flaggedItems.length > 0 ? `${flaggedItems.length} Disputed` : "0 Clean"}
          </p>
        </div>
        <div className="card">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Line Total</p>
          <p className="mt-2 text-2xl font-bold text-zinc-900">{invoice.currency} {lineTotal.toLocaleString()}</p>
        </div>
        <div className="card">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Variance</p>
          <p className={`mt-2 text-2xl font-bold ${
            invoice.totalAmount && Math.abs(lineTotal - Number(invoice.totalAmount)) > 0.01 ? "text-red-600" : "text-green-600"
          }`}>
            {invoice.totalAmount ? `${invoice.currency} ${(lineTotal - Number(invoice.totalAmount)).toLocaleString()}` : "—"}
          </p>
        </div>
      </div>

      {/* Actions bar */}
      <div className="mt-4 flex gap-2">
        <button onClick={() => setShowAddLine(true)} className="btn-primary">Add Line Item</button>
        {invoice.status === "UPLOADED" && invoice.lineItems.length > 0 && (
          <button onClick={() => updateStatus("MAPPED")} className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500">Mark as Mapped</button>
        )}
        {invoice.status === "MAPPED" && flaggedItems.length > 0 && (
          <button onClick={() => updateStatus("FLAGGED")} className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-500">Mark as Flagged</button>
        )}
        {(invoice.status === "MAPPED" || invoice.status === "FLAGGED") && (
          <button onClick={() => updateStatus("APPROVED")} className="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-500">Approve</button>
        )}
      </div>

      {/* Add line item form */}
      {showAddLine && (
        <div className="mt-4 card space-y-3 border-accent/30 bg-accent-light/10">
          <h3 className="text-sm font-semibold text-zinc-900">Add Line Item</h3>
          <input placeholder="Description *" value={lineForm.description} onChange={(e) => setLineForm({ ...lineForm, description: e.target.value })} className="input" />
          <div className="grid grid-cols-3 gap-3">
            <input type="number" placeholder="Quantity" value={lineForm.quantity} onChange={(e) => setLineForm({ ...lineForm, quantity: e.target.value })} className="input" />
            <input type="number" placeholder="Unit price" value={lineForm.unitPrice} onChange={(e) => setLineForm({ ...lineForm, unitPrice: e.target.value })} className="input" />
            <input type="number" placeholder="Amount *" value={lineForm.amount} onChange={(e) => setLineForm({ ...lineForm, amount: e.target.value })} className="input" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">Map to Truth Item</label>
              <select value={lineForm.clauseId} onChange={(e) => setLineForm({ ...lineForm, clauseId: e.target.value })} className="input">
                <option value="">— None —</option>
                {clauses.map((c) => (
                  <option key={c.id} value={c.id}>{c.clauseRef ? `${c.clauseRef}: ` : ""}{c.title}{c.value ? ` ($${Number(c.value).toLocaleString()})` : ""}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">Map to Change Order</label>
              <select value={lineForm.changeId} onChange={(e) => setLineForm({ ...lineForm, changeId: e.target.value })} className="input">
                <option value="">— None —</option>
                {changes.map((c) => (
                  <option key={c.id} value={c.id}>#{c.sequenceNum}: {c.title}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={addLineItem} className="btn-primary">Add</button>
            <button onClick={() => setShowAddLine(false)} className="btn-secondary">Cancel</button>
          </div>
        </div>
      )}

      {/* Split-screen: Invoice Lines (left) + Line Item Mapping (right) */}
      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        {/* Left panel: Invoice line items */}
        <div className="lg:col-span-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-900">Invoice Line Items</h2>
            <span className="text-xs text-muted">{invoice.lineItems.length} items</span>
          </div>
          <div className="mt-3 space-y-2">
            {invoice.lineItems.map((li) => {
              const isFlagged = li.flag !== "NONE";
              const isSelected = selectedLineId === li.id;
              return (
                <div key={li.id} onClick={() => setSelectedLineId(li.id)}
                  className={`cursor-pointer rounded-lg border p-3 transition-all ${
                    isSelected ? "border-accent bg-accent-light/20 shadow-sm"
                    : isFlagged ? "border-red-200 bg-red-50/50 hover:border-red-300"
                    : "border-card-border bg-card-bg hover:border-accent/40"
                  }`}>
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase ${
                          isFlagged ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"
                        }`}>
                          {isFlagged ? FLAG_LABELS[li.flag] || li.flag : "Clean"}
                        </span>
                        {li.clause && (
                          <span className="rounded-md bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-600">
                            Mapped: {li.clause.clauseRef ?? li.clause.title}
                          </span>
                        )}
                        {li.change && (
                          <span className="rounded-md bg-purple-50 px-2 py-0.5 text-[10px] font-medium text-purple-600">
                            Change #{li.change.sequenceNum}
                          </span>
                        )}
                        {!li.clause && !li.change && (
                          <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-[10px] text-zinc-500">Unmapped</span>
                        )}
                      </div>
                      <p className="mt-1.5 text-sm font-medium text-zinc-900">{li.description}</p>
                    </div>
                    <p className="ml-4 flex-shrink-0 text-sm font-bold text-zinc-900">${Number(li.amount).toLocaleString()}</p>
                  </div>
                  {li.flagNote && <p className="mt-1 text-xs text-red-600">{li.flagNote}</p>}
                </div>
              );
            })}
            {invoice.lineItems.length === 0 && (
              <div className="card py-8 text-center">
                <p className="text-sm text-muted">No line items yet. Add items to begin reconciliation.</p>
              </div>
            )}
          </div>
        </div>

        {/* Right panel: Line Item Mapping */}
        <div className="lg:col-span-2">
          <h2 className="text-sm font-semibold text-zinc-900">Line Item Mapping</h2>
          {selectedLine ? (
            <div className="mt-3 space-y-3">
              <div className="card">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted">Selected Line</p>
                <p className="mt-1 font-medium text-zinc-900">{selectedLine.description}</p>
                <p className="mt-1 text-lg font-bold text-zinc-900">${Number(selectedLine.amount).toLocaleString()}</p>
              </div>

              {selectedLine.clause ? (
                <div className="card border-blue-200 bg-blue-50/30">
                  <p className="text-xs font-semibold uppercase tracking-wider text-blue-600">Mapped Truth Item</p>
                  <p className="mt-1 font-medium text-zinc-900">
                    {selectedLine.clause.clauseRef ? `${selectedLine.clause.clauseRef}: ` : ""}{selectedLine.clause.title}
                  </p>
                  {selectedLine.clause.value && (
                    <p className="mt-1 text-sm text-muted">Baseline: ${Number(selectedLine.clause.value).toLocaleString()}</p>
                  )}
                </div>
              ) : selectedLine.change ? (
                <div className="card border-purple-200 bg-purple-50/30">
                  <p className="text-xs font-semibold uppercase tracking-wider text-purple-600">Mapped Change Order</p>
                  <p className="mt-1 font-medium text-zinc-900">#{selectedLine.change.sequenceNum}: {selectedLine.change.title}</p>
                </div>
              ) : (
                <div className="card border-amber-200 bg-amber-50/30">
                  <p className="text-xs font-semibold uppercase tracking-wider text-amber-600">No Mapping</p>
                  <p className="mt-1 text-sm text-muted">This line item is not mapped to any truth item or change order.</p>
                </div>
              )}

              <div className="card">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted">Flag Status</p>
                <select value={selectedLine.flag} onChange={(e) => updateFlag(selectedLine.id, e.target.value)}
                  disabled={flaggingId === selectedLine.id}
                  className={`input mt-2 ${selectedLine.flag !== "NONE" ? "border-red-300 bg-red-50 text-red-700" : ""}`}>
                  {FLAG_OPTIONS.map((f) => (
                    <option key={f} value={f}>{FLAG_LABELS[f] ?? f}</option>
                  ))}
                </select>
                {selectedLine.flagNote && <p className="mt-2 text-xs text-red-600">{selectedLine.flagNote}</p>}
              </div>
            </div>
          ) : (
            <div className="mt-3 card flex flex-col items-center py-10">
              <svg className="h-8 w-8 text-zinc-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5" /></svg>
              <p className="mt-3 text-sm text-muted">Select a line item to view mapping details</p>
            </div>
          )}

          <div className="mt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Available Truth Items</h3>
            <div className="mt-2 max-h-64 space-y-1.5 overflow-y-auto">
              {clauses.map((c) => (
                <div key={c.id} className="rounded-lg border border-card-border bg-card-bg p-2.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-zinc-900">{c.clauseRef ? `${c.clauseRef}: ` : ""}{c.title}</span>
                    {c.value && <span className="font-mono text-zinc-500">${Number(c.value).toLocaleString()}</span>}
                  </div>
                </div>
              ))}
              {clauses.length === 0 && (
                <p className="py-4 text-center text-xs text-muted">No locked baselines with truth items</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
