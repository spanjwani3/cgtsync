"use client";

import { useState, useEffect, useCallback } from "react";
import StatusBadge from "@/components/ui/StatusBadge";

interface Contact {
  id: string;
  name: string;
  email: string;
  title: string | null;
  organizationName: string | null;
  contactType: string;
  phone: string | null;
  isPrimary: boolean;
  lastContactedAt: string | null;
}

interface ContactManagerProps {
  programId: string;
}

const CONTACT_TYPES = ["CLIENT", "INTERNAL", "OTHER"];

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return "—";
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export default function ContactManager({ programId }: ContactManagerProps) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form state
  const [formName, setFormName] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formTitle, setFormTitle] = useState("");
  const [formOrg, setFormOrg] = useState("");
  const [formType, setFormType] = useState("CLIENT");
  const [formPhone, setFormPhone] = useState("");
  const [formPrimary, setFormPrimary] = useState(false);
  const [saving, setSaving] = useState(false);

  // Import state
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; errors: { row: number; error: string }[] } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/programs/${programId}/contacts`);
      if (res.ok) setContacts(await res.json());
    } catch { /* silent */ }
    setLoading(false);
  }, [programId]);

  useEffect(() => { load(); }, [load]);

  function resetForm() {
    setFormName(""); setFormEmail(""); setFormTitle(""); setFormOrg("");
    setFormType("CLIENT"); setFormPhone(""); setFormPrimary(false);
    setEditingId(null); setShowForm(false);
  }

  function startEdit(c: Contact) {
    setFormName(c.name); setFormEmail(c.email);
    setFormTitle(c.title ?? ""); setFormOrg(c.organizationName ?? "");
    setFormType(c.contactType); setFormPhone(c.phone ?? "");
    setFormPrimary(c.isPrimary); setEditingId(c.id); setShowForm(true);
  }

  async function handleSave() {
    if (!formName.trim() || !formEmail.trim()) {
      setError("Name and email are required");
      return;
    }
    setSaving(true);
    setError("");

    const body = {
      name: formName.trim(),
      email: formEmail.trim(),
      title: formTitle.trim() || null,
      organizationName: formOrg.trim() || null,
      contactType: formType,
      phone: formPhone.trim() || null,
      isPrimary: formPrimary,
    };

    try {
      const url = editingId
        ? `/api/programs/${programId}/contacts/${editingId}`
        : `/api/programs/${programId}/contacts`;
      const res = await fetch(url, {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        resetForm();
        await load();
      } else {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "Failed to save contact");
      }
    } catch {
      setError("Failed to save contact");
    }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this contact?")) return;
    const res = await fetch(`/api/programs/${programId}/contacts/${id}`, { method: "DELETE" });
    if (res.ok) await load();
    else {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Failed to delete contact");
    }
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    setError("");

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`/api/programs/${programId}/contacts/import`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (res.ok) {
        setImportResult(data);
        await load();
      } else {
        setError(data?.error ?? "Import failed");
      }
    } catch {
      setError("Import failed");
    }
    setImporting(false);
    e.target.value = "";
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex items-center gap-3 text-sm text-muted">
          <svg className="h-5 w-5 animate-spin text-accent" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
          Loading contacts...
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Contacts</h1>
          <p className="mt-1 text-sm text-muted">Manage program contacts for email delivery</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="btn-secondary cursor-pointer text-sm">
            {importing ? "Importing..." : "Import CSV"}
            <input type="file" accept=".csv,.xlsx,.xls" onChange={handleImport} className="hidden" disabled={importing} />
          </label>
          <button onClick={() => { resetForm(); setShowForm(true); }} className="btn-primary">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Add Contact
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {importResult && (
        <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          Imported {importResult.imported} contacts.
          {importResult.errors.length > 0 && (
            <span className="ml-1 text-amber-600">{importResult.errors.length} rows skipped.</span>
          )}
          <button onClick={() => setImportResult(null)} className="ml-2 font-medium underline">Dismiss</button>
        </div>
      )}

      {/* Add/Edit Form */}
      {showForm && (
        <div className="mt-4 card">
          <h3 className="text-sm font-semibold text-zinc-900">{editingId ? "Edit Contact" : "New Contact"}</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">Name *</label>
              <input value={formName} onChange={(e) => setFormName(e.target.value)} className="input w-full" placeholder="Jane Smith" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">Email *</label>
              <input type="email" value={formEmail} onChange={(e) => setFormEmail(e.target.value)} className="input w-full" placeholder="jane@example.com" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">Type</label>
              <select value={formType} onChange={(e) => setFormType(e.target.value)} className="input w-full">
                {CONTACT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">Title</label>
              <input value={formTitle} onChange={(e) => setFormTitle(e.target.value)} className="input w-full" placeholder="VP Supply Chain" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">Organization</label>
              <input value={formOrg} onChange={(e) => setFormOrg(e.target.value)} className="input w-full" placeholder="CDMO Inc." />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">Phone</label>
              <input value={formPhone} onChange={(e) => setFormPhone(e.target.value)} className="input w-full" placeholder="+1 555-0100" />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-zinc-700">
              <input type="checkbox" checked={formPrimary} onChange={(e) => setFormPrimary(e.target.checked)} className="rounded" />
              Primary contact
            </label>
            <div className="flex-1" />
            <button onClick={resetForm} className="btn-secondary text-sm">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="btn-primary text-sm">
              {saving ? "Saving..." : editingId ? "Update" : "Add"}
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      {contacts.length === 0 ? (
        <div className="mt-16 flex flex-col items-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-light">
            <svg className="h-8 w-8 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </div>
          <p className="mt-4 font-medium text-zinc-900">No contacts yet</p>
          <p className="mt-1 text-sm text-muted">Add contacts to quickly select recipients for emails</p>
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Type</th>
                <th>Organization</th>
                <th>Phone</th>
                <th>Last Contacted</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id}>
                  <td>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-zinc-900">{c.name}</span>
                      {c.isPrimary && (
                        <span className="rounded-full bg-accent-light px-1.5 py-0.5 text-[10px] font-semibold text-accent-text">Primary</span>
                      )}
                    </div>
                    {c.title && <p className="text-xs text-muted">{c.title}</p>}
                  </td>
                  <td className="text-zinc-700">{c.email}</td>
                  <td><StatusBadge status={c.contactType} /></td>
                  <td className="text-zinc-600">{c.organizationName ?? "—"}</td>
                  <td className="text-zinc-600">{c.phone ?? "—"}</td>
                  <td className="text-zinc-500">{relativeTime(c.lastContactedAt)}</td>
                  <td className="text-right">
                    <button onClick={() => startEdit(c)} className="mr-2 text-xs font-medium text-accent hover:text-accent-text">Edit</button>
                    <button onClick={() => handleDelete(c.id)} className="text-xs font-medium text-red-500 hover:text-red-700">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
