import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { OrgRole } from "@/generated/prisma/client";
import { requireTenantOrgAccess } from "@/lib/server/auth";
import { generatePdf } from "@/lib/server/pdf";

export async function POST() {
  try {
    const auth = await requireTenantOrgAccess(OrgRole.ADMIN);

    const org = await prisma.organization.findUnique({
      where: { id: auth.orgId },
      select: { name: true },
    });

    const invoices = await prisma.invoice.findMany({
      where: { program: { orgId: auth.orgId } },
      select: {
        totalAmount: true,
        dueDate: true,
        status: true,
        currency: true,
        program: { select: { name: true, cdmoName: true } },
      },
    });

    const now = new Date();
    let totalInvoiced = 0;
    let totalOutstanding = 0;
    let flaggedCount = 0;
    let disputedCount = 0;

    const buckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 };
    const delinquentMap = new Map<string, { name: string; cdmoName: string; overdueAmount: number; maxDays: number }>();

    for (const inv of invoices) {
      const amount = inv.totalAmount ? Number(inv.totalAmount) : 0;
      totalInvoiced += amount;
      if (inv.status !== "APPROVED") totalOutstanding += amount;
      if (inv.status === "FLAGGED") flaggedCount++;
      if (inv.status === "DISPUTED") disputedCount++;

      if (inv.dueDate && inv.status !== "APPROVED") {
        const days = Math.floor((now.getTime() - new Date(inv.dueDate).getTime()) / 86400000);
        if (days <= 0) buckets.current += amount;
        else if (days <= 30) buckets.d1_30 += amount;
        else if (days <= 60) buckets.d31_60 += amount;
        else if (days <= 90) buckets.d61_90 += amount;
        else buckets.d90plus += amount;

        if (days > 0) {
          const key = inv.program.name;
          const existing = delinquentMap.get(key);
          if (existing) {
            existing.overdueAmount += amount;
            existing.maxDays = Math.max(existing.maxDays, days);
          } else {
            delinquentMap.set(key, { name: inv.program.name, cdmoName: inv.program.cdmoName, overdueAmount: amount, maxDays: days });
          }
        }
      }
    }

    const currencies = [...new Set(invoices.map((i) => i.currency))];
    const currency = currencies[0] ?? "USD";
    const fmt = (n: number) => `${currency} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const delinquentAccounts = [...delinquentMap.values()].sort((a, b) => b.overdueAmount - a.overdueAmount);

    const { buffer } = await generatePdf({
      title: "Executive Dashboard Report",
      subtitle: `${org?.name ?? "Organization"} — ${now.toISOString().split("T")[0]}`,
      orgName: org?.name ?? undefined,
      sections: [
        {
          title: "Executive Summary",
          rows: [
            { label: "Total Invoiced", value: fmt(totalInvoiced) },
            { label: "Outstanding", value: fmt(totalOutstanding) },
            { label: "Flagged Invoices", value: String(flaggedCount) },
            { label: "Disputed Invoices", value: String(disputedCount) },
            { label: "Total Invoices", value: String(invoices.length) },
          ],
        },
        {
          title: "Aging Buckets",
          table: {
            headers: [
              { label: "Bucket", width: 150 },
              { label: "Amount", width: 170, align: "right" as const },
            ],
            rows: [
              ["Current (not due)", fmt(buckets.current)],
              ["1–30 days past due", fmt(buckets.d1_30)],
              ["31–60 days past due", fmt(buckets.d31_60)],
              ["61–90 days past due", fmt(buckets.d61_90)],
              ["90+ days past due", fmt(buckets.d90plus)],
            ],
          },
        },
        ...(delinquentAccounts.length > 0
          ? [{
              title: "Delinquent Accounts",
              table: {
                headers: [
                  { label: "Program", width: 140 },
                  { label: "CDMO", width: 120 },
                  { label: "Overdue Amount", width: 120, align: "right" as const },
                  { label: "Max Days Overdue", width: 115, align: "right" as const },
                ],
                rows: delinquentAccounts.map((d) => [
                  d.name,
                  d.cdmoName,
                  fmt(d.overdueAmount),
                  String(d.maxDays),
                ]),
              },
            }]
          : []),
      ],
    });

    const dateStr = now.toISOString().split("T")[0];
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="executive-dashboard-${dateStr}.pdf"`,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN") return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    console.error("[POST /api/dashboard/executive/export] Unhandled error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
