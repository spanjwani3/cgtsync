import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { OrgRole } from "@/generated/prisma/client";
import { requireProgramAccess } from "@/lib/server/auth";
import { generateRequestId, structuredError } from "@/lib/config";
import { reclassifyInboundEmail } from "@/lib/server/inbound-email";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_TYPES = new Set(["TRANSCRIPT", "CHANGE_ORDER", "INVOICE", "EMAIL_THREAD"]);

/**
 * POST /api/gateway/inbound-emails/[id]/reclassify
 * Manually reclassify a NEEDS_REVIEW inbound email and re-trigger processing.
 * Body: { contentType: "TRANSCRIPT" | "CHANGE_ORDER" | "INVOICE" | "EMAIL_THREAD" }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = generateRequestId();
  let userId: string | undefined;
  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ requestId, error: "Invalid id" }, { status: 400 });
    }

    const body = await req.json();
    const contentType = body.contentType as string;
    if (!contentType || !VALID_TYPES.has(contentType)) {
      return NextResponse.json(
        { requestId, error: "contentType must be one of: TRANSCRIPT, CHANGE_ORDER, INVOICE, EMAIL_THREAD" },
        { status: 400 },
      );
    }

    const email = await prisma.inboundEmail.findUnique({
      where: { id },
    });
    if (!email) {
      return NextResponse.json({ requestId, error: "Not found" }, { status: 404 });
    }

    const auth = await requireProgramAccess(email.programId, OrgRole.OPERATOR);
    userId = auth.userId;

    const result = await reclassifyInboundEmail(id, contentType as "TRANSCRIPT" | "CHANGE_ORDER" | "INVOICE" | "EMAIL_THREAD");

    return NextResponse.json({ requestId, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED")
      return NextResponse.json({ requestId, error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN")
      return NextResponse.json({ requestId, error: "Forbidden" }, { status: 403 });
    console.error(structuredError({ requestId, route: "POST /inbound-emails/[id]/reclassify", error: e, userId }));
    return NextResponse.json({ requestId, error: "Internal server error" }, { status: 500 });
  }
}
