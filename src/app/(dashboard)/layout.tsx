import type { CSSProperties } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { getTenantContext, MULTI_TENANT_MODE } from "@/lib/server/tenant";
import { getSignedUrl } from "@/lib/server/storage";
import { ProgramProvider } from "@/components/layout/ProgramContext";
import { AuditDrawerProvider } from "@/components/layout/AuditDrawerContext";
import SidebarWithContext from "@/components/layout/SidebarWithContext";
import AuditDrawer from "@/components/layout/AuditDrawer";
import { isValidHex, shade } from "@/lib/brand/shade";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Ensure user record exists
  await prisma.user.upsert({
    where: { id: user.id },
    update: { email: user.email ?? "" },
    create: {
      id: user.id,
      email: user.email ?? "",
      fullName: user.user_metadata?.full_name ?? null,
    },
  });

  // Resolve the org context. In multi-tenant mode on a tenant subdomain,
  // the middleware sets x-tenant-org-id headers; we render the layout for
  // that specific tenant org. Otherwise (apex, admin host, MT_MODE=OFF)
  // we fall back to the user's earliest-joined membership.
  const tenant = await getTenantContext();
  let membership = tenant
    ? await prisma.orgMember.findUnique({
        where: { orgId_userId: { orgId: tenant.orgId, userId: user.id } },
        include: { org: true },
      })
    : await prisma.orgMember.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: "asc" },
        include: { org: true },
      });

  // First-login bootstrap: only auto-create a personal org when MT_MODE is OFF
  // AND there's no tenant context. Under MT_MODE on a tenant subdomain, a user
  // without membership in this tenant should be signed out — they shouldn't
  // silently get a new org provisioned just by visiting the URL.
  if (!membership && !tenant && !MULTI_TENANT_MODE) {
    try {
      const org = await prisma.organization.create({
        data: {
          name: `${user.email?.split("@")[0]}'s Organization`,
          slug: `org-${user.id.slice(0, 8)}`,
        },
      });
      await prisma.orgMember.create({
        data: { orgId: org.id, userId: user.id, role: "ADMIN" },
      });
    } catch {
      // Unique constraint violation — callback or another request already created it
    }
    membership = await prisma.orgMember.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
      include: { org: true },
    });
  }

  // No membership in this tenant (or no membership at all). Sign out and
  // bounce to /login with an error so the URL doesn't loop.
  if (!membership) {
    await supabase.auth.signOut();
    redirect("/login?error=no_org_membership");
  }

  // Resolve tenant branding for the sidebar + global dashboard accent.
  const accentColor =
    membership.org.accentColor && isValidHex(membership.org.accentColor)
      ? membership.org.accentColor
      : null;
  let logoSignedUrl: string | null = null;
  if (membership.org.logoUrl) {
    try {
      logoSignedUrl = await getSignedUrl(membership.org.logoUrl, 3600);
    } catch (err) {
      console.warn("[dashboard layout] failed to sign tenant logo:", err);
    }
  }
  const tenantStyle: CSSProperties | undefined = accentColor
    ? ({
        ["--accent" as string]: accentColor,
        ["--accent-hover" as string]: shade(accentColor, -12),
        ["--sidebar-active" as string]: accentColor,
        ["--sidebar-active-hover" as string]: shade(accentColor, -12),
      } as CSSProperties)
    : undefined;
  const isOrgAdmin = membership.role === "ADMIN";

  return (
    <div className="tenant-branding min-h-screen bg-background" style={tenantStyle}>
      <ProgramProvider>
        <AuditDrawerProvider>
          <SidebarWithContext
            orgName={membership.org.name}
            userEmail={user.email ?? ""}
            userName={user.user_metadata?.full_name ?? undefined}
            isOrgAdmin={isOrgAdmin}
            logoUrl={logoSignedUrl}
            accentColor={accentColor}
          />
          <main className="ml-60 min-h-screen p-6 lg:p-8">{children}</main>
          <AuditDrawer />
        </AuditDrawerProvider>
      </ProgramProvider>
    </div>
  );
}
