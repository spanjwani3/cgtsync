import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function ProgramsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const membership = await prisma.orgMember.findFirst({
    where: { userId: user.id },
    select: { orgId: true },
  });

  const programs = membership
    ? await prisma.program.findMany({
        where: { orgId: membership.orgId },
        include: { _count: { select: { baselines: true, changes: true, invoices: true } } },
        orderBy: { createdAt: "desc" },
      })
    : [];

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">Programs</h1>
          <p className="mt-1 text-sm text-zinc-500">Manage your Sponsor–CDMO programs</p>
        </div>
        <Link
          href="/onboarding"
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
        >
          New Program
        </Link>
      </div>

      {programs.length === 0 ? (
        <div className="mt-12 text-center">
          <p className="text-zinc-500">No programs yet</p>
          <p className="mt-1 text-sm text-zinc-400">Create your first program to get started</p>
          <Link
            href="/onboarding"
            className="mt-4 inline-block rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
          >
            Create Program
          </Link>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {programs.map((p) => (
            <Link
              key={p.id}
              href={`/programs/${p.id}/cockpit`}
              className="rounded-lg border border-card-border bg-card-bg p-5 transition-shadow hover:shadow-md"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-medium text-zinc-900">{p.name}</h3>
                  <p className="mt-0.5 text-sm text-zinc-500">{p.cdmoName}</p>
                </div>
                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                  p.status === "ACTIVE" ? "bg-green-100 text-green-700" :
                  p.status === "ARCHIVED" ? "bg-zinc-100 text-zinc-500" :
                  "bg-amber-100 text-amber-700"
                }`}>
                  {p.status}
                </span>
              </div>
              {(p.molecule || p.modality) && (
                <p className="mt-2 text-xs text-zinc-400">
                  {[p.molecule, p.modality].filter(Boolean).join(" · ")}
                </p>
              )}
              <div className="mt-3 flex gap-4 text-xs text-zinc-500">
                <span>{p._count.baselines} baselines</span>
                <span>{p._count.changes} changes</span>
                <span>{p._count.invoices} invoices</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
