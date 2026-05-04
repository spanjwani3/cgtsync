import Image from "next/image";
import type { TenantSnapshot } from "@/lib/server/admin/tenantSnapshot";

interface Props {
  org: TenantSnapshot["org"];
  rootDomain: string;
}

export default function TenantHeader({ org, rootDomain }: Props) {
  const isSubdomainTenant = !org.slug.startsWith("org-");
  const tenantUrl = `https://${org.slug}.${rootDomain}`;

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-6">
        <div className="flex items-start gap-4">
          {org.logoUrl ? (
            <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md border border-zinc-200 bg-white">
              <Image
                src={org.logoUrl}
                alt={`${org.name} logo`}
                width={48}
                height={48}
                className="h-full w-full object-contain"
              />
            </div>
          ) : (
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 text-sm font-semibold text-zinc-500">
              {org.name.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-zinc-900">{org.name}</h1>
            <p className="mt-1 text-xs text-muted">
              <span className="font-mono">{org.slug}</span>
              {" · created "}
              {new Date(org.createdAt).toLocaleDateString()}
              {org.accentColor && (
                <>
                  {" · accent "}
                  <span
                    className="ml-0.5 inline-block h-2.5 w-2.5 rounded-sm align-middle"
                    style={{ backgroundColor: org.accentColor }}
                    aria-hidden
                  />
                  <span className="ml-1 font-mono">{org.accentColor}</span>
                </>
              )}
            </p>
            {isSubdomainTenant && (
              <a
                href={tenantUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-block text-xs text-accent-text underline"
              >
                {org.slug}.{rootDomain} ↗
              </a>
            )}
          </div>
        </div>
        <span className="shrink-0 rounded-full border border-zinc-300 bg-zinc-50 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-zinc-600">
          Read-only · Platform admin view
        </span>
      </div>
    </div>
  );
}
