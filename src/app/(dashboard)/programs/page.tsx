import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import StatusBadge from "@/components/ui/StatusBadge";

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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Programs</h1>
          <p className="mt-1 text-sm text-muted">Manage your Sponsor-CDMO programs</p>
        </div>
        <Link href="/onboarding" className="btn-primary">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          New Program
        </Link>
      </div>

      {programs.length === 0 ? (
        <div className="mt-16 flex flex-col items-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-light">
            <svg className="h-8 w-8 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
          </div>
          <p className="mt-4 font-medium text-zinc-900">No programs yet</p>
          <p className="mt-1 text-sm text-muted">Create your first program to get started</p>
          <Link href="/onboarding" className="btn-primary mt-5">Create Program</Link>
        </div>
      ) : (
        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {programs.map((p) => (
            <Link
              key={p.id}
              href={`/programs/${p.id}/cockpit`}
              className="card card-hover group"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-accent-light">
                    <svg className="h-5 w-5 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-zinc-900 group-hover:text-accent-text">{p.name}</h3>
                    <p className="mt-0.5 text-sm text-muted">{p.cdmoName}</p>
                  </div>
                </div>
                <StatusBadge status={p.status} />
              </div>
              {(p.molecule || p.modality) && (
                <p className="mt-3 text-xs text-muted">
                  {[p.molecule, p.modality].filter(Boolean).join(" · ")}
                </p>
              )}
              <div className="mt-4 flex gap-4 border-t border-card-border pt-3 text-xs text-muted">
                <span className="flex items-center gap-1">
                  <span className="font-semibold text-zinc-700">{p._count.baselines}</span> baselines
                </span>
                <span className="flex items-center gap-1">
                  <span className="font-semibold text-zinc-700">{p._count.changes}</span> changes
                </span>
                <span className="flex items-center gap-1">
                  <span className="font-semibold text-zinc-700">{p._count.invoices}</span> invoices
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
