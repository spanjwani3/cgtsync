import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateRequestId, structuredError } from "@/lib/config";
import { processInboundEmail } from "@/lib/server/inbound-email";
import { logEvent } from "@/lib/server/event-log";

/**
 * POST /api/gateway/ingest
 * Webhook endpoint for inbound email provider (SendGrid Inbound Parse).
 * Receives parsed email data and routes to the appropriate pipeline.
 *
 * Expected fields (multipart form or JSON):
 * - to: recipient email address
 * - from: sender email address
 * - subject: email subject
 * - text: plain text body
 * - html: HTML body (optional)
 */
export async function POST(req: NextRequest) {
  const requestId = generateRequestId();
  try {
    let toAddress: string;
    let fromEmail: string;
    let fromName: string | null = null;
    let subject: string | null = null;
    let textBody: string | null = null;

    const contentType = req.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      const body = await req.json();
      toAddress = body.to ?? "";
      fromEmail = body.from ?? "";
      fromName = body.fromName ?? null;
      subject = body.subject ?? null;
      textBody = body.text ?? null;
    } else {
      // SendGrid posts as multipart/form-data
      const formData = await req.formData();
      toAddress = (formData.get("to") as string) ?? "";
      const fromField = (formData.get("from") as string) ?? "";
      // Parse "Name <email>" format
      const fromMatch = fromField.match(/^(.+?)\s*<(.+?)>$/);
      if (fromMatch) {
        fromName = fromMatch[1].trim();
        fromEmail = fromMatch[2].trim();
      } else {
        fromEmail = fromField.trim();
      }
      subject = (formData.get("subject") as string) ?? null;
      textBody = (formData.get("text") as string) ?? null;
    }

    // Extract the actual email address from "to" field
    const toMatch = toAddress.match(/<(.+?)>/);
    const cleanTo = toMatch ? toMatch[1] : toAddress.trim().toLowerCase();

    // Look up the ingest address
    const ingestAddress = await prisma.ingestAddress.findUnique({
      where: { address: cleanTo },
    });

    if (!ingestAddress || !ingestAddress.isActive) {
      // Silently drop unknown/inactive addresses (prevents abuse)
      return NextResponse.json({ requestId, status: "dropped" }, { status: 200 });
    }

    // Create InboundEmail record
    const inboundEmail = await prisma.inboundEmail.create({
      data: {
        ingestAddressId: ingestAddress.id,
        programId: ingestAddress.programId,
        fromEmail,
        fromName,
        subject,
        textBody,
        status: "RECEIVED",
      },
    });

    await logEvent({
      programId: ingestAddress.programId,
      action: "INGEST_EMAIL_RECEIVED",
      entityType: "InboundEmail",
      entityId: inboundEmail.id,
      metadata: { fromEmail, subject: subject ?? "" },
    });

    // Process asynchronously — fire and forget
    // In production, this would use a queue (e.g., Vercel background functions)
    processInboundEmail(inboundEmail.id).catch((err) => {
      console.error(structuredError({
        requestId,
        route: "POST /ingest (background)",
        error: err,
        programId: ingestAddress.programId,
      }));
    });

    // Return 200 immediately (SendGrid requires quick response)
    return NextResponse.json({
      requestId,
      status: "received",
      inboundEmailId: inboundEmail.id,
    });
  } catch (e) {
    console.error(structuredError({ requestId, route: "POST /ingest", error: e }));
    return NextResponse.json({ requestId, error: "Internal server error" }, { status: 500 });
  }
}
