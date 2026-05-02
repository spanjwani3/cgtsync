import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireProgramAccess } from "@/lib/server/auth";
import { generateRequestId, structuredError } from "@/lib/config";

/**
 * GET /api/gateway/evidence/[evidenceId]/email-view
 *
 * For evidence that was created from an inbound email, returns the linked
 * InboundEmail record so the UI can render a properly formatted email
 * view (sender, subject, date, body) instead of just the raw .txt body.
 *
 * 404 if the evidence has no linked inbound email (i.e. uploaded via UI,
 * not received as inbound). Caller should fall back to signed URL view.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ evidenceId: string }> },
) {
  const requestId = generateRequestId();
  try {
    const { evidenceId } = await params;

    const evidence = await prisma.evidence.findUnique({
      where: { id: evidenceId },
      select: {
        id: true,
        programId: true,
        type: true,
        fileName: true,
        createdAt: true,
        metadata: true,
      },
    });
    if (!evidence) {
      return NextResponse.json(
        { requestId, error: "Evidence not found" },
        { status: 404 },
      );
    }

    await requireProgramAccess(evidence.programId);

    // Find linked InboundEmail. We try two paths:
    //   1. evidence.metadata.inboundEmailId (set by older /ingest path)
    //   2. inboundEmail.evidenceId === evidence.id (set by Postmark path)
    const metadata =
      typeof evidence.metadata === "object" && evidence.metadata !== null
        ? (evidence.metadata as Record<string, unknown>)
        : {};
    const inboundEmailId =
      typeof metadata.inboundEmailId === "string"
        ? metadata.inboundEmailId
        : null;

    const inbound = inboundEmailId
      ? await prisma.inboundEmail.findUnique({
          where: { id: inboundEmailId },
          include: { ingestAddress: { select: { address: true } } },
        })
      : await prisma.inboundEmail.findFirst({
          where: { evidenceId: evidence.id },
          include: { ingestAddress: { select: { address: true } } },
          orderBy: { createdAt: "desc" },
        });

    if (!inbound) {
      return NextResponse.json(
        {
          requestId,
          error: "Evidence has no linked inbound email",
          evidenceId,
        },
        { status: 404 },
      );
    }

    return NextResponse.json({
      requestId,
      evidence: {
        id: evidence.id,
        type: evidence.type,
        fileName: evidence.fileName,
        createdAt: evidence.createdAt,
      },
      email: {
        id: inbound.id,
        toAddress: inbound.ingestAddress.address,
        fromEmail: inbound.fromEmail,
        fromName: inbound.fromName,
        subject: inbound.subject,
        textBody: inbound.textBody,
        detectedType: inbound.detectedType,
        status: inbound.status,
        receivedAt: inbound.createdAt,
        processedAt: inbound.processedAt,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED")
      return NextResponse.json(
        { requestId, error: "Unauthorized" },
        { status: 401 },
      );
    if (msg === "FORBIDDEN")
      return NextResponse.json(
        { requestId, error: "Forbidden" },
        { status: 403 },
      );
    console.error(
      structuredError({
        requestId,
        route: "/api/gateway/evidence/[id]/email-view GET",
        error: e,
      }),
    );
    return NextResponse.json(
      { requestId, error: "Internal server error" },
      { status: 500 },
    );
  }
}
