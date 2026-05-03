"use client";

import { useState } from "react";
import Link from "next/link";

interface OnboardedAdmin {
  email: string;
  userId: string | null;
  password: string | null;
  passwordReset: boolean;
  magicLink: string | null;
  welcomeEmail: {
    sent: boolean;
    resendId: string | null;
    error: string | null;
  };
  error: string | null;
}

interface OnboardResult {
  org: { id: string; name: string; slug: string };
  program: { id: string; name: string };
  tenantHost: string;
  loginUrl: string;
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
            Creates an organization, program, and Supabase Auth users, then
            emails each admin their login URL, magic link, and temp password.
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
        <h2 className="font-semibold text-zinc-900">Admin invitations</h2>
        <p className="mt-1 text-xs text-muted">
          A welcome email with login URL, magic link, and temp password was
          sent to each admin. If a send failed, the credentials below are still
          valid — copy them into a manual email as a fallback. Re-running this
          form resets passwords and resends invites. Credentials are shown{" "}
          <span className="font-medium">only once</span>.
        </p>
        <div className="mt-3 space-y-3">
          {result.admins.map((a) => (
            <AdminRow
              key={a.email}
              admin={a}
              loginUrl={result.loginUrl}
            />
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

function AdminRow({
  admin,
  loginUrl,
}: {
  admin: OnboardedAdmin;
  loginUrl: string;
}) {
  const allBlock = [
    `Sign in at ${loginUrl}`,
    `Email: ${admin.email}`,
    admin.password ? `Temporary password: ${admin.password}` : null,
    "",
    "Please change your password after signing in.",
  ]
    .filter((l) => l !== null)
    .join("\n");

  return (
    <div className="card">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="font-semibold text-zinc-900">{admin.email}</p>
        <div className="flex flex-wrap items-center gap-2">
          {admin.passwordReset && (
            <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
              existing user — password reset
            </span>
          )}
          {admin.welcomeEmail.sent && (
            <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
              welcome email sent
            </span>
          )}
          {!admin.welcomeEmail.sent && admin.userId && (
            <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
              email send failed — copy credentials below
            </span>
          )}
        </div>
      </div>

      {admin.error && (
        <p className="mt-2 text-xs text-red-600">{admin.error}</p>
      )}
      {admin.welcomeEmail.error && !admin.error && (
        <p className="mt-2 text-xs text-amber-700">
          Email delivery: {admin.welcomeEmail.error}
        </p>
      )}

      <div className="mt-3 space-y-2 text-sm">
        <CopyField label="Login URL" value={loginUrl} />
        <CopyField label="Email" value={admin.email} />
        {admin.password && (
          <CopyField
            label="Temporary password"
            value={admin.password}
            mono
          />
        )}
        {admin.magicLink && (
          <CopyField
            label="Magic link (backup)"
            value={admin.magicLink}
            mono
            truncate
          />
        )}
      </div>

      {admin.password && (
        <div className="mt-3 border-t border-card-border pt-3">
          <button
            onClick={() => navigator.clipboard.writeText(allBlock)}
            className="btn-secondary text-xs"
          >
            Copy all (URL + email + password)
          </button>
        </div>
      )}
    </div>
  );
}

function CopyField({
  label,
  value,
  mono,
  truncate,
}: {
  label: string;
  value: string;
  mono?: boolean;
  truncate?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-start gap-3">
      <div className="w-44 shrink-0 pt-0.5 text-xs uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      <div className="min-w-0 flex-1">
        <p
          className={`${mono ? "font-mono" : ""} ${truncate ? "truncate" : "break-all"} text-zinc-700`}
          title={value}
        >
          {value}
        </p>
      </div>
      <button
        onClick={() => {
          navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="shrink-0 rounded border border-zinc-200 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
