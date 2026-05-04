"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface TenantRowProps {
  org: {
    id: string;
    name: string;
    slug: string;
    programCount: number;
    memberCount: number;
  };
  rootDomain: string;
}

export default function TenantRow({ org, rootDomain }: TenantRowProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const isSubdomainTenant = !org.slug.startsWith("org-");
  const tenantUrl = `https://${org.slug}.${rootDomain}`;

  return (
    <>
      <div className="card">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="font-semibold text-zinc-900">
              <Link
                href={`/admin/tenants/${org.slug}`}
                className="hover:text-accent-text hover:underline"
              >
                {org.name}
              </Link>
            </h3>
            <p className="mt-0.5 text-xs text-muted">
              <span className="font-mono">{org.slug}</span>
              {isSubdomainTenant && (
                <>
                  {" · "}
                  <a
                    href={tenantUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent-text underline"
                  >
                    {org.slug}.{rootDomain}
                  </a>
                </>
              )}
              {!isSubdomainTenant && (
                <span className="text-zinc-400">
                  {" · auto-generated org (no subdomain)"}
                </span>
              )}
            </p>
          </div>
          <div className="flex shrink-0 items-start gap-4">
            <div className="text-right text-xs text-muted">
              <p>
                {org.programCount} program{org.programCount === 1 ? "" : "s"}
              </p>
              <p>
                {org.memberCount} member{org.memberCount === 1 ? "" : "s"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              className="rounded border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
            >
              Delete
            </button>
          </div>
        </div>
      </div>

      {confirmOpen && (
        <DeleteTenantModal
          org={org}
          onClose={() => setConfirmOpen(false)}
        />
      )}
    </>
  );
}

function DeleteTenantModal({
  org,
  onClose,
}: {
  org: TenantRowProps["org"];
  onClose: () => void;
}) {
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canDelete = typed.trim() === org.slug;

  async function handleDelete() {
    if (!canDelete) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/tenants?slug=${encodeURIComponent(org.slug)}`,
        { method: "DELETE" },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Surface Prisma details when present so admins can diagnose
        // without digging through Vercel function logs.
        const parts = [body.error ?? `HTTP ${res.status}`];
        if (body.details && body.details !== body.error) parts.push(body.details);
        if (body.prismaCode) parts.push(`prismaCode: ${body.prismaCode}`);
        if (body.prismaMeta) parts.push(`prismaMeta: ${JSON.stringify(body.prismaMeta)}`);
        setError(parts.join(" — "));
        setSubmitting(false);
        return;
      }
      // Surface a vercel-domain warning even on success — non-fatal.
      if (body.vercelDomain?.error) {
        // eslint-disable-next-line no-console
        console.warn(
          `Tenant deleted but Vercel domain detach failed: ${body.vercelDomain.error}`,
        );
      }
      onClose();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
        <h2 className="text-lg font-semibold text-zinc-900">Delete tenant?</h2>
        <p className="mt-2 text-sm text-zinc-700">
          This will permanently delete <strong>{org.name}</strong> and cascade
          through every related row:
        </p>
        <ul className="mt-2 list-inside list-disc text-xs text-muted">
          <li>All programs ({org.programCount}) and their child data</li>
          <li>Org members ({org.memberCount}), invitations, and roles</li>
          <li>Baselines, changes, invoices, evidence, exports</li>
          <li>Scope analyses, scope alerts, extraction jobs</li>
          <li>Reminder schedules, contacts, ingest addresses</li>
        </ul>
        <p className="mt-3 text-xs text-zinc-700">
          This action cannot be undone. Type the slug{" "}
          <span className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-zinc-900">
            {org.slug}
          </span>{" "}
          to confirm.
        </p>
        <input
          autoFocus
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={org.slug}
          className="input mt-3 font-mono"
          disabled={submitting}
        />
        {error && (
          <div className="mt-3 max-h-48 overflow-auto rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">
            <pre className="whitespace-pre-wrap break-words font-mono">{error}</pre>
          </div>
        )}
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="btn-secondary disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={!canDelete || submitting}
            className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {submitting ? "Deleting…" : "Permanently delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
