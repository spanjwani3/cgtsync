import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { OrgRole } from "@/generated/prisma/client";
import { requireProgramAccess } from "@/lib/server/auth";
import { generateRequestId, structuredError } from "@/lib/config";
import { reconcileInvoice } from "@/lib/server/reconciliation";

/**
 * POST /api/invoices/{invoiceId}/reconcile
 * Run AI reconciliation: fuzzy-match line items to baseline clauses / change orders,
 * then apply deterministic flag detection.
 * Idempotent — clears existing mappings before re-applying.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  const requestId = generateRequestId();
  let userId: string | undefined;
  let programId: string | undefined;
  try {
    const { invoiceId } = await params;
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { programId: true },
    });
    if (!invoice) {
      return NextResponse.json({ requestId, error: "Invoice not found" }, { status: 404 });
    }

    programId = invoice.programId;
    const auth = await requireProgramAccess(programId, OrgRole.OPERATOR);
    userId = auth.userId;

    // Clear existing mappings before re-reconciling (idempotent)
    await prisma.invoiceLineItem.updateMany({
      where: { invoiceId },
      data: { clauseId: null, changeId: null, flag: "NONE", flagNote: null },
    });

    const result = await reconcileInvoice(invoiceId, programId, userId);

    return NextResponse.json({ requestId, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED")
      return NextResponse.json({ requestId, error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN")
      return NextResponse.json({ requestId, error: "Forbidden" }, { status: 403 });
    console.error(
      structuredError({
        requestId,
        route: "/api/invoices/[invoiceId]/reconcile",
        error: e,
        userId,
        programId,
      })
    );
    return NextResponse.json(
      { requestId, error: "Internal server error" },
      { status: 500 }
    );
  }
}
