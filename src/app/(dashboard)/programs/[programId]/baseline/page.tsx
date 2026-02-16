"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import StatusBadge from "@/components/ui/StatusBadge";
import { useSyncProgram } from "@/components/layout/useSyncProgram";

interface Clause {
  id: string;
  clauseRef: string | null;
  type: string;
  title: string;
  description: string | null;
  value: string | null;
  unit: string | null;
  sortOrder: number;
}

interface Baseline {
  id: string;
  version: number;
  title: string;
  status: string;
  releasedAt: string | null;
  confirmedAt: string | null;
  lockedAt: string | null;
  createdAt: string;
  clauses: Clause[];
  _count?: { clauses: number };
}

/* ───── Category mapping ───── */

const CATEGORY_MAP: Record<string, string> = {
  PRICING: "Deliverable", SCOPE: "Deliverable", TIMELINE: "Deliverable",
  QUALITY: "Assumption", REGULATORY: "Assumption",
  PAYMENT_TERMS: "Exclusion", IP: "Exclusion",
  OTHER: "Deliverable",
};
function getCategory(type: string) { return CATEGORY_MAP[type] ?? "Deliverable"; }

const TABS = ["All Items", "Deliverables", "Assumptions", "Exclusions"] as const;
type Tab = (typeof TABS)[number];
const TAB_CATEGORY: Record<Tab, string | null> = { "All Items": null, Deliverables: "Deliverable", Assumptions: "Assumption", Exclusions: "Exclusion" };

/* ───── Main page ───── */

