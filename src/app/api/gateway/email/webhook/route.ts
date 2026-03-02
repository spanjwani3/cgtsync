import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { updateEmailStatus } from "@/lib/server/email";
import { generateRequestId, structuredError } from "@/lib/config";

function verifyWebhookSignature(body: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export async function POST(req: NextRequest) {
  const requestId = generateRequestId();
  try {
    const rawBody = await req.text();
    const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;

    // Verify signature if secret is configured
    if (webhookSecret) {
      const signature = req.headers.get("svix-signature") ?? req.headers.get("resend-signature");
      if (!verifyWebhookSignature(rawBody, signature, webhookSecret)) {
        return NextResponse.json({ requestId, error: "Invalid signature" }, { status: 401 });
      }
    }

    const event = JSON.parse(rawBody);
    const eventType: string = event.type;
    const resendId: string | undefined = event.data?.email_id;
    const timestamp = event.created_at ? new Date(event.created_at) : new Date();

    if (!resendId) {
      return NextResponse.json({ requestId, error: "Missing email_id" }, { status: 400 });
    }

    const updated = await updateEmailStatus(resendId, eventType, timestamp);

    return NextResponse.json({
      requestId,
      processed: !!updated,
      eventType,
      resendId,
    });
  } catch (e) {
    console.error(structuredError({
      requestId,
      route: "POST /api/gateway/email/webhook",
      error: e,
    }));
    return NextResponse.json({ requestId, error: "Internal server error" }, { status: 500 });
  }
}
