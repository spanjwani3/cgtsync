import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { OrgRole, EventAction } from "@/generated/prisma/client";
import { requireProgramAccess } from "@/lib/server/auth";
import { logEvent, getClientIp } from "@/lib/server/event-log";
import { generateRequestId, structuredError } from "@/lib/config";
import { calculateNextSendDate } from "@/lib/server/reminders";

export async function POST(req: NextRequest) {
  const requestId = generateRequestId();
  let userId: string | undefined;
  try {
    const body = await req.json();
    const { programId, invoiceId, recipientEmail, frequencyDays, startOffsetDays } = body;

    if (!programId || !invoiceId || !recipientEmail) {
      return NextResponse.json(
        { requestId, error: "Missing required fields: programId, invoiceId, recipientEmail" },
        { status: 400 }
      );
    }

    const auth = await requireProgramAccess(programId, OrgRole.OPERATOR);
    userId = auth.userId;

    // Validate invoice exists and has a due date
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { id: true, programId: true, dueDate: true },
    });

    if (!invoice || invoice.programId !== programId) {
      return NextResponse.json({ requestId, error: "Invoice not found" }, { status: 404 });
    }
    if (!invoice.dueDate) {
      return NextResponse.json(
        { requestId, error: "Invoice must have a due date to set up reminders" },
        { status: 400 }
      );
    }

    // Check if schedule already exists
    const existing = await prisma.reminderSchedule.findUnique({
      where: { invoiceId },
    });
    if (existing) {
      return NextResponse.json(
        { requestId, error: "Reminder schedule already exists for this invoice", scheduleId: existing.id },
        { status: 409 }
      );
    }

    const freq = frequencyDays ?? 14;
    const offset = startOffsetDays ?? -7;

    // Calculate initial nextSendAt from dueDate + offset
    const nextSendAt = new Date(invoice.dueDate.getTime() + offset * 24 * 60 * 60 * 1000);
    // If the initial date is in the past, calculate from now
    const effectiveNextSend = nextSendAt > new Date()
      ? nextSendAt
      : calculateNextSendDate(null, freq);

    const schedule = await prisma.reminderSchedule.create({
      data: {
        orgId: auth.orgId,
        programId,
        invoiceId,
        recipientEmail,
        frequencyDays: freq,
        startOffsetDays: offset,
        nextSendAt: effectiveNextSend,
      },
    });

    await logEvent({
      programId,
      userId: auth.userId,
      action: EventAction.REMINDER_SCHEDULE_CREATED,
      entityType: "Invoice",
      entityId: invoiceId,
      metadata: { scheduleId: schedule.id, frequencyDays: freq, startOffsetDays: offset },
      ipAddress: getClientIp(req.headers),
    });

    return NextResponse.json({ requestId, schedule });
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
      route: "POST /api/gateway/reminders",
      error: e,
      userId,
    }));
    return NextResponse.json({ requestId, error: "Internal server error" }, { status: 500 });
  }
}
