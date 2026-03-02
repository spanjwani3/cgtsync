import { prisma } from "@/lib/prisma";
import { MagicLinkScope, EventAction, EmailEntityType } from "@/generated/prisma/client";
import { logEvent } from "./event-log";
import { sendEmail, logEmailSend, checkRateLimit } from "./email";
import { renderConfirmationEmail } from "./email-templates";

interface CreateMagicLinkParams {
  scope: MagicLinkScope;
  entityId: string;
  createdById: string;
  ttlHours?: number;
  singleUse?: boolean;
}

/**
 * Create a scoped magic link.
 * Default TTL: 48 hours. Range: 24–72 hours.
 */
export async function createMagicLink(params: CreateMagicLinkParams) {
  const ttl = Math.min(Math.max(params.ttlHours ?? 48, 24), 72);
  const expiresAt = new Date(Date.now() + ttl * 60 * 60 * 1000);

  const link = await prisma.magicLink.create({
    data: {
      scope: params.scope,
      entityId: params.entityId,
      createdById: params.createdById,
      singleUse: params.singleUse ?? false,
      expiresAt,
    },
  });

  await logEvent({
    userId: params.createdById,
    action: EventAction.MAGIC_LINK_CREATED,
    entityType: "MagicLink",
    entityId: link.id,
    metadata: { scope: params.scope, targetEntityId: params.entityId, ttlHours: ttl },
  });

  return link;
}

/**
 * Validate and retrieve a magic link by token.
 * Returns null if expired, already used (single-use), or not found.
 */
export async function validateMagicLink(token: string) {
  const link = await prisma.magicLink.findUnique({
    where: { token },
  });

  if (!link) return null;

  // Expired
  if (link.expiresAt < new Date()) {
    await logEvent({
      action: EventAction.MAGIC_LINK_EXPIRED,
      entityType: "MagicLink",
      entityId: link.id,
    });
    return null;
  }

  // Single-use and already confirmed
  if (link.singleUse && link.confirmedAt) {
    return null;
  }

  return link;
}

/**
 * Record that a magic link was viewed.
 */
export async function recordMagicLinkView(
  linkId: string,
  ipAddress?: string
) {
  // Only set viewedAt on first view
  await prisma.magicLink.update({
    where: { id: linkId },
    data: { viewedAt: new Date() },
  });

  await logEvent({
    action: EventAction.MAGIC_LINK_VIEWED,
    entityType: "MagicLink",
    entityId: linkId,
    ipAddress,
  });
}

/**
 * Confirm a magic link action.
 */
export async function confirmMagicLink(
  linkId: string,
  ipAddress?: string
) {
  const link = await prisma.magicLink.update({
    where: { id: linkId },
    data: { confirmedAt: new Date() },
  });

  await logEvent({
    action: EventAction.MAGIC_LINK_CONFIRMED,
    entityType: "MagicLink",
    entityId: linkId,
    ipAddress,
    metadata: { scope: link.scope, entityId: link.entityId },
  });

  return link;
}

// ── Email-integrated confirmation ─────────────────────────

interface CreateConfirmationEmailParams {
  scope: MagicLinkScope;
  entityId: string;
  createdById: string;
  programId: string;
  orgId: string;
  recipientEmail: string;
  recipientName?: string;
  message?: string;
  ttlHours?: number;
  /** Title of the entity (baseline title or change title) */
  entityTitle: string;
  /** Summary items to show in the email */
  items?: { label: string; value: string }[];
  /** PM name to show in the email */
  pmName?: string;
  /** Org name to show in the email */
  orgName?: string;
}

/**
 * Create a magic link AND send the confirmation email in one step.
 * Returns the email log ID, magic link ID, and token.
 */
export async function createConfirmationEmail(params: CreateConfirmationEmailParams) {
  // Rate limit check
  await checkRateLimit(params.orgId);

  // 1. Create the magic link
  const magicLink = await createMagicLink({
    scope: params.scope,
    entityId: params.entityId,
    createdById: params.createdById,
    ttlHours: params.ttlHours,
    singleUse: true,
  });

  // 2. Build CTA URL
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const ctaUrl = `${siteUrl}/confirm/${magicLink.token}`;

  // 3. Determine email type
  const type = params.scope === MagicLinkScope.BASELINE_CONFIRM ? "BASELINE" : "CHANGE";
  const entityType = params.scope === MagicLinkScope.BASELINE_CONFIRM
    ? EmailEntityType.BASELINE
    : EmailEntityType.CHANGE;

  // 4. Render email
  const subject = `${type === "BASELINE" ? "Baseline" : "Change Order"} Confirmation: ${params.entityTitle}`;
  const html = renderConfirmationEmail({
    type,
    title: params.entityTitle,
    items: params.items,
    ctaUrl,
    pmName: params.pmName,
    orgName: params.orgName,
    message: params.message,
  });

  // 5. Send via Resend
  const result = await sendEmail({
    to: params.recipientEmail,
    subject,
    html,
  });

  // 6. Log the email
  const emailLog = await logEmailSend({
    orgId: params.orgId,
    programId: params.programId,
    senderUserId: params.createdById,
    recipientEmail: params.recipientEmail,
    recipientName: params.recipientName,
    subject,
    templateType: "CONFIRMATION_REQUEST",
    entityType,
    entityId: params.entityId,
    resendId: result.id,
    metadata: { magicLinkId: magicLink.id },
  });

  // 7. Link the email log to the magic link
  await prisma.magicLink.update({
    where: { id: magicLink.id },
    data: { emailLogId: emailLog.id },
  });

  return {
    emailLogId: emailLog.id,
    magicLinkId: magicLink.id,
    token: magicLink.token,
    error: result.error,
  };
}
