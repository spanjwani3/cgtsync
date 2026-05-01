"use client";

import { useState, useEffect, useRef } from "react";

interface Contact {
  id: string;
  name: string;
  email: string;
  contactType: string;
  organizationName: string | null;
}

interface ContactSelectorProps {
  programId: string;
  value: string;
  onChange: (email: string, name?: string) => void;
  placeholder?: string;
  label?: string;
  className?: string;
  contactType?: string;
}

const TYPE_COLORS: Record<string, string> = {
  CLIENT: "bg-blue-100 text-blue-700",
  INTERNAL: "bg-green-100 text-green-700",
  OTHER: "bg-zinc-100 text-zinc-600",
};

export default function ContactSelector({
  programId,
  value,
  onChange,
  placeholder = "Enter email address",
  label,
  className,
  contactType,
}: ContactSelectorProps) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`/api/programs/${programId}/contacts`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Contact[]) => setContacts(data))
      .catch(() => {});
  }, [programId]);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const filtered = contacts.filter((c) => {
    if (contactType && c.contactType !== contactType) return false;
    if (!filter) return true;
    const q = filter.toLowerCase();
    return c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q);
  });

  function handleSelect(contact: Contact) {
    onChange(contact.email, contact.name);
    setFilter("");
    setOpen(false);
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    onChange(val);
    setFilter(val);
    if (val && contacts.length > 0) setOpen(true);
  }

  return (
    <div className={`relative ${className ?? ""}`} ref={ref}>
      {label && (
        <label className="mb-1.5 block text-xs font-medium text-muted">{label}</label>
      )}
      <div className="flex gap-1">
        <input
          type="email"
          value={value}
          onChange={handleInputChange}
          onFocus={() => { if (contacts.length > 0) setOpen(true); }}
          placeholder={placeholder}
          className="input flex-1"
        />
        {contacts.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-card-border bg-white text-muted hover:bg-zinc-50"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </button>
        )}
      </div>
      {open && filtered.length > 0 && (
        <div className="absolute left-0 top-full z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-card-border bg-white py-1 shadow-lg">
          {filtered.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => handleSelect(c)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-50"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-zinc-900">{c.name}</p>
                <p className="truncate text-xs text-muted">{c.email}</p>
              </div>
              <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${TYPE_COLORS[c.contactType] ?? TYPE_COLORS.OTHER}`}>
                {c.contactType}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
