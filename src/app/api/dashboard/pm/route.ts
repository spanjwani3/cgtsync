import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantOrgAccess } from "@/lib/server/auth";

export async function GET() {
  try {
    const auth = await requireTenantOrgAccess();

    const programs = await prisma.program.findMany({
      where: { orgId: auth.orgId, assignedPmId: auth.userId },
      include: {
        assignedPm: { select: { id: true, fullName: true, email: true } },
        _count: { select: { baselines: true, changes: true, invoices: true } },
        baselines: {
          where: { status: "RELEASED" },
          select: { id: true, version: true, title: true },
        },
        changes: {
          where: { status: "RELEASED" },
          select: { id: true, sequenceNum: true, title: true },
        },
        invoices: {
          select: { id: true, status: true, totalAmount: true, dueDate: true },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    let pendingTotal = 0;
    const enriched = programs.map((p) => {
      const pendingConfirmations = p.baselines.length + p.changes.length;
      pendingTotal += pendingConfirmations;

      const flaggedInvoices = p.invoices.filter((i) => i.status === "FLAGGED").length;
      const disputedInvoices = p.invoices.filter((i) => i.status === "DISPUTED").length;
      const totalInvoiced = p.invoices.reduce(
        (sum, i) => sum + (i.totalAmount ? Number(i.totalAmount) : 0), 0
      );
      const now = new Date();
      const overdueCount = p.invoices.filter(
        (i) => i.dueDate && new Date(i.dueDate) < now && i.status !== "APPROVED"
      ).length;

      return {
        id: p.id,
        name: p.name,
        cdmoName: p.cdmoName,
        molecule: p.molecule,
        status: p.status,
        assignedPm: p.assignedPm,
        _count: p._count,
        pendingConfirmations,
        pendingBaselines: p.baselines,
        pendingChanges: p.changes,
        flaggedInvoices,
        disputedInvoices,
        totalInvoiced,
        overdueCount,
      };
    });

    return NextResponse.json({ programs: enriched, userId: auth.userId, pendingTotal });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    console.error("[GET /api/dashboard/pm] Unhandled error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
