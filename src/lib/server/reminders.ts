import { prisma } from "@/lib/prisma";
import { EventAction, EmailEntityType } from "@/generated/prisma/client";
import { sendEmail, logEmailSend } from "./email";
import { renderPaymentReminderEmail } from "./email-templates";
import { logEvent } from "./event-log";

// ── Escalation tiers ────────────────────────────────────────

export function calculateEscalationTier(daysPastDue: number): 1 | 2 | 3 {
  if (daysPastDue < 0) return 1; // Pre-due
  if (daysPastDue <= 30) return 2; // 0-30 days past due
  return 3; // 30+ days past due
}

// ── Next send date ──────────────────────────────────────────

export function calculateNextSendDate(
  lastSentAt: Date | null,
  frequencyDays: number
): Date {
  const base = lastSentAt ?? new Date();
  return new Date(base.getTime() + frequencyDays * 24 * 60 * 60 * 1000);
}

// ── Batch processor ─────────────────────────────────────────

interface BatchResult {
  sent: number;
  failed: number;
  errors: string[];
}

export async function processReminderBatch(): Promise<BatchResult> {
  const now = new Date();
  const result: BatchResult = { sent: 0, failed: 0, errors: [] };

  // Find all active schedules due for sending
  const schedules = await prisma.reminderSchedule.findMany({
    where: {
      isActive: true,
      nextSendAt: { lte: now },
    },
    include: {
      invoice: {
        select: {
          id: true,
          invoiceNumber: true,
          totalAmount: true,
          currency: true,
          dueDate: true,
          programId: true,
        },
      },
      program: { select: { name: true } },
      org: { select: { name: true } },
    },
    take: 50, // Process in batches of 50
  });

  for (const schedule of schedules) {
    try {
      const invoice = schedule.invoice;
      if (!invoice.dueDate || !invoice.totalAmount) {
        // Skip invoices without due date or amount
        continue;
      }

      // Idempotency: skip if lastSentAt is very recent (within 1 hour)
      if (schedule.lastSentAt && now.getTime() - schedule.lastSentAt.getTime() < 60 * 60 * 1000) {
        continue;
      }

      const daysPastDue = Math.floor(
        (now.getTime() - invoice.dueDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      const tier = calculateEscalationTier(daysPastDue);
      const newReminderCount = schedule.reminderCount + 1;

      // Render email
      const html = renderPaymentReminderEmail({
        invoiceNumber: invoice.invoiceNumber ?? `INV-${invoice.id.slice(0, 8)}`,
        amount: Number(invoice.totalAmount).toLocaleString(),
        currency: invoice.currency,
        dueDate: invoice.dueDate.toLocaleDateString(),
        daysPastDue,
        tier,
        reminderCount: newReminderCount,
        programName: schedule.program.name,
        orgName: schedule.org.name,
      });

      const subject = tier >= 3
        ? `URGENT: Past Due Invoice ${invoice.invoiceNumber ?? ""} — ${schedule.program.name}`
        : tier >= 2
        ? `Past Due: Invoice ${invoice.invoiceNumber ?? ""} — ${schedule.program.name}`
        : `Payment Reminder: Invoice ${invoice.invoiceNumber ?? ""} — ${schedule.program.name}`;

      // Send
      const sendResult = await sendEmail({
        to: schedule.recipientEmail,
        subject,
        html,
      });

      // Log the email
      // Use the first admin/operator of the org as sender (system-sent)
      const orgAdmin = await prisma.orgMember.findFirst({
        where: { orgId: schedule.orgId, role: { in: ["ADMIN", "OPERATOR"] } },
        select: { userId: true },
      });
      if (!orgAdmin) {
        console.warn(`[reminders] No admin/operator found for org ${schedule.orgId}, skipping email log for schedule ${schedule.id}`);
        continue;
      }
      const senderUserId = orgAdmin.userId;

      await logEmailSend({
        orgId: schedule.orgId,
        programId: schedule.programId,
        senderUserId,
        recipientEmail: schedule.recipientEmail,
        subject,
        templateType: "PAYMENT_REMINDER",
        entityType: EmailEntityType.INVOICE,
        entityId: invoice.id,
        resendId: sendResult.id,
        metadata: { tier, reminderCount: newReminderCount, daysPastDue },
      });

      // Update schedule
      const nextSendAt = calculateNextSendDate(now, schedule.frequencyDays);
      await prisma.reminderSchedule.update({
        where: { id: schedule.id },
        data: {
          lastSentAt: now,
          nextSendAt,
          escalationTier: tier,
          reminderCount: newReminderCount,
        },
      });

      // Log event
      await logEvent({
        programId: schedule.programId,
        userId: senderUserId,
        action: EventAction.PAYMENT_REMINDER_SENT,
        entityType: "Invoice",
        entityId: invoice.id,
        metadata: {
          scheduleId: schedule.id,
          tier,
          reminderCount: newReminderCount,
          daysPastDue,
        },
      });

      result.sent++;
    } catch (err) {
      result.failed++;
      result.errors.push(
        `Schedule ${schedule.id}: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    }
  }

  return result;
}
