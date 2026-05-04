import { redirect } from "next/navigation";
import { OrgRole } from "@/generated/prisma/client";
import { requireTenantOrgAccess } from "@/lib/server/auth";
import { prisma } from "@/lib/prisma";
import AuditPageClient from "@/components/audit/AuditPageClient";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  let auth;
  try {
    auth = await requireTenantOrgAccess(OrgRole.ADMIN);
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    if (message === "FORBIDDEN") redirect("/dashboard");
    redirect("/login");
  }

  const [members, programs] = await Promise.all([
    prisma.user.findMany({
      where: { memberships: { some: { orgId: auth.orgId } } },
      select: { id: true, email: true, fullName: true },
      orderBy: { email: "asc" },
    }),
    prisma.program.findMany({
      where: { orgId: auth.orgId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-zinc-900">Audit Log</h1>
        <p className="mt-1 text-sm text-muted">
          Immutable record of every action across the organization. All entries are timestamped, signed by user, and IP-stamped.
        </p>
      </div>
      <AuditPageClient
        members={members}
        programs={programs}
      />
    </div>
  );
}
