import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { OrgRole } from "@/generated/prisma/client";
import { requireTenantOrgAccess } from "@/lib/server/auth";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireTenantOrgAccess(OrgRole.ADMIN);

    const assignedPmId = req.nextUrl.searchParams.get("assignedPmId");
    const where: Record<string, unknown> = { orgId: auth.orgId };
    if (assignedPmId) where.assignedPmId = assignedPmId;

    const programs = await prisma.program.findMany({
      where,
      include: {
        assignedPm: { select: { id: true, fullName: true, email: true } },
        _count: { select: { baselines: true, changes: true, invoices: true } },
        invoices: {
          select: { id: true, status: true, totalAmount: true, dueDate: true },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    // Get last activity per program from event logs
    const programIds = programs.map((p) => p.id);
    const lastActivity = programIds.length > 0
      ? await prisma.eventLog.findMany({
          where: { programId: { in: programIds } },
          orderBy: { createdAt: "desc" },
          distinct: ["programId"],
          select: { programId: true, createdAt: true },
        })
      : [];
    const activityMap = Object.fromEntries(
      lastActivity.map((a) => [a.programId!, a.createdAt])
    );

    let totalInvoiced = 0;
    let totalOutstanding = 0;
    let totalFlagged = 0;

    const enriched = programs.map((p) => {
      const invoiced = p.invoices.reduce(
        (sum, i) => sum + (i.totalAmount ? Number(i.totalAmount) : 0), 0
      );
      const outstanding = p.invoices
        .filter((i) => i.status !== "APPROVED")
        .reduce((sum, i) => sum + (i.totalAmount ? Number(i.totalAmount) : 0), 0);
      const flagged = p.invoices.filter((i) => i.status === "FLAGGED").length;

      totalInvoiced += invoiced;
      totalOutstanding += outstanding;
      totalFlagged += flagged;

      const lastActivityDate = activityMap[p.id];
      const daysSinceActivity = lastActivityDate
        ? Math.floor((Date.now() - new Date(lastActivityDate).getTime()) / (1000 * 60 * 60 * 24))
        : null;

      return {
        id: p.id,
        name: p.name,
        cdmoName: p.cdmoName,
        molecule: p.molecule,
        status: p.status,
        assignedPm: p.assignedPm,
        _count: p._count,
        invoiced,
        outstanding,
        flagged,
        lastActivity: lastActivityDate ?? null,
        daysSinceActivity,
      };
    });

    return NextResponse.json({
      programs: enriched,
      totals: { totalInvoiced, totalOutstanding, totalFlagged, programCount: programs.length },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN") return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    console.error("[GET /api/dashboard/portfolio] Unhandled error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
