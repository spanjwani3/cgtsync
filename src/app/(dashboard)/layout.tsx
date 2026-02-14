import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import Sidebar from "@/components/layout/Sidebar";

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

  // Ensure org membership exists
  let membership = await prisma.orgMember.findFirst({
    where: { userId: user.id },
    include: { org: true },
  });

  if (!membership) {
    const org = await prisma.organization.create({
      data: {
        name: `${user.email?.split("@")[0]}'s Organization`,
        slug: `org-${user.id.slice(0, 8)}`,
      },
    });
    await prisma.orgMember.create({
      data: { orgId: org.id, userId: user.id, role: "ADMIN" },
    });
    membership = await prisma.orgMember.findFirst({
      where: { userId: user.id },
      include: { org: true },
    });
  }

  const navigation = [
    { label: "Programs", href: "/programs" },
    { label: "New Program", href: "/onboarding" },
  ];

  return (
    <div className="min-h-screen bg-background">
      <Sidebar
        orgName={membership?.org.name ?? "Organization"}
        userEmail={user.email ?? ""}
        navigation={navigation}
      />
      <main className="ml-60 min-h-screen p-6">{children}</main>
    </div>
  );
}
