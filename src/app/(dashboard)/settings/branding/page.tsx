import { redirect } from "next/navigation";
import { OrgRole } from "@/generated/prisma/client";
import { requireTenantOrgAccess } from "@/lib/server/auth";
import { prisma } from "@/lib/prisma";
import BrandingForm from "@/components/settings/BrandingForm";

export const dynamic = "force-dynamic";

export default async function BrandingSettingsPage() {
  let auth;
  try {
    auth = await requireTenantOrgAccess(OrgRole.ADMIN);
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    if (message === "FORBIDDEN") redirect("/dashboard");
    redirect("/login");
  }

  const org = await prisma.organization.findUnique({
    where: { id: auth.orgId },
    select: { id: true, name: true, logoUrl: true, accentColor: true },
  });

  if (!org) redirect("/dashboard");

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-zinc-900">Branding</h1>
        <p className="mt-1 text-sm text-muted">
          Customize how {org.name} appears across the product, emails, and exports.
        </p>
      </div>
      <BrandingForm
        orgName={org.name}
        initialLogoUrl={org.logoUrl}
        initialAccentColor={org.accentColor}
      />
    </div>
  );
}
