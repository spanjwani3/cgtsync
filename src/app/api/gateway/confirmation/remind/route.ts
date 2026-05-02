import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { OrgRole, MagicLinkScope, EmailEntityType } from "@/generated/prisma/client";
import { requireProgramAccess } from "@/lib/server/auth";
import { generateRequestId, structuredError } from "@/lib/config";
import { sendEmail, logEmailSend, checkRateLimit } from "@/lib/server/email";
import { renderFollowUpEmail } from "@/lib/server/email-templates";

export async function POST(req: NextRequest) {
  const requestId = generateRequestId();
  let userId: string | undefined;
  try {
    const body = await req.json();
    const { programId, magicLinkId } = body;

    if (!programId || !magicLinkId) {
      return NextResponse.json(
        { requestId, error: "Missing required fields: programId, magicLinkId" },
        { status: 400 }
      );
    }

    const auth = await requireProgramAccess(programId, OrgRole.OPERATOR);
    userId = auth.userId;

    await checkRateLimit(auth.orgId);

    // Find the magic link and its associated email
    const magicLink = await prisma.magicLink.findUnique({
      where: { id: magicLinkId },
      include: {
        emailLog: { select: { recipientEmail: true, recipientName: true, sentAt: true } },
      },
    });

    if (!magicLink) {
      return NextResponse.json({ requestId, error: "Magic link not found" }, { status: 404 });
    }
    if (magicLink.confirmedAt) {
      return NextResponse.json({ requestId, error: "Already confirmed" }, { status: 400 });
    }
    if (magicLink.expiresAt < new Date()) {
      return NextResponse.json({ requestId, error: "Magic link has expired" }, { status: 400 });
    }

    // Look up entity title
    const type = magicLink.scope === MagicLinkScope.BASELINE_CONFIRM ? "BASELINE" : "CHANGE";
    const entityType = type === "BASELINE" ? EmailEntityType.BASELINE : EmailEntityType.CHANGE;
    let entityTitle = "";

    if (type === "BASELINE") {
      const baseline = await prisma.baseline.findUnique({
        where: { id: magicLink.entityId },
        select: { title: true },
      });
      entityTitle = baseline?.title ?? "Baseline";
    } else {
      const change = await prisma.change.findUnique({
        where: { id: magicLink.entityId },
        select: { title: true, sequenceNum: true },
      });
      entityTitle = change ? `#${change.sequenceNum}: ${change.title}` : "Change";
    }

    const recipientEmail = magicLink.emailLog?.recipientEmail;
    if (!recipientEmail) {
      return NextResponse.json(
        { requestId, error: "No recipient email found for this magic link" },
        { status: 400 }
      );
    }

    // Build CTA URL on the org's tenant subdomain (not the apex,
    // which serves the marketing site).
    const { buildTenantUrlForOrg } = await import("@/lib/server/tenant");
    const ctaUrl = await buildTenantUrlForOrg(
      auth.orgId,
      `/confirm/${magicLink.token}`,
    );

    const org = await prisma.organization.findFirst({
      where: { id: auth.orgId },
      select: { name: true },
    });

    const originalSentDate = magicLink.emailLog?.sentAt
      ? magicLink.emailLog.sentAt.toLocaleDateString()
      : magicLink.createdAt.toLocaleDateString();

    const subject = `Reminder: ${type === "BASELINE" ? "Baseline" : "Change"} Confirmation — ${entityTitle}`;
    const html = renderFollowUpEmail({
      type,
      title: entityTitle,
      originalSentDate,
      ctaUrl,
      orgName: org?.name,
    });

    const result = await sendEmail({ to: recipientEmail, subject, html });

    const emailLog = await logEmailSend({
      orgId: auth.orgId,
      programId,
      senderUserId: auth.userId,
      recipientEmail,
      recipientName: magicLink.emailLog?.recipientName ?? undefined,
      subject,
      templateType: "FOLLOW_UP_REMINDER",
      entityType,
      entityId: magicLink.entityId,
      resendId: result.id,
      metadata: { magicLinkId, isReminder: true },
    });

    return NextResponse.json({
      requestId,
      emailLogId: emailLog.id,
      resendId: result.id,
    });
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
      route: "POST /api/gateway/confirmation/remind",
      error: e,
      userId,
    }));
    return NextResponse.json({ requestId, error: "Internal server error" }, { status: 500 });
  }
}
