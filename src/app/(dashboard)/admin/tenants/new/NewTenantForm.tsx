"use client";

import { useState } from "react";
import Link from "next/link";

interface OnboardedAdmin {
  email: string;
  userId: string | null;
  magicLink: string | null;
  error: string | null;
}

interface OnboardResult {
  org: { id: string; name: string; slug: string };
  program: { id: string; name: string };
  tenantHost: string;
  admins: OnboardedAdmin[];
}

export default function NewTenantForm({ rootDomain }: { rootDomain: string }) {
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [program, setProgram] = useState("");
  const [cdmo, setCdmo] = useState("");
  const [adminsRaw, setAdminsRaw] = useState("");
  const [inbound, setInbound] = useState("");
  const [allowDomainsRaw, setAllowDomainsRaw] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<OnboardResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const computedInbound =
    inbound.trim() || (slug ? `${slug}@inbox.${rootDomain}` : "");
  const computedCdmo = cdmo.trim() || name.trim();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const admins = adminsRaw
        .split(/[,\n\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const allowDomains = allowDomainsRaw
        .split(/[,\n\s]+/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      const res = await fetch("/api/admin/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: slug.trim().toLowerCase(),
          name: name.trim(),
          program: program.trim(),
          cdmo: computedCdmo,
          admins,
          inbound: computedInbound || null,
          allowDomains,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
      } else {
        setResult(body as OnboardResult);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  }

  if (result) return <ResultView result={result} />;

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">New tenant</h1>
          <p className="mt-1 text-sm text-muted">
            Creates an organization, program, Supabase Auth users, and one-time
            magic links you can hand-email.
          </p>
        </div>
        <Link href="/admin/tenants" className="btn-secondary">
          Cancel
        </Link>
      </div>

      <form onSubmit={handleSubmit} className="mt-6 max-w-2xl space-y-5">
        <Field
          label="Slug"
          hint={`Lowercase. Used as subdomain: ${slug || "<slug>"}.${rootDomain}`}
        >
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            required
            pattern="[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
            className="input"
            placeholder="cellipont"
          />
        </Field>

        <Field label="Organization name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="input"
            placeholder="Cellipont"
          />
        </Field>

        <Field label="Program name">
          <input
            value={program}
            onChange={(e) => setProgram(e.target.value)}
            required
            className="input"
            placeholder="Cellipont — CDMO Manufacturing"
          />
        </Field>

        <Field
          label="CDMO name (optional)"
          hint={`Defaults to "${computedCdmo || "(org name)"}"`}
        >
          <input
            value={cdmo}
            onChange={(e) => setCdmo(e.target.value)}
            className="input"
            placeholder={name || "Cellipont"}
          />
        </Field>

        <Field
          label="Admin emails"
          hint="One per line, or comma-separated. Each becomes an org ADMIN with a magic link."
        >
          <textarea
            value={adminsRaw}
            onChange={(e) => setAdminsRaw(e.target.value)}
            required
            rows={4}
            className="input"
            placeholder={`jkuzniar@cellipont.com\ndkommireddy@cellipont.com\nebeale@cellipont.com`}
          />
        </Field>

        <Field
          label="Inbound email (optional)"
          hint={`Defaults to "${computedInbound || `<slug>@inbox.${rootDomain}`}". Leave blank to disable inbound email for this program.`}
        >
          <input
            type="email"
            value={inbound}
            onChange={(e) => setInbound(e.target.value)}
            className="input"
            placeholder={`${slug || "<slug>"}@inbox.${rootDomain}`}
          />
        </Field>

        <Field
          label="Allowed sender domains (optional)"
          hint="Comma-separated. e.g. cellipont.com — used to validate inbound email senders."
        >
          <input
            value={allowDomainsRaw}
            onChange={(e) => setAllowDomainsRaw(e.target.value)}
            className="input"
            placeholder="cellipont.com"
          />
        </Field>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={submitting}
            className="btn-primary disabled:opacity-50"
          >
            {submitting ? "Creating…" : "Create tenant"}
          </button>
          <p className="text-xs text-muted">
            Idempotent — re-running with the same slug updates existing rows
            and reissues magic links.
          </p>
        </div>
      </form>
    </div>
  );
}

function ResultView({ result }: { result: OnboardResult }) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Tenant created</h1>
          <p className="mt-1 text-sm text-muted">
            <a
              href={result.tenantHost}
              target="_blank"
              rel="noreferrer"
              className="text-accent-text underline"
            >
              {result.tenantHost}
            </a>
          </p>
        </div>
        <Link href="/admin/tenants" className="btn-secondary">
          Back to tenants
        </Link>
      </div>

      <div className="mt-6 card">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-zinc-500">
              Organization
            </p>
            <p className="mt-1 font-semibold text-zinc-900">
              {result.org.name}
            </p>
            <p className="mt-0.5 font-mono text-xs text-muted">
              {result.org.slug}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-zinc-500">
              Program
            </p>
            <p className="mt-1 font-semibold text-zinc-900">
              {result.program.name}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-8">
        <h2 className="font-semibold text-zinc-900">Magic links</h2>
        <p className="mt-1 text-xs text-muted">
          Send these to each admin. Each link signs the user in once and lands
          them on the tenant subdomain. Links expire per Supabase Auth
          settings.
        </p>
        <div className="mt-3 space-y-2">
          {result.admins.map((a) => (
            <AdminRow key={a.email} admin={a} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-zinc-700">{label}</span>
      {hint && <span className="mt-0.5 block text-xs text-muted">{hint}</span>}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

function AdminRow({ admin }: { admin: OnboardedAdmin }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-zinc-900">{admin.email}</p>
          {admin.error && (
            <p className="mt-1 text-xs text-red-600">{admin.error}</p>
          )}
          {admin.magicLink && (
            <p className="mt-1.5 break-all font-mono text-xs text-zinc-500">
              {admin.magicLink}
            </p>
          )}
          {!admin.magicLink && !admin.error && (
            <p className="mt-1 text-xs text-zinc-400">
              No magic link minted.
            </p>
          )}
        </div>
        {admin.magicLink && (
          <button
            onClick={() => {
              navigator.clipboard.writeText(admin.magicLink!);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="btn-secondary shrink-0"
          >
            {copied ? "Copied" : "Copy link"}
          </button>
        )}
      </div>
    </div>
  );
}
