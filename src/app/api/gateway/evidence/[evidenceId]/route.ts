import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { OrgRole } from "@/generated/prisma/client";
import { requireProgramAccess } from "@/lib/server/auth";
import { logEvent, getClientIp } from "@/lib/server/event-log";
import { getSignedUrl } from "@/lib/server/storage";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ evidenceId: string }> }
) {
  try {
    const { evidenceId } = await params;
    const evidence = await prisma.evidence.findUnique({ where: { id: evidenceId } });
    if (!evidence) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await requireProgramAccess(evidence.programId);
    const signedUrl = await getSignedUrl(evidence.storagePath);
    return NextResponse.json({ ...evidence, signedUrl });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ evidenceId: string }> }
) {
  try {
    const { evidenceId } = await params;
    const evidence = await prisma.evidence.findUnique({ where: { id: evidenceId } });
    if (!evidence) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const auth = await requireProgramAccess(evidence.programId, OrgRole.OPERATOR);
    if (evidence.finalized) {
      return NextResponse.json({ error: "Evidence already finalized" }, { status: 400 });
    }
    const updated = await prisma.evidence.update({
      where: { id: evidenceId },
      data: { finalized: true, finalizedAt: new Date() },
    });
    await logEvent({
      programId: evidence.programId, userId: auth.userId, action: "EVIDENCE_FINALIZED",
      entityType: "Evidence", entityId: evidenceId, ipAddress: getClientIp(req.headers),
    });
    return NextResponse.json(updated);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
