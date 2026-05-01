import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { OrgRole, EventAction, EmailEntityType } from "@/generated/prisma/client";
import { requireProgramAccess } from "@/lib/server/auth";
import { logEvent, getClientIp } from "@/lib/server/event-log";
import { generateRequestId, structuredError } from "@/lib/config";
import { sendEmail, logEmailSend, checkRateLimit } from "@/lib/server/email";
import { renderDisputeDeliveryEmail } from "@/lib/server/email-templates";
import { getSignedUrl } from "@/lib/server/storage";

export async function POST(req: NextRequest) {
  const requestId = generateRequestId();
  let userId: string | undefined;
  try {
    const body = await req.json();
    const { programId, invoiceId, exportId, recipientEmail, recipientName, message } = body;

    if (!programId || !exportId || !recipientEmail) {
      return NextResponse.json(
        { requestId, error: "Missing required fields: programId, exportId, recipientEmail" },
        { status: 400 }
      );
    }

    const auth = await requireProgramAccess(programId, OrgRole.OPERATOR);
    userId = auth.userId;

    await checkRateLimit(auth.orgId);

    // Fetch export record
    const exportRecord = await prisma.export.findUnique({
      where: { id: exportId },
      select: { id: true, programId: true, type: true, storagePath: true, fileName: true },
    });

    if (!exportRecord || exportRecord.programId !== programId) {
      return NextResponse.json({ requestId, error: "Export not found" }, { status: 404 });
    }
    if (exportRecord.type !== "DISPUTE_PACKET") {
      return NextResponse.json(
        { requestId, error: "Export must be a DISPUTE_PACKET" },
        { status: 400 }
      );
    }

    // Get signed download URL (24 hours for email delivery)
    const downloadUrl = await getSignedUrl(exportRecord.storagePath, 24 * 60 * 60);

    // Fetch invoice and program info
    const [invoice, program, sender, org] = await Promise.all([
      invoiceId ? prisma.invoice.findUnique({
        where: { id: invoiceId },
        select: { invoiceNumber: true, totalAmount: true, currency: true },
      }) : null,
      prisma.program.findUnique({
        where: { id: programId },
        select: { name: true, currency: true },
      }),
      prisma.user.findUnique({
        where: { id: auth.userId },
        select: { fullName: true },
      }),
      prisma.organization.findFirst({
        where: { id: auth.orgId },
        select: { name: true },
      }),
    ]);

    const invoiceNumber = invoice?.invoiceNumber ?? "N/A";
    const disputeAmount = invoice?.totalAmount ? Number(invoice.totalAmount).toLocaleString() : "N/A";
    const currency = invoice?.currency ?? program?.currency ?? "USD";

    const subject = `Dispute Pack — Invoice ${invoiceNumber} — ${program?.name ?? "Program"}`;
    const html = renderDisputeDeliveryEmail({
      programName: program?.name ?? "Program",
      invoiceNumber,
      disputeAmount,
      currency,
      downloadUrl,
      pmName: sender?.fullName ?? undefined,
      message,
      orgName: org?.name ?? undefined,
    });

    const result = await sendEmail({ to: recipientEmail, subject, html });

    const emailLog = await logEmailSend({
      orgId: auth.orgId,
      programId,
      senderUserId: auth.userId,
      recipientEmail,
      recipientName,
      subject,
      templateType: "DISPUTE_DELIVERY",
      entityType: EmailEntityType.DISPUTE,
      entityId: invoiceId ?? exportId,
      resendId: result.id,
      metadata: { exportId, invoiceId },
    });

    await logEvent({
      programId,
      userId: auth.userId,
      action: EventAction.DISPUTE_PACK_SENT,
      entityType: "Export",
      entityId: exportId,
      metadata: { recipientEmail, invoiceId },
      ipAddress: getClientIp(req.headers),
    });

    if (result.error) {
      return NextResponse.json(
        { requestId, emailLogId: emailLog.id, error: result.error },
        { status: 502 }
      );
    }

    return NextResponse.json({ requestId, emailLogId: emailLog.id, resendId: result.id });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    if (message === "UNAUTHORIZED") {
      return NextResponse.json({ requestId, error: "Unauthorized" }, { status: 401 });
    }
    if (message === "FORBIDDEN") {
      return NextResponse.json({ requestId, error: "Forbidden" }, { status: 403 });
    }
    if (message === "RATE_LIMIT_EXCEEDED") {
      return NextResponse.json({ requestId, error: "Rate limit exceeded" }, { status: 429 });
    }
    console.error(structuredError({
      requestId,
      route: "POST /api/gateway/disputes/send",
      error: e,
      userId,
    }));
    return NextResponse.json({ requestId, error: "Internal server error" }, { status: 500 });
  }
}
