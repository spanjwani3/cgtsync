import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireProgramAccess } from "@/lib/server/auth";
import { computeContractedTotal } from "@/lib/server/baselineReconciliation";

export async function GET(req: NextRequest) {
  try {
    const programId = req.nextUrl.searchParams.get("programId");
    if (!programId) return NextResponse.json({ error: "programId required" }, { status: 400 });
    await requireProgramAccess(programId);

    const program = await prisma.program.findUnique({
      where: { id: programId },
      select: { currency: true },
    });

    // Pull every PRICING clause on the latest locked/confirmed baseline so
    // we can apply the same quantity-aware, optional-aware, monetary-unit
    // filter the baseline review uses. Without this, the impact summary
    // disagrees with the reconciliation banner.
    const latestBaseline = await prisma.baseline.findFirst({
      where: { programId, status: { in: ["LOCKED", "CONFIRMED"] } },
      orderBy: { version: "desc" },
      include: {
        clauses: {
          where: { type: "PRICING" },
          select: {
            value: true,
            quantity: true,
            isOptional: true,
            scopeTier: true,
            type: true,
            unit: true,
          },
        },
      },
    });

    const baselineTotal = latestBaseline
      ? computeContractedTotal(
          latestBaseline.clauses.map((c) => ({
            value: c.value == null ? null : Number(c.value),
            quantity: Number(c.quantity ?? 1),
            isOptional: c.isOptional,
            scopeTier: c.scopeTier,
            type: c.type,
            unit: c.unit,
          })),
        )
      : 0;

    // Sum change impacts by status group
    const changes = await prisma.change.findMany({
      where: { programId },
      select: { status: true, estimatedImpact: true },
    });

    let confirmedChangesTotal = 0;
    let pendingChangesTotal = 0;
    for (const c of changes) {
      const impact = c.estimatedImpact ? Number(c.estimatedImpact) : 0;
      if (c.status === "CONFIRMED" || c.status === "LOGGED") {
        confirmedChangesTotal += impact;
      } else {
        pendingChangesTotal += impact;
      }
    }

    return NextResponse.json({
      baselineTotal,
      confirmedChangesTotal,
      pendingChangesTotal,
      projectedTotal: baselineTotal + confirmedChangesTotal,
      currency: program?.currency ?? "USD",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    console.error("[GET /api/changes/impact-summary] Unhandled error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
