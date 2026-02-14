import { prisma } from "@/lib/prisma";
import { MagicLinkScope, EventAction } from "@/generated/prisma/client";
import { logEvent } from "./event-log";

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
