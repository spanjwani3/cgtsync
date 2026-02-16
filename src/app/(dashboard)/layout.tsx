import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { ProgramProvider } from "@/components/layout/ProgramContext";
import { AuditDrawerProvider } from "@/components/layout/AuditDrawerContext";
import SidebarWithContext from "@/components/layout/SidebarWithContext";
import AuditDrawer from "@/components/layout/AuditDrawer";

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

  // Ensure org membership exists (idempotent — handles race with callback)
  let membership = await prisma.orgMember.findFirst({
    where: { userId: user.id },
    include: { org: true },
  });

  if (!membership) {
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
      include: { org: true },
    });
  }

  return (
    <div className="min-h-screen bg-background">
      <ProgramProvider>
        <AuditDrawerProvider>
          <SidebarWithContext
            orgName={membership?.org.name ?? "Organization"}
            userEmail={user.email ?? ""}
            userName={user.user_metadata?.full_name ?? undefined}
          />
          <main className="ml-60 min-h-screen p-6 lg:p-8">{children}</main>
          <AuditDrawer />
        </AuditDrawerProvider>
      </ProgramProvider>
    </div>
  );
}
