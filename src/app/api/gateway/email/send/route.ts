import { NextRequest, NextResponse } from "next/server";
import { OrgRole, EmailTemplateType, EmailEntityType } from "@/generated/prisma/client";
import { requireProgramAccess } from "@/lib/server/auth";
import { getClientIp } from "@/lib/server/event-log";
import { generateRequestId, structuredError } from "@/lib/config";
import { sendEmail, logEmailSend, checkRateLimit } from "@/lib/server/email";
import {
  renderConfirmationEmail,
  renderPaymentReminderEmail,
  renderDisputeDeliveryEmail,
  renderFollowUpEmail,
  type ConfirmationEmailParams,
  type PaymentReminderEmailParams,
  type DisputeDeliveryEmailParams,
  type FollowUpEmailParams,
} from "@/lib/server/email-templates";
import { getOrgBranding } from "@/lib/server/org-branding";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TEMPLATE_RENDERERS: Record<string, (data: any) => string> = {
  CONFIRMATION_REQUEST: (d: ConfirmationEmailParams) => renderConfirmationEmail(d),
  PAYMENT_REMINDER: (d: PaymentReminderEmailParams) => renderPaymentReminderEmail(d),
  DISPUTE_DELIVERY: (d: DisputeDeliveryEmailParams) => renderDisputeDeliveryEmail(d),
  FOLLOW_UP_REMINDER: (d: FollowUpEmailParams) => renderFollowUpEmail(d),
};

export async function POST(req: NextRequest) {
  const requestId = generateRequestId();
  let userId: string | undefined;
  try {
    const body = await req.json();
    const {
      programId,
      recipientEmail,
      recipientName,
      subject,
      templateType,
      entityType,
      entityId,
      templateData,
    } = body;

    if (!programId || !recipientEmail || !subject || !templateType) {
      return NextResponse.json(
        { requestId, error: "Missing required fields: programId, recipientEmail, subject, templateType" },
        { status: 400 }
      );
    }

    const auth = await requireProgramAccess(programId, OrgRole.OPERATOR);
    userId = auth.userId;

    // Rate limit
    await checkRateLimit(auth.orgId);

    // Render template
    const renderer = TEMPLATE_RENDERERS[templateType];
    if (!renderer && templateType !== "CUSTOM") {
      return NextResponse.json(
        { requestId, error: `Unknown template type: ${templateType}` },
        { status: 400 }
      );
    }

    const branding = await getOrgBranding(auth.orgId);
    const html = templateType === "CUSTOM"
      ? (templateData?.html as string) ?? ""
      : renderer({ ...(templateData ?? {}), accentColor: branding.accentColor });

    // Send via Resend
    const result = await sendEmail({ to: recipientEmail, subject, html });

    // Log
    const emailLog = await logEmailSend({
      orgId: auth.orgId,
      programId,
      senderUserId: auth.userId,
      recipientEmail,
      recipientName,
      subject,
      templateType: templateType as EmailTemplateType,
      entityType: entityType ? (entityType as EmailEntityType) : undefined,
      entityId,
      resendId: result.id,
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
      return NextResponse.json(
        { requestId, error: "Rate limit exceeded (100 emails/hour per organization)" },
        { status: 429 }
      );
    }
    console.error(structuredError({
      requestId,
      route: "POST /api/gateway/email/send",
      error: e,
      userId,
    }));
    return NextResponse.json({ requestId, error: "Internal server error" }, { status: 500 });
  }
}
