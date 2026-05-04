import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireProgramAccess } from "@/lib/server/auth";
import { generateRequestId } from "@/lib/config";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MONETARY_CLAUSE_TYPES = ["PRICING", "PAYMENT_TERMS"] as const;

// Approved (commercially binding) change states.
const APPROVED_CHANGE_STATUSES = ["CONFIRMED", "LOGGED"] as const;

// Invoice states whose line items count toward "spent". A FLAGGED or DISPUTED
// invoice is still committed money — only invoices that were actively rejected
// would be excluded, and the schema has no such status.
const SPEND_INVOICE_STATUSES = ["UPLOADED", "MAPPED", "FLAGGED", "APPROVED", "DISPUTED"] as const;

interface OverBudgetCategory {
  clauseId: string;
  label: string;
  baseline: number;
  spent: number;
}

export async function GET(req: NextRequest) {
  const requestId = generateRequestId();
  try {
    const programId = req.nextUrl.searchParams.get("programId");
    if (!programId || !UUID_RE.test(programId)) {
      return NextResponse.json(
        { requestId, error: "programId query parameter required (UUID)" },
        { status: 400 },
      );
    }
    await requireProgramAccess(programId);

    const program = await prisma.program.findUnique({
      where: { id: programId },
      select: { id: true, currency: true, activatedAt: true },
    });
    if (!program) {
      return NextResponse.json({ requestId, error: "Program not found" }, { status: 404 });
    }

    // Find the active locked baseline (most-recently locked).
    const baseline = await prisma.baseline.findFirst({
      where: { programId, status: "LOCKED" },
      orderBy: { lockedAt: "desc" },
      select: { id: true, lockedAt: true },
    });

    if (!baseline) {
      return NextResponse.json({
        requestId,
        currency: program.currency,
        hasBaseline: false,
        baselineValue: 0,
        approvedChanges: 0,
        totalCommitted: 0,
        spent: 0,
        utilizationPct: 0,
        overBudgetCategories: [] as OverBudgetCategory[],
      });
    }

    // Sum monetary baseline clauses.
    const baselineClauses = await prisma.baselineClause.findMany({
      where: {
        baselineId: baseline.id,
        type: { in: [...MONETARY_CLAUSE_TYPES] },
        value: { not: null },
      },
      select: { id: true, title: true, value: true },
    });
    const baselineValue = baselineClauses.reduce(
      (sum, c) => sum + (c.value ? Number(c.value) : 0),
      0,
    );

    // Sum approved changes for the program.
    const approvedChangesAgg = await prisma.change.aggregate({
      where: {
        programId,
        status: { in: [...APPROVED_CHANGE_STATUSES] },
        estimatedImpact: { not: null },
      },
      _sum: { estimatedImpact: true },
    });
    const approvedChanges = approvedChangesAgg._sum.estimatedImpact
      ? Number(approvedChangesAgg._sum.estimatedImpact)
      : 0;

    const totalCommitted = baselineValue + approvedChanges;

    // Sum spent — line items on non-rejected invoices.
    const spentAgg = await prisma.invoiceLineItem.aggregate({
      where: {
        invoice: {
          programId,
          status: { in: [...SPEND_INVOICE_STATUSES] },
        },
      },
      _sum: { amount: true },
    });
    const spent = spentAgg._sum.amount ? Number(spentAgg._sum.amount) : 0;

    const utilizationPct = totalCommitted > 0 ? (spent / totalCommitted) * 100 : 0;

    // Per-category over-budget detection.
    const grouped = await prisma.invoiceLineItem.groupBy({
      by: ["clauseId"],
      where: {
        clauseId: { in: baselineClauses.map((c) => c.id) },
        invoice: {
          programId,
          status: { in: [...SPEND_INVOICE_STATUSES] },
        },
      },
      _sum: { amount: true },
    });

    const overBudgetCategories: OverBudgetCategory[] = grouped
      .map((g) => {
        const clause = baselineClauses.find((c) => c.id === g.clauseId);
        const spentAmount = g._sum.amount ? Number(g._sum.amount) : 0;
        const baselineAmount = clause?.value ? Number(clause.value) : 0;
        return {
          clauseId: g.clauseId ?? "",
          label: clause?.title ?? "Unmapped",
          baseline: baselineAmount,
          spent: spentAmount,
        };
      })
      .filter((c) => c.baseline > 0 && c.spent > c.baseline)
      .sort((a, b) => b.spent - b.baseline - (a.spent - a.baseline))
      .slice(0, 5);

    return NextResponse.json({
      requestId,
      currency: program.currency,
      hasBaseline: true,
      baselineValue,
      approvedChanges,
      totalCommitted,
      spent,
      utilizationPct,
      overBudgetCategories,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED")
      return NextResponse.json({ requestId, error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN")
      return NextResponse.json({ requestId, error: "Forbidden" }, { status: 403 });
    console.error("[GET /api/gateway/scope-envelope] Unhandled error:", e);
    return NextResponse.json(
      { requestId, error: "Internal server error" },
      { status: 500 },
    );
  }
}
