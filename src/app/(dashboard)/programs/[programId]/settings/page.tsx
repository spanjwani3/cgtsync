import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireProgramAccess } from "@/lib/server/auth";
import { OrgRole } from "@/generated/prisma/client";
import ResetProgramPanel from "./ResetProgramPanel";

export const dynamic = "force-dynamic";

export default async function ProgramSettingsPage({
  params,
}: {
  params: Promise<{ programId: string }>;
}) {
  const { programId } = await params;

  try {
    await requireProgramAccess(programId, OrgRole.ADMIN);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED") redirect("/login");
    if (msg === "FORBIDDEN") redirect(`/programs/${programId}/cockpit`);
    redirect("/programs");
  }

  const program = await prisma.program.findUnique({
    where: { id: programId },
    select: { id: true, name: true, cdmoName: true, status: true },
  });
  if (!program) redirect("/programs");

  return (
    <div>
      <h1 className="text-2xl font-bold text-zinc-900">Program settings</h1>
      <p className="mt-1 text-sm text-muted">{program.name}</p>

      <section className="mt-10 border-t border-zinc-200 pt-8">
        <h2 className="text-lg font-semibold text-red-700">Danger zone</h2>
        <ResetProgramPanel
          programId={program.id}
          programName={program.name}
        />
      </section>
    </div>
  );
}
