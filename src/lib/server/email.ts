import { Resend } from "resend";
import { prisma } from "@/lib/prisma";
import { logEvent } from "@/lib/server/event-log";
import {
  EmailStatus,
  EmailTemplateType,
  EmailEntityType,
  EventAction,
  Prisma,
} from "@/generated/prisma/client";

// ── Resend client (lazy init) ───────────────────────────────

let _resend: Resend | null = null;

function getResend(): Resend {
  if (!_resend) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY is not configured");
    _resend = new Resend(key);
  }
  return _resend;
}

function getFromAddress(): string {
  return process.env.RESEND_FROM_EMAIL ?? "notifications@cgtsync.ai";
}

// ── Rate limiting ───────────────────────────────────────────

const RATE_LIMIT_PER_HOUR = 100;

export async function checkRateLimit(orgId: string): Promise<void> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const count = await prisma.emailLog.count({
    where: { orgId, createdAt: { gte: oneHourAgo } },
  });
  if (count >= RATE_LIMIT_PER_HOUR) {
    throw new Error("RATE_LIMIT_EXCEEDED");
  }
}

// ── Send email via Resend ───────────────────────────────────

interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  from?: string;
  replyTo?: string;
  tags?: { name: string; value: string }[];
}

interface SendEmailResult {
  id: string | null;
  error?: string;
}

export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const resend = getResend();
  const { data, error } = await resend.emails.send({
    from: params.from ?? getFromAddress(),
    to: [params.to],
    subject: params.subject,
    html: params.html,
    replyTo: params.replyTo,
    tags: params.tags,
  });

  if (error) {
    return { id: null, error: error.message };
  }

  return { id: data?.id ?? null };
}

// ── Log email send ──────────────────────────────────────────

interface LogEmailSendParams {
  orgId: string;
  programId: string;
  senderUserId: string;
  recipientEmail: string;
  recipientName?: string;
  subject: string;
  templateType: EmailTemplateType;
  entityType?: EmailEntityType;
  entityId?: string;
  resendId?: string | null;
  status?: EmailStatus;
  metadata?: Record<string, string | number | boolean | null>;
}

export async function logEmailSend(params: LogEmailSendParams) {
  const emailLog = await prisma.emailLog.create({
    data: {
      orgId: params.orgId,
      programId: params.programId,
      senderUserId: params.senderUserId,
      recipientEmail: params.recipientEmail,
      recipientName: params.recipientName ?? null,
      subject: params.subject,
      templateType: params.templateType,
      entityType: params.entityType ?? null,
      entityId: params.entityId ?? null,
      resendId: params.resendId ?? null,
      status: params.status ?? (params.resendId ? EmailStatus.SENT : EmailStatus.FAILED),
      sentAt: params.resendId ? new Date() : null,
      metadata: (params.metadata ?? {}) as Prisma.InputJsonValue,
    },
  });

  await logEvent({
    programId: params.programId,
    userId: params.senderUserId,
    action: EventAction.EMAIL_SENT,
    entityType: params.entityType ?? "Email",
    entityId: params.entityId ?? emailLog.id,
    metadata: {
      recipientEmail: params.recipientEmail,
      templateType: params.templateType,
      resendId: params.resendId ?? null,
    },
  });

  return emailLog;
}

// ── Update email status from webhook ────────────────────────

const STATUS_MAP: Record<string, { status: EmailStatus; action: EventAction }> = {
  "email.sent": { status: EmailStatus.SENT, action: EventAction.EMAIL_SENT },
  "email.delivered": { status: EmailStatus.DELIVERED, action: EventAction.EMAIL_DELIVERED },
  "email.opened": { status: EmailStatus.OPENED, action: EventAction.EMAIL_OPENED },
  "email.bounced": { status: EmailStatus.BOUNCED, action: EventAction.EMAIL_BOUNCED },
  "email.delivery_delayed": { status: EmailStatus.QUEUED, action: EventAction.EMAIL_FAILED },
};

export async function updateEmailStatus(
  resendId: string,
  eventType: string,
  timestamp?: Date
) {
  const mapping = STATUS_MAP[eventType];
  if (!mapping) return null;

  const emailLog = await prisma.emailLog.findFirst({
    where: { resendId },
  });
  if (!emailLog) return null;

  const updateData: Record<string, unknown> = { status: mapping.status };
  if (mapping.status === EmailStatus.DELIVERED) updateData.deliveredAt = timestamp ?? new Date();
  if (mapping.status === EmailStatus.OPENED) updateData.openedAt = timestamp ?? new Date();

  const updated = await prisma.emailLog.update({
    where: { id: emailLog.id },
    data: updateData,
  });

  await logEvent({
    programId: emailLog.programId,
    userId: emailLog.senderUserId,
    action: mapping.action,
    entityType: emailLog.entityType ?? "Email",
    entityId: emailLog.entityId ?? emailLog.id,
    metadata: { resendId, eventType },
  });

  return updated;
}
