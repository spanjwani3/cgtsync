import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { OrgRole } from "@/generated/prisma/client";
import { requireTenantOrgAccess } from "@/lib/server/auth";

export async function GET() {
  try {
    const auth = await requireTenantOrgAccess(OrgRole.ADMIN);
    const orgId = auth.orgId;

    // Fetch all invoices across org
    const invoices = await prisma.invoice.findMany({
      where: { program: { orgId } },
      select: {
        id: true,
        totalAmount: true,
        dueDate: true,
        status: true,
        currency: true,
        program: { select: { id: true, name: true, cdmoName: true } },
      },
    });

    const now = new Date();
    let totalInvoiced = 0;
    let totalOutstanding = 0;
    let flaggedCount = 0;
    let disputedCount = 0;

    // Aging buckets
    const buckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, noDueDate: 0 };
    const bucketCounts = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 };

    // Collection velocity: approved invoices in last 30 days
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    let collectedCount = 0;
    let collectedAmount = 0;

    // Delinquent tracking per program
    const delinquentMap = new Map<string, { programId: string; name: string; cdmoName: string; overdueAmount: number; maxDaysOverdue: number }>();

    for (const inv of invoices) {
      const amount = inv.totalAmount ? Number(inv.totalAmount) : 0;
      totalInvoiced += amount;

      if (inv.status !== "APPROVED") {
        totalOutstanding += amount;
      }
      if (inv.status === "FLAGGED") flaggedCount++;
      if (inv.status === "DISPUTED") disputedCount++;

      // Aging
      if (inv.dueDate && inv.status !== "APPROVED") {
        const daysPast = Math.floor((now.getTime() - new Date(inv.dueDate).getTime()) / (1000 * 60 * 60 * 24));
        if (daysPast <= 0) { buckets.current += amount; bucketCounts.current++; }
        else if (daysPast <= 30) { buckets.d1_30 += amount; bucketCounts.d1_30++; }
        else if (daysPast <= 60) { buckets.d31_60 += amount; bucketCounts.d31_60++; }
        else if (daysPast <= 90) { buckets.d61_90 += amount; bucketCounts.d61_90++; }
        else { buckets.d90plus += amount; bucketCounts.d90plus++; }

        // Track delinquent
        if (daysPast > 0) {
          const key = inv.program.id;
          const existing = delinquentMap.get(key);
          if (existing) {
            existing.overdueAmount += amount;
            existing.maxDaysOverdue = Math.max(existing.maxDaysOverdue, daysPast);
          } else {
            delinquentMap.set(key, {
              programId: inv.program.id,
              name: inv.program.name,
              cdmoName: inv.program.cdmoName,
              overdueAmount: amount,
              maxDaysOverdue: daysPast,
            });
          }
        }
      } else if (!inv.dueDate && inv.status !== "APPROVED") {
        buckets.noDueDate += amount;
      }

      // Collection velocity
      if (inv.status === "APPROVED" && inv.dueDate && new Date(inv.dueDate) >= thirtyDaysAgo) {
        collectedCount++;
        collectedAmount += amount;
      }
    }

    // Determine dominant currency
    const currencies = [...new Set(invoices.map((i) => i.currency))];
    const currency = currencies.length === 1 ? currencies[0] : currencies[0] ?? "USD";

    const delinquentAccounts = [...delinquentMap.values()]
      .sort((a, b) => b.overdueAmount - a.overdueAmount);

    const agingTotal = buckets.current + buckets.d1_30 + buckets.d31_60 + buckets.d61_90 + buckets.d90plus;

    return NextResponse.json({
      metrics: {
        totalInvoiced,
        totalOutstanding,
        flaggedCount,
        disputedCount,
        currency,
        invoiceCount: invoices.length,
      },
      agingBuckets: [
        { label: "Current", amount: buckets.current, count: bucketCounts.current, percentage: agingTotal > 0 ? Math.round((buckets.current / agingTotal) * 100) : 0 },
        { label: "1–30 days", amount: buckets.d1_30, count: bucketCounts.d1_30, percentage: agingTotal > 0 ? Math.round((buckets.d1_30 / agingTotal) * 100) : 0 },
        { label: "31–60 days", amount: buckets.d31_60, count: bucketCounts.d31_60, percentage: agingTotal > 0 ? Math.round((buckets.d31_60 / agingTotal) * 100) : 0 },
        { label: "61–90 days", amount: buckets.d61_90, count: bucketCounts.d61_90, percentage: agingTotal > 0 ? Math.round((buckets.d61_90 / agingTotal) * 100) : 0 },
        { label: "90+ days", amount: buckets.d90plus, count: bucketCounts.d90plus, percentage: agingTotal > 0 ? Math.round((buckets.d90plus / agingTotal) * 100) : 0 },
      ],
      collectionVelocity: { count: collectedCount, amount: collectedAmount, periodDays: 30 },
      delinquentAccounts,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN") return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    console.error("[GET /api/dashboard/executive] Unhandled error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
