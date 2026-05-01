import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireProgramAccess } from "@/lib/server/auth";
import { generateRequestId, structuredError } from "@/lib/config";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = generateRequestId();
  let userId: string | undefined;
  try {
    const { id } = await params;

    // Look up the email log first to get programId for auth
    const lookup = await prisma.emailLog.findUnique({
      where: { id },
      select: { programId: true },
    });
    if (!lookup) {
      return NextResponse.json({ requestId, error: "Email log not found" }, { status: 404 });
    }

    const auth = await requireProgramAccess(lookup.programId);
    userId = auth.userId;

    const emailLog = await prisma.emailLog.findFirst({
      where: { id, programId: lookup.programId },
      select: {
        id: true,
        recipientEmail: true,
        recipientName: true,
        subject: true,
        templateType: true,
        entityType: true,
        entityId: true,
        status: true,
        sentAt: true,
        deliveredAt: true,
        openedAt: true,
        createdAt: true,
        sender: {
          select: { fullName: true, email: true },
        },
        magicLinks: {
          select: {
            id: true,
            viewedAt: true,
            confirmedAt: true,
            expiresAt: true,
            createdAt: true,
          },
          take: 1,
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!emailLog) {
      return NextResponse.json(
        { requestId, error: "Email log not found" },
        { status: 404 }
      );
    }

    // Fetch related event log entries for this email
    const events = await prisma.eventLog.findMany({
      where: {
        entityId: emailLog.id,
        action: {
          in: [
            "EMAIL_SENT",
            "EMAIL_DELIVERED",
            "EMAIL_OPENED",
            "EMAIL_BOUNCED",
            "EMAIL_FAILED",
            "MAGIC_LINK_CREATED",
            "MAGIC_LINK_VIEWED",
            "MAGIC_LINK_CONFIRMED",
            "MAGIC_LINK_EXPIRED",
          ],
        },
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        action: true,
        metadata: true,
        ipAddress: true,
        createdAt: true,
      },
    });

    // Also check events linked via the entity (baseline/change)
    let entityEvents: typeof events = [];
    if (emailLog.entityId) {
      entityEvents = await prisma.eventLog.findMany({
        where: {
          entityId: emailLog.entityId,
          action: {
            in: [
              "BASELINE_CONFIRMED",
              "BASELINE_COUNTERED",
              "CHANGE_CONFIRMED",
              "CHANGE_COUNTERED",
              "MAGIC_LINK_VIEWED",
              "MAGIC_LINK_CONFIRMED",
            ],
          },
        },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          action: true,
          metadata: true,
          ipAddress: true,
          createdAt: true,
        },
      });
    }

    // Merge and deduplicate events by id, sort by createdAt
    const allEventsMap = new Map<string, (typeof events)[0]>();
    for (const e of events) allEventsMap.set(e.id, e);
    for (const e of entityEvents) allEventsMap.set(e.id, e);
    const allEvents = Array.from(allEventsMap.values()).sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

    const ml = emailLog.magicLinks[0] ?? null;

    return NextResponse.json({
      requestId,
      emailLog: {
        ...emailLog,
        magicLinks: undefined,
        confirmedAt: ml?.confirmedAt ?? null,
        viewedAt: ml?.viewedAt ?? null,
        magicLinkExpiresAt: ml?.expiresAt ?? null,
      },
      events: allEvents,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    if (message === "UNAUTHORIZED") {
      return NextResponse.json({ requestId, error: "Unauthorized" }, { status: 401 });
    }
    console.error(structuredError({
      requestId,
      route: "GET /api/gateway/email/[id]",
      error: e,
      userId,
    }));
    return NextResponse.json({ requestId, error: "Internal server error" }, { status: 500 });
  }
}
