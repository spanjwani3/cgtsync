import { prisma } from "@/lib/prisma";
import { EventAction, Prisma } from "@/generated/prisma/client";

interface LogEventParams {
  programId?: string;
  userId?: string;
  action: EventAction;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, string | number | boolean | null>;
  ipAddress?: string;
}

/**
 * Append an event to the immutable event log.
 * This is insert-only; the DB has triggers preventing UPDATE and DELETE.
 */
export async function logEvent(params: LogEventParams) {
  return prisma.eventLog.create({
    data: {
      programId: params.programId ?? null,
      userId: params.userId ?? null,
      action: params.action,
      entityType: params.entityType ?? null,
      entityId: params.entityId ?? null,
      metadata: (params.metadata ?? {}) as Prisma.InputJsonValue,
      ipAddress: params.ipAddress ?? null,
    },
  });
}

/**
 * Extract client IP from request headers.
 */
export function getClientIp(headers: Headers): string {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headers.get("x-real-ip") ??
    "unknown"
  );
}
