import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { OrgRole } from "@/generated/prisma/client";
import { requireProgramAccess } from "@/lib/server/auth";
import { generateRequestId, structuredError } from "@/lib/config";
import { logEvent } from "@/lib/server/event-log";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * DELETE /api/gateway/ingest-addresses/[id]
 * Deactivate an ingest address (soft delete).
 */
export async function DELETE(
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

    const address = await prisma.ingestAddress.findUnique({
      where: { id },
    });
    if (!address) {
      return NextResponse.json({ requestId, error: "Not found" }, { status: 404 });
    }

    const auth = await requireProgramAccess(address.programId, OrgRole.OPERATOR);
    userId = auth.userId;

    await prisma.ingestAddress.update({
      where: { id },
      data: { isActive: false },
    });

    await logEvent({
      programId: address.programId,
      userId,
      action: "INGEST_ADDRESS_DEACTIVATED",
      entityType: "IngestAddress",
      entityId: id,
      metadata: { address: address.address },
    });

    return NextResponse.json({ requestId, deactivated: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED")
      return NextResponse.json({ requestId, error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN")
      return NextResponse.json({ requestId, error: "Forbidden" }, { status: 403 });
    console.error(structuredError({ requestId, route: "DELETE /ingest-addresses/[id]", error: e, userId }));
    return NextResponse.json({ requestId, error: "Internal server error" }, { status: 500 });
  }
}
