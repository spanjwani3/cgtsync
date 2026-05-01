import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export default async function TenantsPage() {
  try {
    await requirePlatformAdmin();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED") redirect("/login");
    redirect("/programs");
  }

  const orgs = await prisma.organization.findMany({
    select: {
      id: true,
      name: true,
      slug: true,
      createdAt: true,
      _count: { select: { programs: true, members: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const rootDomain = process.env.ROOT_DOMAIN ?? "cgtsync.ai";

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Tenants</h1>
          <p className="mt-1 text-sm text-muted">
            All organizations on the platform
          </p>
        </div>
        <Link href="/admin/tenants/new" className="btn-primary">
          + New Tenant
        </Link>
      </div>

      {orgs.length === 0 ? (
        <p className="mt-12 text-sm text-muted">
          No tenants yet. Create the first one.
        </p>
      ) : (
        <div className="mt-6 grid gap-3">
          {orgs.map((org) => {
            const isSubdomainTenant = !org.slug.startsWith("org-");
            const tenantUrl = `https://${org.slug}.${rootDomain}`;
            return (
              <div key={org.id} className="card">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-zinc-900">{org.name}</h3>
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
                  <div className="shrink-0 text-right text-xs text-muted">
                    <p>
                      {org._count.programs} program
                      {org._count.programs === 1 ? "" : "s"}
                    </p>
                    <p>
                      {org._count.members} member
                      {org._count.members === 1 ? "" : "s"}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