export default function BaselinePage() {
  const { programId } = useParams<{ programId: string }>();
  const [baselines, setBaselines] = useState<Baseline[]>([]);
  const [selected, setSelected] = useState<Baseline | null>(null);
  const [loading, setLoading] = useState(true);
  const [showNewBaseline, setShowNewBaseline] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("All Items");
  const [showAddClause, setShowAddClause] = useState(false);
  const [clauseForm, setClauseForm] = useState({ clauseRef: "", type: "SCOPE", title: "", description: "", value: "", unit: "" });
  const [error, setError] = useState("");
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // Parse SOW state
  const [showParseModal, setShowParseModal] = useState(false);
  const [parseFile, setParseFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseStep, setParseStep] = useState<"upload" | "extracting" | "review">("upload");
  const [parsedItems, setParsedItems] = useState<Array<{ type: string; title: string; description?: string; value?: number; unit?: string; clauseRef?: string; _accepted?: boolean; _rejected?: boolean }>>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  // Edit modal state
  const [editingClause, setEditingClause] = useState<Clause | null>(null);
  const [editForm, setEditForm] = useState({ title: "", description: "", value: "", unit: "" });

  useSyncProgram();

  const loadBaselines = useCallback(async () => {
    const res = await fetch(`/api/baselines?programId=${programId}`);
    if (res.ok) setBaselines(await res.json());
    setLoading(false);
  }, [programId]);

  useEffect(() => { loadBaselines(); }, [loadBaselines]);

  async function loadBaseline(id: string) {
    const res = await fetch(`/api/baselines/${id}`);
    if (res.ok) setSelected(await res.json());
  }

  async function createBaseline() {
    if (!newTitle) return;
    setError("");
    const res = await fetch("/api/baselines", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ programId, title: newTitle }),
    });
    if (res.ok) {
      const created = await res.json();
      setNewTitle("");
      setShowNewBaseline(false);
      await loadBaselines();
      await loadBaseline(created.id);
    } else {
      const data = await res.json();
      setError(data.error || "Failed to create baseline");
    }
  }

  async function transitionStatus(baselineId: string, status: string) {
    const res = await fetch(`/api/baselines/${baselineId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      await loadBaseline(baselineId);
      await loadBaselines();
    } else {
      const data = await res.json();
      setError(data.error || "Transition failed");
    }
  }

  async function addClause() {
    if (!selected || !clauseForm.title || !clauseForm.type) return;
    const res = await fetch(`/api/baselines/${selected.id}/clauses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...clauseForm,
        value: clauseForm.value ? parseFloat(clauseForm.value) : undefined,
        clauseRef: clauseForm.clauseRef || undefined,
        description: clauseForm.description || undefined,
        unit: clauseForm.unit || undefined,
      }),
    });
    if (res.ok) {
      setShowAddClause(false);
      setClauseForm({ clauseRef: "", type: "SCOPE", title: "", description: "", value: "", unit: "" });
      await loadBaseline(selected.id);
    } else {
      const data = await res.json();
      setError(data.error || "Failed to add clause");
    }
  }

  async function deleteClause(clauseId: string) {
    if (!selected) return;
    const res = await fetch(`/api/baselines/${selected.id}/clauses`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clauseId }),
    });
    if (res.ok) await loadBaseline(selected.id);
  }

  async function createMagicLink(baselineId: string) {
    const res = await fetch("/api/gateway/magic-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "BASELINE_CONFIRM", entityId: baselineId }),
    });
    if (res.ok) {
      const data = await res.json();
      await navigator.clipboard.writeText(data.url);
      setShowConfirmModal(false);
      alert(`Magic link copied to clipboard!\n\n${data.url}\n\nExpires: ${new Date(data.expiresAt).toLocaleString()}`);
    }
  }

  /* ───── Parse SOW flow ───── */

  async function handleParseSOW() {
    if (!selected || !parseFile) return;
    setParsing(true);
    setParseStep("extracting");
    setError("");

    try {
      // Step 1: Upload to evidence
      const form = new FormData();
      form.append("file", parseFile);
      form.append("programId", programId);
      form.append("type", "SOW_MSA");
      const uploadRes = await fetch("/api/gateway/evidence", { method: "POST", body: form });
      if (!uploadRes.ok) throw new Error("Upload failed");
      const evidence = await uploadRes.json();

      // Step 2: Create extraction job
      const jobRes = await fetch("/api/gateway/extraction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ evidenceId: evidence.id, targetType: "BASELINE" }),
      });
      if (!jobRes.ok) throw new Error("Extraction job creation failed");
      const job = await jobRes.json();

      // Step 3: Run extraction
      const runRes = await fetch(`/api/gateway/extraction/${job.id}/run`, { method: "POST" });
      if (!runRes.ok) throw new Error("Extraction failed to run");
      const result = await runRes.json();

      // Step 4: Parse extracted items for review
      const extracted = result.extractedData;
      if (extracted?.clauses && Array.isArray(extracted.clauses)) {
        setParsedItems(extracted.clauses.map((c: Record<string, unknown>) => ({ ...c, _accepted: false, _rejected: false })));
      } else if (extracted?.items && Array.isArray(extracted.items)) {
        setParsedItems(extracted.items.map((c: Record<string, unknown>) => ({ ...c, _accepted: false, _rejected: false })));
      } else {
        setParsedItems([]);
      }
      setParseStep("review");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Parse failed");
      setParseStep("upload");
    } finally {
      setParsing(false);
    }
  }

  async function acceptParsedItem(index: number) {
    if (!selected) return;
    const item = parsedItems[index];
    const res = await fetch(`/api/baselines/${selected.id}/clauses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: item.type || "SCOPE",
        title: item.title,
        description: item.description || undefined,
        value: item.value || undefined,
        unit: item.unit || undefined,
        clauseRef: item.clauseRef || undefined,
      }),
    });
    if (res.ok) {
      setParsedItems((prev) => prev.map((p, i) => i === index ? { ...p, _accepted: true } : p));
      await loadBaseline(selected.id);
    }
  }

  function rejectParsedItem(index: number) {
    setParsedItems((prev) => prev.map((p, i) => i === index ? { ...p, _rejected: true } : p));
  }

  async function acceptAllRemaining() {
    for (let i = 0; i < parsedItems.length; i++) {
      if (!parsedItems[i]._accepted && !parsedItems[i]._rejected) {
        await acceptParsedItem(i);
      }
    }
  }

  /* ───── Edit clause ───── */

  function openEditModal(clause: Clause) {
    setEditingClause(clause);
    setEditForm({
      title: clause.title,
      description: clause.description ?? "",
      value: clause.value ?? "",
      unit: clause.unit ?? "",
    });
  }

  async function saveEdit() {
    if (!editingClause || !selected) return;
    // Delete old + re-create with new values (API doesn't have PATCH for clauses)
    await deleteClause(editingClause.id);
    await fetch(`/api/baselines/${selected.id}/clauses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: editingClause.type,
        title: editForm.title,
        description: editForm.description || undefined,
        value: editForm.value ? parseFloat(editForm.value) : undefined,
        unit: editForm.unit || undefined,
        clauseRef: editingClause.clauseRef || undefined,
      }),
    });
    setEditingClause(null);
    await loadBaseline(selected.id);
  }

  /* ───── Render ───── */

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="flex items-center gap-3 text-sm text-muted">
        <svg className="h-5 w-5 animate-spin text-accent" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
        Loading baselines...
      </div>
    </div>
  );

  const clauses = selected?.clauses ?? [];
  const catFilter = TAB_CATEGORY[activeTab];
  const filtered = catFilter ? clauses.filter((c) => getCategory(c.type) === catFilter) : clauses;
  const deliverableCount = clauses.filter((c) => getCategory(c.type) === "Deliverable").length;
  const assumptionCount = clauses.filter((c) => getCategory(c.type) === "Assumption").length;
  const exclusionCount = clauses.filter((c) => getCategory(c.type) === "Exclusion").length;
  const grouped: { label: string; items: Clause[] }[] = [
    { label: `Deliverables (${deliverableCount})`, items: clauses.filter((c) => getCategory(c.type) === "Deliverable") },
    { label: `Assumptions (${assumptionCount})`, items: clauses.filter((c) => getCategory(c.type) === "Assumption") },
    { label: `Exclusions (${exclusionCount})`, items: clauses.filter((c) => getCategory(c.type) === "Exclusion") },
  ];

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted">Baseline Truth {selected ? `/ Active v${selected.version}` : ""}</p>
          <h1 className="mt-0.5 text-2xl font-bold text-zinc-900">Truth Table</h1>
        </div>
        <div className="flex items-center gap-2">
          {selected && selected.status === "RELEASED" && (
            <button onClick={() => setShowConfirmModal(true)} className="btn-primary">Send for Confirmation</button>
          )}
          <button onClick={() => setShowNewBaseline(true)} className="btn-secondary">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            New Baseline
          </button>
        </div>
      </div>

      {error && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {showNewBaseline && (
        <div className="mt-4 card">
          <h3 className="text-sm font-semibold text-zinc-900">Create New Baseline</h3>
          <input type="text" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Baseline title (e.g., MSA v2.0 — Jan 2026)" className="input mt-2" />
          <div className="mt-3 flex gap-2">
            <button onClick={createBaseline} className="btn-primary">Create</button>
            <button onClick={() => setShowNewBaseline(false)} className="btn-secondary">Cancel</button>
          </div>
        </div>
      )}

      {/* Baseline selector + main content */}
      <div className="mt-6 grid gap-4 lg:grid-cols-4">
        {/* Sidebar: Baseline list */}
        <div className="space-y-2">
          {baselines.map((b) => (
            <button key={b.id} onClick={() => loadBaseline(b.id)}
              className={`w-full rounded-lg border p-3 text-left transition-all ${
                selected?.id === b.id ? "border-accent bg-accent-light/30 shadow-sm" : "border-card-border bg-card-bg hover:border-accent/40 hover:shadow-sm"
              }`}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-zinc-900">v{b.version}: {b.title}</span>
                <StatusBadge status={b.status} />
              </div>
              <p className="mt-1 text-xs text-zinc-400">{b._count?.clauses ?? 0} items</p>
            </button>
          ))}
          {baselines.length === 0 && (
            <div className="card text-center">
              <p className="text-sm text-muted">No baselines yet</p>
              <button onClick={() => setShowNewBaseline(true)} className="mt-2 text-xs font-medium text-accent hover:text-accent-text">Create one to start</button>
            </div>
          )}
        </div>

        {/* Main content */}
        {selected ? (
          <div className="lg:col-span-3 space-y-4">
            {/* Status summary */}
            <div className="card flex items-center justify-between">
              <div className="flex items-center gap-4">
                <StatusBadge status={selected.status} />
                <div className="text-sm">
                  <span className="text-muted">Items: </span>
                  <span className="font-semibold text-zinc-900">{clauses.length}</span>
                  <span className="mx-2 text-card-border">|</span>
                  <span className="text-muted">{deliverableCount} Deliverables, {assumptionCount} Assumptions, {exclusionCount} Exclusions</span>
                </div>
              </div>
              <div className="flex gap-2">
                {selected.status === "DRAFT" && (
                  <button onClick={() => transitionStatus(selected.id, "RELEASED")} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500">Release</button>
                )}
                {selected.status === "RELEASED" && (
                  <button onClick={() => transitionStatus(selected.id, "CONFIRMED")} className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-500">Confirm</button>
                )}
                {selected.status === "CONFIRMED" && (
                  <button onClick={() => transitionStatus(selected.id, "LOCKED")} className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-500">Lock</button>
                )}
                {selected.status === "LOCKED" && (
                  <button onClick={() => transitionStatus(selected.id, "SUPERSEDED")} className="btn-secondary text-xs">Supersede</button>
                )}
              </div>
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-1 border-b border-card-border">
              {TABS.map((tab) => {
                const count = tab === "All Items" ? clauses.length : tab === "Deliverables" ? deliverableCount : tab === "Assumptions" ? assumptionCount : exclusionCount;
                return (
                  <button key={tab} onClick={() => setActiveTab(tab)}
                    className={`px-4 py-2.5 text-sm font-medium transition-colors ${activeTab === tab ? "border-b-2 border-accent text-accent-text" : "text-muted hover:text-zinc-900"}`}>
                    {tab} <span className="ml-1 rounded-full bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600">{count}</span>
                  </button>
                );
              })}
            </div>

            {/* Toolbar */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                <input type="text" placeholder="Search truth items..." className="input pl-9" />
              </div>
              {selected.status === "DRAFT" && (
                <>
                  <button onClick={() => setShowAddClause(true)} className="btn-secondary">
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                    Add Item
                  </button>
                  <button onClick={() => { setShowParseModal(true); setParseStep("upload"); setParseFile(null); setParsedItems([]); }} className="btn-primary">
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" /></svg>
                    Parse SOW
                  </button>
                </>
              )}
            </div>

            {/* Add clause form */}
            {showAddClause && selected.status === "DRAFT" && (
              <div className="card space-y-3 border-accent/30 bg-accent-light/10">
                <h3 className="text-sm font-semibold text-zinc-900">Add Truth Item</h3>
                <div className="grid grid-cols-3 gap-3">
                  <input placeholder="Ref (e.g., 3.1)" value={clauseForm.clauseRef} onChange={(e) => setClauseForm({ ...clauseForm, clauseRef: e.target.value })} className="input" />
                  <select value={clauseForm.type} onChange={(e) => setClauseForm({ ...clauseForm, type: e.target.value })} className="input">
                    <optgroup label="Deliverables"><option value="PRICING">PRICING</option><option value="TIMELINE">TIMELINE</option><option value="SCOPE">SCOPE</option></optgroup>
                    <optgroup label="Assumptions"><option value="QUALITY">QUALITY</option><option value="REGULATORY">REGULATORY</option></optgroup>
                    <optgroup label="Exclusions"><option value="PAYMENT_TERMS">PAYMENT_TERMS</option><option value="IP">IP</option></optgroup>
                    <option value="OTHER">OTHER</option>
                  </select>
                  <input placeholder="Title *" value={clauseForm.title} onChange={(e) => setClauseForm({ ...clauseForm, title: e.target.value })} className="input" />
                </div>
                <input placeholder="Description" value={clauseForm.description} onChange={(e) => setClauseForm({ ...clauseForm, description: e.target.value })} className="input" />
                <div className="grid grid-cols-2 gap-3">
                  <input placeholder="Value (e.g., 150000)" type="number" value={clauseForm.value} onChange={(e) => setClauseForm({ ...clauseForm, value: e.target.value })} className="input" />
                  <input placeholder="Unit (e.g., USD/batch)" value={clauseForm.unit} onChange={(e) => setClauseForm({ ...clauseForm, unit: e.target.value })} className="input" />
                </div>
                <div className="flex gap-2">
                  <button onClick={addClause} className="btn-primary">Add Item</button>
                  <button onClick={() => setShowAddClause(false)} className="btn-secondary">Cancel</button>
                </div>
              </div>
            )}

            {/* Truth items */}
            {activeTab === "All Items" ? (
              <div className="space-y-6">
                {grouped.map((group) => group.items.length > 0 && (
                  <div key={group.label}>
                    <h3 className="mb-3 text-sm font-semibold text-zinc-700">{group.label}</h3>
                    <div className="space-y-2">
                      {group.items.map((c, i) => (
                        <TruthItemCard key={c.id} clause={c} index={i} programId={programId} isDraft={selected.status === "DRAFT"} isReleased={selected.status === "RELEASED"}
                          onEdit={() => openEditModal(c)} onDelete={() => deleteClause(c.id)} onConfirm={() => {/* per-item confirm is baseline-level */}} />
                      ))}
                    </div>
                  </div>
                ))}
                {clauses.length === 0 && (
                  <div className="card flex flex-col items-center py-12">
                    <svg className="h-10 w-10 text-zinc-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                    <p className="mt-3 font-medium text-zinc-900">No truth items yet</p>
                    <p className="mt-1 text-sm text-muted">Upload a SOW/WO to auto-parse, or add items manually</p>
                    <button onClick={() => { setShowParseModal(true); setParseStep("upload"); }} className="btn-primary mt-4">Parse SOW</button>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {filtered.map((c, i) => (
                  <TruthItemCard key={c.id} clause={c} index={i} programId={programId} isDraft={selected.status === "DRAFT"} isReleased={selected.status === "RELEASED"}
                    onEdit={() => openEditModal(c)} onDelete={() => deleteClause(c.id)} onConfirm={() => {}} />
                ))}
                {filtered.length === 0 && <div className="card py-8 text-center"><p className="text-sm text-muted">No {activeTab.toLowerCase()} in this baseline.</p></div>}
              </div>
            )}
          </div>
        ) : (
          <div className="lg:col-span-3 card flex flex-col items-center justify-center py-16">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-light">
              <svg className="h-7 w-7 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>
            </div>
            <p className="mt-4 font-medium text-zinc-900">Select a baseline</p>
            <p className="mt-1 text-sm text-muted">Choose a baseline from the left to view truth items</p>
          </div>
        )}
      </div>

      {/* ═══════ Parse SOW modal ═══════ */}
      {showParseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => !parsing && setShowParseModal(false)}>
          <div className="w-full max-w-2xl rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            {/* Modal header */}
            <div className="flex items-center justify-between border-b border-card-border px-6 py-4">
              <h3 className="text-lg font-semibold text-zinc-900">Parse SOW / Work Order</h3>
              {!parsing && (
                <button onClick={() => setShowParseModal(false)} className="text-muted hover:text-zinc-900">
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
              )}
            </div>

            <div className="p-6">
              {/* Step: Upload */}
              {parseStep === "upload" && (
                <div>
                  <p className="text-sm text-muted">Upload a SOW, MSA, or Work Order document. CGT-Sync will extract Deliverables, Assumptions, and Exclusions for your review.</p>
                  <div
                    className="mt-4 flex cursor-pointer flex-col items-center rounded-lg border-2 border-dashed border-zinc-300 bg-zinc-50 p-8 transition-colors hover:border-accent hover:bg-accent-light/10"
                    onClick={() => fileRef.current?.click()}
                  >
                    <svg className="h-10 w-10 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                    <p className="mt-3 text-sm font-medium text-zinc-700">{parseFile ? parseFile.name : "Click to select a file"}</p>
                    <p className="mt-1 text-xs text-muted">PDF, Word, or text files supported</p>
                    <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.txt" className="hidden" onChange={(e) => setParseFile(e.target.files?.[0] ?? null)} />
                  </div>
                  <div className="mt-6 flex justify-end gap-2">
                    <button onClick={() => setShowParseModal(false)} className="btn-secondary">Cancel</button>
                    <button onClick={handleParseSOW} disabled={!parseFile} className="btn-primary disabled:opacity-50">
                      Parse Document
                    </button>
                  </div>
                </div>
              )}

              {/* Step: Extracting */}
              {parseStep === "extracting" && (
                <div className="flex flex-col items-center py-8">
                  <svg className="h-8 w-8 animate-spin text-accent" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                  <p className="mt-4 font-medium text-zinc-900">Parsing document...</p>
                  <p className="mt-1 text-sm text-muted">AI is extracting Deliverables, Assumptions, and Exclusions</p>
                </div>
              )}

              {/* Step: Review parsed items */}
              {parseStep === "review" && (
                <div>
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-muted">
                      Extracted <span className="font-semibold text-zinc-900">{parsedItems.length}</span> items. Review each one — accept, edit, or reject.
                    </p>
                    <button onClick={acceptAllRemaining} className="text-xs font-medium text-accent hover:text-accent-text">Accept All Remaining</button>
                  </div>
                  <div className="mt-4 max-h-96 space-y-2 overflow-y-auto">
                    {parsedItems.map((item, idx) => (
                      <div key={idx} className={`rounded-lg border p-3 ${item._accepted ? "border-green-200 bg-green-50/50" : item._rejected ? "border-red-200 bg-red-50/50 opacity-50" : "border-card-border bg-card-bg"}`}>
                        <div className="flex items-start justify-between">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-zinc-600">{getCategory(item.type)}</span>
                              <StatusBadge status={item.type} />
                              {item._accepted && <span className="rounded-md bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-700">ACCEPTED</span>}
                              {item._rejected && <span className="rounded-md bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">REJECTED</span>}
                            </div>
                            <p className="mt-1 text-sm font-medium text-zinc-900">{item.title}</p>
                            {item.description && <p className="mt-0.5 text-xs text-muted">{item.description}</p>}
                            {item.value && <p className="mt-1 text-xs text-zinc-500">{Number(item.value).toLocaleString()} {item.unit ?? ""}</p>}
                          </div>
                          {!item._accepted && !item._rejected && (
                            <div className="ml-3 flex flex-shrink-0 items-center gap-1">
                              <button onClick={() => acceptParsedItem(idx)} title="Accept"
                                className="flex h-7 w-7 items-center justify-center rounded-md bg-green-50 text-green-600 hover:bg-green-100">
                                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
                              </button>
                              <button onClick={() => rejectParsedItem(idx)} title="Reject"
                                className="flex h-7 w-7 items-center justify-center rounded-md bg-red-50 text-red-600 hover:bg-red-100">
                                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                    {parsedItems.length === 0 && (
                      <div className="py-8 text-center text-sm text-muted">No items were extracted. Try a different document.</div>
                    )}
                  </div>
                  <div className="mt-6 flex justify-end gap-2">
                    <button onClick={() => setShowParseModal(false)} className="btn-primary">Done</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══════ Edit clause modal ═══════ */}
      {editingClause && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setEditingClause(null)}>
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-zinc-900">Propose Edit</h3>
            <p className="mt-1 text-sm text-muted">Edit this truth item. Changes apply to the current draft.</p>
            <div className="mt-4 space-y-3">
              <div><label className="mb-1 block text-xs font-medium text-muted">Title</label><input value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} className="input" /></div>
              <div><label className="mb-1 block text-xs font-medium text-muted">Description</label><input value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} className="input" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="mb-1 block text-xs font-medium text-muted">Value</label><input type="number" value={editForm.value} onChange={(e) => setEditForm({ ...editForm, value: e.target.value })} className="input" /></div>
                <div><label className="mb-1 block text-xs font-medium text-muted">Unit</label><input value={editForm.unit} onChange={(e) => setEditForm({ ...editForm, unit: e.target.value })} className="input" /></div>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setEditingClause(null)} className="btn-secondary">Cancel</button>
              <button onClick={saveEdit} className="btn-primary">Save Changes</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════ Send for Confirmation modal ═══════ */}
      {showConfirmModal && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowConfirmModal(false)}>
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-zinc-900">Send for Confirmation</h3>
            <p className="mt-2 text-sm text-muted">Generate a secure magic link for your CDMO counterparty to review and confirm this baseline.</p>
            <div className="mt-4 rounded-lg bg-zinc-50 p-3">
              <p className="text-xs text-muted">Baseline</p>
              <p className="font-medium text-zinc-900">v{selected.version}: {selected.title}</p>
              <p className="mt-1 text-xs text-muted">{clauses.length} truth items</p>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setShowConfirmModal(false)} className="btn-secondary">Cancel</button>
              <button onClick={() => createMagicLink(selected.id)} className="btn-primary">Generate Magic Link</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ───── Truth Item Card with per-item actions ───── */

function TruthItemCard({ clause, index, programId, isDraft, isReleased, onEdit, onDelete, onConfirm }: {
  clause: Clause; index: number; programId: string;
  isDraft: boolean; isReleased: boolean;
  onEdit: () => void; onDelete: () => void; onConfirm: () => void;
}) {
  const category = getCategory(clause.type);

  return (
    <div className="card card-hover flex items-start gap-4">
      <span className="mt-0.5 flex-shrink-0 font-mono text-xs font-semibold text-muted">
        #{clause.clauseRef ?? `t${index + 1}`}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="inline-flex rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-700">
            Proposed
          </span>
          <StatusBadge status={clause.type} />
          {isReleased && (
            <span className="rounded-md bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-600">Waiting for CDMO</span>
          )}
        </div>
        <h4 className="mt-1.5 font-medium text-zinc-900">{clause.title}</h4>
        {clause.description && <p className="mt-0.5 text-sm text-muted">{clause.description}</p>}
        <div className="mt-2 flex items-center gap-3">
          {clause.value && (
            <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700">
              {Number(clause.value).toLocaleString()} {clause.unit ?? ""}
            </span>
          )}
          <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500">{category}</span>
          <Link href={`/programs/${programId}/evidence`}
            className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600 hover:bg-blue-100">
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
            Evidence
          </Link>
        </div>
      </div>

      {/* Per-item action buttons */}
      {isDraft && (
        <div className="flex flex-shrink-0 items-center gap-1">
          <button onClick={onEdit} title="Edit"
            className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700">
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
          </button>
          <button onClick={onDelete} title="Remove"
            className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-red-50 hover:text-red-600">
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
          <button onClick={onConfirm} title="Confirm"
            className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-green-50 hover:text-green-600">
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
          </button>
        </div>
      )}
    </div>
  );
}
