import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { OrgRole } from "@/generated/prisma/client";
import { requireAuth, getOrgMembership } from "@/lib/server/auth";
import { logEvent, getClientIp } from "@/lib/server/event-log";
import { deleteStorageFile } from "@/lib/server/storage";

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();

    // Require ADMIN of at least one org
    const membership = await prisma.orgMember.findFirst({
      where: { userId: auth.userId, role: OrgRole.ADMIN },
    });
    if (!membership) return NextResponse.json({ error: "Admin access required" }, { status: 403 });

    const expired = await prisma.evidence.findMany({
      where: {
        retainUntil: { lt: new Date() },
        deletedAt: null,
      },
    });

    const results = [];
    for (const ev of expired) {
      try {
        await deleteStorageFile(ev.storagePath);
        await prisma.evidence.update({
          where: { id: ev.id },
          data: { deletedAt: new Date() },
        });
        await logEvent({
          programId: ev.programId, userId: auth.userId, action: "RETENTION_DELETE_EXECUTED",
          entityType: "Evidence", entityId: ev.id,
          metadata: { fileName: ev.fileName, retainUntil: ev.retainUntil?.toISOString() ?? null },
          ipAddress: getClientIp(req.headers),
        });
        results.push({ id: ev.id, status: "deleted" });
      } catch (err) {
        results.push({ id: ev.id, status: "error", error: err instanceof Error ? err.message : "Unknown" });
      }
    }

    return NextResponse.json({ processed: results.length, results });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
