import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { OrgRole } from "@/generated/prisma/client";
import { requireProgramAccess } from "@/lib/server/auth";
import { generateRequestId, structuredError } from "@/lib/config";
import { logEvent } from "@/lib/server/event-log";
import { generateIngestAddress } from "@/lib/server/inbound-email";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/gateway/ingest-addresses?programId=...
 * List ingest addresses for a program.
 */
export async function GET(req: NextRequest) {
  const requestId = generateRequestId();
  try {
    const programId = req.nextUrl.searchParams.get("programId");
    if (!programId || !UUID_RE.test(programId)) {
      return NextResponse.json(
        { requestId, error: "programId query parameter required (UUID)" },
        { status: 400 },
      );
    }
    await requireProgramAccess(programId);

    const addresses = await prisma.ingestAddress.findMany({
      where: { programId },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ requestId, addresses });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED")
      return NextResponse.json({ requestId, error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN")
      return NextResponse.json({ requestId, error: "Forbidden" }, { status: 403 });
    console.error(structuredError({ requestId, route: "GET /ingest-addresses", error: e }));
    return NextResponse.json({ requestId, error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/gateway/ingest-addresses
 * Create a new ingest address for a program.
 * Body: { programId, label? }
 */
export async function POST(req: NextRequest) {
  const requestId = generateRequestId();
  let userId: string | undefined;
  try {
    const body = await req.json();
    const programId = body.programId as string;
    if (!programId || !UUID_RE.test(programId)) {
      return NextResponse.json(
        { requestId, error: "programId required (UUID)" },
        { status: 400 },
      );
    }

    const auth = await requireProgramAccess(programId, OrgRole.OPERATOR);
    userId = auth.userId;

    // Check if an active address already exists
    const existing = await prisma.ingestAddress.findFirst({
      where: { programId, isActive: true },
    });
    if (existing) {
      return NextResponse.json({ requestId, address: existing });
    }

    const address = generateIngestAddress(programId);

    const ingestAddress = await prisma.ingestAddress.create({
      data: {
        programId,
        orgId: auth.orgId,
        address,
        label: body.label ?? null,
        createdById: userId,
      },
    });

    await logEvent({
      programId,
      userId,
      action: "INGEST_ADDRESS_CREATED",
      entityType: "IngestAddress",
      entityId: ingestAddress.id,
      metadata: { address },
    });

    return NextResponse.json({ requestId, address: ingestAddress }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED")
      return NextResponse.json({ requestId, error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN")
      return NextResponse.json({ requestId, error: "Forbidden" }, { status: 403 });
    console.error(structuredError({ requestId, route: "POST /ingest-addresses", error: e, userId }));
    return NextResponse.json({ requestId, error: "Internal server error" }, { status: 500 });
  }
}
