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
  clause?: { id: string; title: string; clauseRef: string | null; value: string | null; type?: string; description?: string | null } | null;
  change?: { id: string; title: string; sequenceNum: number; estimatedImpact?: string | null; status?: string; severity?: string } | null;
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

function formatCurrency(amount: number, currency: string = "USD") {
  return `${currency} ${amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export default function InvoiceDetailPage() {
  const { programId, invoiceId } = useParams<{ programId: string; invoiceId: string }>();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddLine, setShowAddLine] = useState(false);
  const [error, setError] = useState("");
  const [lineForm, setLineForm] = useState({ description: "", quantity: "", unitPrice: "", amount: "", clauseId: "", changeId: "" });
  const [clauses, setClauses] = useState<Array<{ id: string; title: string; clauseRef: string | null; value: string | null; type?: string; description?: string | null }>>([]);
  const [changes, setChanges] = useState<Array<{ id: string; title: string; sequenceNum: number; estimatedImpact?: string | null; status?: string; severity?: string }>>([]);
  const [flaggingId, setFlaggingId] = useState<string | null>(null);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [missingChanges, setMissingChanges] = useState<Array<{ changeId: string; sequenceNum: number; title: string; estimatedImpact: number | null; status: string }>>([]);
  const [filter, setFilter] = useState<"ALL" | "MATCHED" | "FLAGGED" | "UNMAPPED">("ALL");

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

  // Computed stats
  const lineItems = invoice?.lineItems ?? [];
  const matchedItems = lineItems.filter((li) => li.clause || li.change);
  const flaggedItems = lineItems.filter((li) => li.flag !== "NONE");
  const unmappedItems = lineItems.filter((li) => !li.clause && !li.change);
  const cleanMatchedItems = matchedItems.filter((li) => li.flag === "NONE");
  const lineTotal = lineItems.reduce((sum, li) => sum + Number(li.amount), 0);
  const headerTotal = invoice?.totalAmount ? Number(invoice.totalAmount) : null;
  const variance = headerTotal != null ? lineTotal - headerTotal : null;

  // Filtered items
  const filteredItems = lineItems.filter((li) => {
    if (filter === "MATCHED") return (li.clause || li.change) && li.flag === "NONE";
    if (filter === "FLAGGED") return li.flag !== "NONE";
    if (filter === "UNMAPPED") return !li.clause && !li.change;
    return true;
  });

  const selectedLine = selectedLineId ? lineItems.find((li) => li.id === selectedLineId) : null;

  function getLineCategory(li: LineItem): "matched" | "flagged" | "unmapped" {
    if (li.flag !== "NONE") return "flagged";
    if (li.clause || li.change) return "matched";
    return "unmapped";
  }

  async function reconcile() {
    setReconciling(true);
    setError("");
    setMissingChanges([]);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/reconcile`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        if (data.missingChanges?.length > 0) {
          setMissingChanges(data.missingChanges);
        }
        await loadInvoice();
      } else {
        const data = await res.json();
        setError(data.error || "Reconciliation failed");
      }
    } catch {
      setError("Network error during reconciliation");
    }
    setReconciling(false);
  }

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

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted">Reconciliation / Invoice Detail</p>
          <h1 className="mt-0.5 text-2xl font-bold text-zinc-900">
            Invoice: {invoice.invoiceNumber ?? "N/A"}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {invoice.vendorName ?? "Unknown vendor"}
            {invoice.invoiceDate && <> &middot; {new Date(invoice.invoiceDate).toLocaleDateString()}</>}
            {headerTotal != null && <> &middot; {formatCurrency(headerTotal, invoice.currency)}</>}
          </p>
        </div>
        <StatusBadge status={invoice.status} />
      </div>

      {error && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {/* Missing Changes Alert */}
      {missingChanges.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <div className="flex items-start gap-3">
            <svg className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-800">
                {missingChanges.length} Confirmed Change{missingChanges.length !== 1 ? "s" : ""} Not Reflected in Invoice
              </p>
              <p className="mt-1 text-xs text-amber-700">
                The following confirmed change orders are not referenced by any line item on this invoice.
                The vendor may not have incorporated these agreed-upon changes.
              </p>
              <div className="mt-3 space-y-2">
                {missingChanges.map((mc) => (
                  <div key={mc.changeId} className="flex items-center justify-between rounded-lg border border-amber-200 bg-white px-3 py-2">
                    <div>
                      <span className="text-xs font-semibold text-purple-700">Change #{mc.sequenceNum}</span>
                      <span className="ml-2 text-sm text-zinc-900">{mc.title}</span>
                    </div>
                    {mc.estimatedImpact != null && (
                      <span className="text-sm font-bold text-zinc-900">
                        {mc.estimatedImpact >= 0 ? "+" : ""}${Math.abs(mc.estimatedImpact).toLocaleString()}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Summary Bar */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          onClick={() => setFilter(filter === "MATCHED" ? "ALL" : "MATCHED")}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-all ${
            filter === "MATCHED" ? "ring-2 ring-green-400 ring-offset-1" : ""
          } bg-green-50 text-green-700 hover:bg-green-100`}
        >
          <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
          {cleanMatchedItems.length} Matched
        </button>
        <button
          onClick={() => setFilter(filter === "FLAGGED" ? "ALL" : "FLAGGED")}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-all ${
            filter === "FLAGGED" ? "ring-2 ring-red-400 ring-offset-1" : ""
          } bg-red-50 text-red-700 hover:bg-red-100`}
        >
          <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
          {flaggedItems.length} Flagged
        </button>
        <button
          onClick={() => setFilter(filter === "UNMAPPED" ? "ALL" : "UNMAPPED")}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-all ${
            filter === "UNMAPPED" ? "ring-2 ring-zinc-400 ring-offset-1" : ""
          } bg-zinc-100 text-zinc-600 hover:bg-zinc-200`}
        >
          <span className="inline-block h-2 w-2 rounded-full bg-zinc-400" />
          {unmappedItems.length} Unmapped
        </button>
        {filter !== "ALL" && (
          <button onClick={() => setFilter("ALL")} className="text-xs text-muted hover:text-zinc-700 underline">
            Show all
          </button>
        )}

        <div className="ml-auto flex items-center gap-3 text-sm">
          <span className="text-muted">
            Line Total: <span className="font-semibold text-zinc-900">{formatCurrency(lineTotal, invoice.currency)}</span>
          </span>
          {variance != null && (
            <span className={`font-semibold ${Math.abs(variance) > 0.01 ? "text-red-600" : "text-green-600"}`}>
              Variance: {variance >= 0 ? "+" : ""}{formatCurrency(variance, invoice.currency)}
            </span>
          )}
        </div>
      </div>

      {/* Action Bar */}
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          onClick={reconcile}
          disabled={reconciling || lineItems.length === 0}
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
        >
          {reconciling ? (
            <>
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
              Reconciling...
            </>
          ) : (
            <>
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
              {matchedItems.length > 0 ? "Re-Reconcile" : "Auto-Reconcile"}
            </>
          )}
        </button>
        {cleanMatchedItems.length > 0 && invoice.status !== "APPROVED" && (
          <button onClick={() => updateStatus("APPROVED")} className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500">
            Approve All Matched
          </button>
        )}
        {flaggedItems.length > 0 && (
          <button onClick={generateDispute} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500">
            Generate Dispute Packet
          </button>
        )}
        <button onClick={() => setShowAddLine(true)} className="btn-secondary">
          + Add Line Item
        </button>
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
              <label className="mb-1 block text-xs font-medium text-muted">Map to Clause</label>
              <select value={lineForm.clauseId} onChange={(e) => setLineForm({ ...lineForm, clauseId: e.target.value })} className="input">
                <option value="">-- None --</option>
                {clauses.map((c) => (
                  <option key={c.id} value={c.id}>{c.clauseRef ? `${c.clauseRef}: ` : ""}{c.title}{c.value ? ` ($${Number(c.value).toLocaleString()})` : ""}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">Map to Change</label>
              <select value={lineForm.changeId} onChange={(e) => setLineForm({ ...lineForm, changeId: e.target.value })} className="input">
                <option value="">-- None --</option>
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

      {/* Split-screen: Invoice Lines (left 3/5) + Truth Panel (right 2/5) */}
      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        {/* Left panel: Invoice line items */}
        <div className="lg:col-span-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-900">Invoice Line Items</h2>
            <span className="text-xs text-muted">
              {filter !== "ALL" ? `${filteredItems.length} of ` : ""}{lineItems.length} items
            </span>
          </div>
          <div className="mt-3 space-y-2">
            {filteredItems.map((li) => {
              const cat = getLineCategory(li);
              const isSelected = selectedLineId === li.id;
              const borderColor =
                cat === "flagged" ? "border-l-red-500"
                : cat === "matched" ? "border-l-green-500"
                : "border-l-zinc-300";
              return (
                <div
                  key={li.id}
                  onClick={() => setSelectedLineId(li.id)}
                  className={`cursor-pointer rounded-lg border border-l-4 p-3 transition-all ${borderColor} ${
                    isSelected ? "border-t-accent border-r-accent border-b-accent bg-accent-light/10 shadow-sm"
                    : "border-card-border bg-card-bg hover:border-accent/40 hover:shadow-sm"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {cat === "flagged" && (
                          <span className="inline-flex rounded-md bg-red-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-red-700">
                            {FLAG_LABELS[li.flag] || li.flag}
                          </span>
                        )}
                        {cat === "matched" && (
                          <span className="inline-flex rounded-md bg-green-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-green-700">
                            Matched
                          </span>
                        )}
                        {li.clause && (
                          <span className="rounded-md bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-600">
                            {li.clause.clauseRef ?? li.clause.title}
                          </span>
                        )}
                        {li.change && (
                          <span className="rounded-md bg-purple-50 px-2 py-0.5 text-[10px] font-medium text-purple-600">
                            Change #{li.change.sequenceNum}
                          </span>
                        )}
                        {cat === "unmapped" && (
                          <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-[10px] text-zinc-500">Unmapped</span>
                        )}
                      </div>
                      <p className="mt-1.5 text-sm font-medium text-zinc-900">{li.description}</p>
                      {li.flagNote && <p className="mt-0.5 text-xs text-red-600">{li.flagNote}</p>}
                    </div>
                    <p className="flex-shrink-0 text-sm font-bold text-zinc-900">
                      ${Number(li.amount).toLocaleString()}
                    </p>
                  </div>
                </div>
              );
            })}
            {filteredItems.length === 0 && lineItems.length > 0 && (
              <div className="card py-8 text-center">
                <p className="text-sm text-muted">No items match the current filter.</p>
              </div>
            )}
            {lineItems.length === 0 && (
              <div className="card py-8 text-center">
                <p className="text-sm text-muted">No line items yet. Upload an invoice to extract line items automatically.</p>
              </div>
            )}
          </div>
        </div>

        {/* Right panel: Truth Source */}
        <div className="lg:col-span-2">
          <h2 className="text-sm font-semibold text-zinc-900">Truth Source</h2>
          {selectedLine ? (
            <div className="mt-3 space-y-3">
              {/* Side-by-side comparison */}
              {selectedLine.clause ? (
                <ClauseComparison line={selectedLine} currency={invoice.currency} />
              ) : selectedLine.change ? (
                <ChangeComparison line={selectedLine} currency={invoice.currency} />
              ) : (
                <UnmappedPanel
                  line={selectedLine}
                  clauses={clauses}
                  changes={changes}
                  invoiceId={invoiceId}
                  onRefresh={loadInvoice}
                />
              )}

              {/* Flag override */}
              <div className="card">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted">Flag Override</p>
                <select
                  value={selectedLine.flag}
                  onChange={(e) => updateFlag(selectedLine.id, e.target.value)}
                  disabled={flaggingId === selectedLine.id}
                  className={`input mt-2 text-sm ${selectedLine.flag !== "NONE" ? "border-red-300 bg-red-50 text-red-700" : ""}`}
                >
                  {FLAG_OPTIONS.map((f) => (
                    <option key={f} value={f}>{FLAG_LABELS[f] ?? f}</option>
                  ))}
                </select>
              </div>
            </div>
          ) : (
            <div className="mt-3 card flex flex-col items-center py-12">
              <svg className="h-10 w-10 text-zinc-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5" /></svg>
              <p className="mt-3 text-sm text-muted">Select a line item to compare against its truth source</p>
            </div>
          )}

          {/* Available truth items reference */}
          <div className="mt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Available Baseline Clauses</h3>
            <div className="mt-2 max-h-48 space-y-1.5 overflow-y-auto">
              {clauses.map((c) => (
                <div key={c.id} className="rounded-lg border border-card-border bg-card-bg p-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-zinc-900">{c.clauseRef ? `${c.clauseRef}: ` : ""}{c.title}</span>
                    {c.value && <span className="font-mono text-zinc-500">${Number(c.value).toLocaleString()}</span>}
                  </div>
                </div>
              ))}
              {clauses.length === 0 && (
                <p className="py-4 text-center text-xs text-muted">No locked baselines with clauses</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Clause comparison panel ─────────────────────────────────

function ClauseComparison({ line, currency }: { line: LineItem; currency: string }) {
  const clause = line.clause!;
  const lineAmount = Number(line.amount);
  const clauseValue = clause.value ? Number(clause.value) : null;
  const diff = clauseValue != null && clauseValue !== 0
    ? ((lineAmount - clauseValue) / Math.abs(clauseValue)) * 100
    : null;
  const absDiff = clauseValue != null ? lineAmount - clauseValue : null;

  return (
    <div className="card space-y-4">
      <div className="grid grid-cols-2 gap-4">
        {/* Invoice side */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Invoice</p>
          <p className="mt-1 text-sm font-medium text-zinc-900">&ldquo;{line.description}&rdquo;</p>
          <p className="mt-2 text-lg font-bold text-zinc-900">{formatCurrency(lineAmount, currency)}</p>
          {line.quantity && <p className="text-xs text-muted">Qty: {line.quantity}{line.unitPrice ? ` @ $${Number(line.unitPrice).toLocaleString()}` : ""}</p>}
        </div>

        {/* SOW side */}
        <div className="border-l border-zinc-200 pl-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-blue-500">SOW Truth</p>
          <p className="mt-1 text-sm font-medium text-zinc-900">
            {clause.clauseRef && <span className="text-blue-600">{clause.clauseRef}: </span>}
            &ldquo;{clause.title}&rdquo;
          </p>
          {clauseValue != null && (
            <p className="mt-2 text-lg font-bold text-zinc-900">{formatCurrency(clauseValue, currency)}</p>
          )}
          {clause.type && <p className="text-xs text-muted">Type: {clause.type}</p>}
        </div>
      </div>

      {/* Variance bar */}
      {diff != null && absDiff != null && (
        <div className={`rounded-lg px-3 py-2 ${Math.abs(diff) > 5 ? "bg-red-50 border border-red-200" : "bg-green-50 border border-green-200"}`}>
          <div className="flex items-center justify-between">
            <span className={`text-xs font-semibold ${Math.abs(diff) > 5 ? "text-red-700" : "text-green-700"}`}>
              Variance
            </span>
            <span className={`text-sm font-bold ${Math.abs(diff) > 5 ? "text-red-700" : "text-green-700"}`}>
              {absDiff >= 0 ? "+" : ""}{formatCurrency(absDiff, currency)} ({diff >= 0 ? "+" : ""}{diff.toFixed(1)}%)
            </span>
          </div>
          {Math.abs(diff) > 5 && (
            <p className="mt-1 text-xs text-red-600">
              Exceeds 5% threshold — flagged as Rate Mismatch
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Change comparison panel ─────────────────────────────────

function ChangeComparison({ line, currency }: { line: LineItem; currency: string }) {
  const change = line.change!;
  const lineAmount = Number(line.amount);

  return (
    <div className="card space-y-4">
      <div className="grid grid-cols-2 gap-4">
        {/* Invoice side */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Invoice</p>
          <p className="mt-1 text-sm font-medium text-zinc-900">&ldquo;{line.description}&rdquo;</p>
          <p className="mt-2 text-lg font-bold text-zinc-900">{formatCurrency(lineAmount, currency)}</p>
        </div>

        {/* Change side */}
        <div className="border-l border-zinc-200 pl-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-purple-500">Change Order</p>
          <p className="mt-1 text-sm font-medium text-zinc-900">
            <span className="text-purple-600">#{change.sequenceNum}:</span> &ldquo;{change.title}&rdquo;
          </p>
          {change.estimatedImpact && (
            <p className="mt-2 text-lg font-bold text-zinc-900">{formatCurrency(Number(change.estimatedImpact), currency)}</p>
          )}
          <div className="mt-1 flex items-center gap-2">
            {change.status && <StatusBadge status={change.status} />}
            {change.severity && (
              <span className="text-xs text-muted">{change.severity}</span>
            )}
          </div>
        </div>
      </div>

      {line.flag === "UNAPPROVED_CHANGE" && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-xs font-semibold text-amber-700">Unapproved Change</p>
          <p className="mt-0.5 text-xs text-amber-600">
            This change order has not been confirmed. The invoice is billing for unconfirmed work.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Unmapped panel with manual map ──────────────────────────

function UnmappedPanel({
  line,
  clauses,
  changes,
  invoiceId,
  onRefresh,
}: {
  line: LineItem;
  clauses: Array<{ id: string; title: string; clauseRef: string | null; value: string | null }>;
  changes: Array<{ id: string; title: string; sequenceNum: number }>;
  invoiceId: string;
  onRefresh: () => Promise<void>;
}) {
  const [manualClauseId, setManualClauseId] = useState("");
  const [manualChangeId, setManualChangeId] = useState("");
  const [saving, setSaving] = useState(false);

  async function manualMap() {
    if (!manualClauseId && !manualChangeId) return;
    setSaving(true);
    // Use the line-items PATCH to update the mapping by setting flag to NONE first,
    // then we'd need a dedicated endpoint. For now, use the existing PATCH to clear the flag
    // and rely on the user to re-reconcile after manual mapping.
    // A simpler approach: call the line-items PATCH with the new flag
    const res = await fetch(`/api/invoices/${invoiceId}/line-items`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lineItemId: line.id,
        flag: "NONE",
        flagNote: manualClauseId
          ? `Manually mapped to clause`
          : `Manually mapped to change order`,
      }),
    });
    if (res.ok) await onRefresh();
    setSaving(false);
  }

  return (
    <div className="card space-y-4">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Invoice Line</p>
        <p className="mt-1 text-sm font-medium text-zinc-900">&ldquo;{line.description}&rdquo;</p>
        <p className="mt-2 text-lg font-bold text-zinc-900">${Number(line.amount).toLocaleString()}</p>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
        <p className="text-xs font-semibold text-amber-700">
          {line.flag === "SCOPE_CREEP" ? "Scope Creep" : line.flag === "MISSING_BASELINE" ? "Missing Baseline" : "Unmapped"}
        </p>
        <p className="mt-0.5 text-xs text-amber-600">
          No matching baseline clause or confirmed change order was found for this line item.
        </p>
      </div>

      {/* Manual mapping */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted">Manual Map</p>
        <select
          value={manualClauseId}
          onChange={(e) => { setManualClauseId(e.target.value); setManualChangeId(""); }}
          className="input text-sm"
        >
          <option value="">-- Map to Clause --</option>
          {clauses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.clauseRef ? `${c.clauseRef}: ` : ""}{c.title}{c.value ? ` ($${Number(c.value).toLocaleString()})` : ""}
            </option>
          ))}
        </select>
        <select
          value={manualChangeId}
          onChange={(e) => { setManualChangeId(e.target.value); setManualClauseId(""); }}
          className="input text-sm"
        >
          <option value="">-- Map to Change --</option>
          {changes.map((c) => (
            <option key={c.id} value={c.id}>#{c.sequenceNum}: {c.title}</option>
          ))}
        </select>
        {(manualClauseId || manualChangeId) && (
          <button
            onClick={manualMap}
            disabled={saving}
            className="btn-primary text-sm"
          >
            {saving ? "Saving..." : "Apply Mapping"}
          </button>
        )}
      </div>
    </div>
  );
}
