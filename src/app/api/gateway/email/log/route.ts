import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { EmailEntityType } from "@/generated/prisma/client";
import { requireProgramAccess } from "@/lib/server/auth";
import { generateRequestId, structuredError } from "@/lib/config";

export async function GET(req: NextRequest) {
  const requestId = generateRequestId();
  let userId: string | undefined;
  try {
    const { searchParams } = new URL(req.url);
    const programId = searchParams.get("programId");
    const entityType = searchParams.get("entityType") as EmailEntityType | null;
    const entityId = searchParams.get("entityId");

    if (!programId) {
      return NextResponse.json(
        { requestId, error: "Missing programId query parameter" },
        { status: 400 }
      );
    }

    const auth = await requireProgramAccess(programId);
    userId = auth.userId;

    const where: Record<string, unknown> = { programId };
    if (entityType) where.entityType = entityType;
    if (entityId) where.entityId = entityId;

    const logs = await prisma.emailLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 50,
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
        magicLinks: {
          select: {
            confirmedAt: true,
            viewedAt: true,
          },
          take: 1,
          orderBy: { createdAt: "desc" },
        },
      },
    });

    // Flatten magic link data into each log entry
    const enrichedLogs = logs.map((log) => {
      const ml = log.magicLinks[0] ?? null;
      return {
        ...log,
        magicLinks: undefined,
        confirmedAt: ml?.confirmedAt ?? null,
        viewedAt: ml?.viewedAt ?? null,
      };
    });

    return NextResponse.json({ requestId, logs: enrichedLogs });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    if (message === "UNAUTHORIZED") {
      return NextResponse.json({ requestId, error: "Unauthorized" }, { status: 401 });
    }
    if (message === "FORBIDDEN") {
      return NextResponse.json({ requestId, error: "Forbidden" }, { status: 403 });
    }
    console.error(structuredError({
      requestId,
      route: "GET /api/gateway/email/log",
      error: e,
      userId,
    }));
    return NextResponse.json({ requestId, error: "Internal server error" }, { status: 500 });
  }
}
