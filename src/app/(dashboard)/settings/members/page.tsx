import { redirect } from "next/navigation";
import { OrgRole } from "@/generated/prisma/client";
import { requireTenantOrgAccess } from "@/lib/server/auth";
import { prisma } from "@/lib/prisma";
import MembersClient, { type MemberRow } from "./MembersClient";

export const dynamic = "force-dynamic";

export default async function MembersSettingsPage() {
  let auth;
  try {
    auth = await requireTenantOrgAccess(OrgRole.ADMIN);
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    if (message === "FORBIDDEN") redirect("/dashboard");
    redirect("/login");
  }

  const [org, members, lastActivityRows] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: auth.orgId },
      select: { name: true },
    }),
    prisma.orgMember.findMany({
      where: { orgId: auth.orgId },
      include: {
        user: { select: { id: true, fullName: true, email: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.eventLog.groupBy({
      by: ["userId"],
      where: { program: { orgId: auth.orgId }, userId: { not: null } },
      _max: { createdAt: true },
    }),
  ]);

  const lastActivityMap = new Map<string, Date>();
  for (const r of lastActivityRows) {
    if (r.userId && r._max.createdAt) lastActivityMap.set(r.userId, r._max.createdAt);
  }

  const rows: MemberRow[] = members.map((m) => ({
    userId: m.user.id,
    email: m.user.email,
    fullName: m.user.fullName,
    role: m.role,
    joinedAt: m.createdAt.toISOString(),
    lastActivityAt: lastActivityMap.get(m.user.id)?.toISOString() ?? null,
    isSelf: m.user.id === auth.userId,
  }));

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-zinc-900">Members</h1>
        <p className="mt-1 text-sm text-muted">
          People with access to {org?.name ?? "this workspace"}. Invite teammates,
          assign roles, and resend credentials.
        </p>
      </div>
      <MembersClient initialMembers={rows} />
    </div>
  );
}
