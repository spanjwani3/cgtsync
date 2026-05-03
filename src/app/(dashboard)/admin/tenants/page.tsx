import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/server/auth";
import AdminNav from "../AdminNav";
import TenantRow from "./TenantRow";

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
      <AdminNav active="tenants" />

      <div className="mt-6 flex items-center justify-between">
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
          {orgs.map((org) => (
            <TenantRow
              key={org.id}
              org={{
                id: org.id,
                name: org.name,
                slug: org.slug,
                programCount: org._count.programs,
                memberCount: org._count.members,
              }}
              rootDomain={rootDomain}
            />
          ))}
        </div>
      )}
    </div>
  );
}
