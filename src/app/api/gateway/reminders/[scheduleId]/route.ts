import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { OrgRole, EventAction } from "@/generated/prisma/client";
import { requireProgramAccess } from "@/lib/server/auth";
import { logEvent, getClientIp } from "@/lib/server/event-log";
import { generateRequestId, structuredError } from "@/lib/config";
import { calculateNextSendDate } from "@/lib/server/reminders";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ scheduleId: string }> }
) {
  const requestId = generateRequestId();
  let userId: string | undefined;
  try {
    const { scheduleId } = await params;
    const body = await req.json();
    const { action, frequencyDays, startOffsetDays, recipientEmail } = body;

    // Fetch schedule first to get programId
    const schedule = await prisma.reminderSchedule.findUnique({
      where: { id: scheduleId },
    });
    if (!schedule) {
      return NextResponse.json({ requestId, error: "Schedule not found" }, { status: 404 });
    }

    const auth = await requireProgramAccess(schedule.programId, OrgRole.OPERATOR);
    userId = auth.userId;

    const data: Record<string, unknown> = {};

    switch (action) {
      case "pause":
        data.isActive = false;
        data.pausedAt = new Date();
        break;
      case "resume":
        data.isActive = true;
        data.pausedAt = null;
        if (!schedule.nextSendAt || schedule.nextSendAt < new Date()) {
          data.nextSendAt = calculateNextSendDate(null, schedule.frequencyDays);
        }
        break;
      case "skip":
        data.nextSendAt = calculateNextSendDate(new Date(), schedule.frequencyDays);
        break;
      case "update":
        if (frequencyDays !== undefined) data.frequencyDays = frequencyDays;
        if (startOffsetDays !== undefined) data.startOffsetDays = startOffsetDays;
        if (recipientEmail !== undefined) data.recipientEmail = recipientEmail;
        break;
      default:
        return NextResponse.json(
          { requestId, error: "Invalid action. Use: pause, resume, skip, update" },
          { status: 400 }
        );
    }

    const updated = await prisma.reminderSchedule.update({
      where: { id: scheduleId },
      data,
    });

    const eventAction = action === "pause"
      ? EventAction.REMINDER_SCHEDULE_PAUSED
      : action === "resume"
      ? EventAction.REMINDER_SCHEDULE_RESUMED
      : EventAction.REMINDER_SCHEDULE_CREATED; // reuse for skip/update

    await logEvent({
      programId: schedule.programId,
      userId: auth.userId,
      action: eventAction,
      entityType: "ReminderSchedule",
      entityId: scheduleId,
      metadata: { action, ...data },
      ipAddress: getClientIp(req.headers),
    });

    return NextResponse.json({ requestId, schedule: updated });
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
      route: "PATCH /api/gateway/reminders/[scheduleId]",
      error: e,
      userId,
    }));
    return NextResponse.json({ requestId, error: "Internal server error" }, { status: 500 });
  }
}
