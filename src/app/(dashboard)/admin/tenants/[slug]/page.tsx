import { notFound, redirect } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/server/auth";
import {
  findOrgBySlug,
  getTenantSnapshot,
} from "@/lib/server/admin/tenantSnapshot";
import AdminNav from "../../AdminNav";
import TenantHeader from "./TenantHeader";
import MetricsPanel from "./MetricsPanel";
import HealthSignals from "./HealthSignals";
import ProgramsPanel from "./ProgramsPanel";
import UsersPanel from "./UsersPanel";
import ActivityPanel from "./ActivityPanel";

export const dynamic = "force-dynamic";

export default async function TenantCockpitPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  try {
    await requirePlatformAdmin();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED") redirect("/login");
    redirect("/programs");
  }

  const { slug } = await params;
  const org = await findOrgBySlug(slug);
  if (!org) notFound();

  const snapshot = await getTenantSnapshot(org.id);
  if (!snapshot) notFound();

  const rootDomain = process.env.ROOT_DOMAIN ?? "cgtsync.ai";

  return (
    <div>
      <AdminNav active="tenants" />

      <div className="mt-6 space-y-4">
        <TenantHeader org={snapshot.org} rootDomain={rootDomain} />
        <MetricsPanel totals={snapshot.totals} />
        <HealthSignals health={snapshot.health} />
        <ProgramsPanel programs={snapshot.programs} />
        <UsersPanel users={snapshot.users} />
        <ActivityPanel orgId={snapshot.org.id} activity={snapshot.activity} />
      </div>
    </div>
  );
}
