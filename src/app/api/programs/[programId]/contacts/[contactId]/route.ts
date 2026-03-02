import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { OrgRole } from "@/generated/prisma/client";
import { requireProgramAccess } from "@/lib/server/auth";
import { logEvent, getClientIp } from "@/lib/server/event-log";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ programId: string; contactId: string }> }
) {
  try {
    const { programId, contactId } = await params;
    const auth = await requireProgramAccess(programId, OrgRole.OPERATOR);

    const existing = await prisma.programContact.findUnique({
      where: { id: contactId },
      select: { programId: true },
    });
    if (!existing || existing.programId !== programId) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    const body = await req.json();
    const allowed = ["name", "email", "title", "organizationName", "contactType", "phone", "isPrimary"];
    const data: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in body) data[key] = body[key];
    }

    // If setting as primary, unset other primaries in this program
    if (data.isPrimary === true) {
      await prisma.programContact.updateMany({
        where: { programId, isPrimary: true, id: { not: contactId } },
        data: { isPrimary: false },
      });
    }

    const updated = await prisma.programContact.update({
      where: { id: contactId },
      data,
    });

    await logEvent({
      programId,
      userId: auth.userId,
      action: "PROGRAM_UPDATED",
      entityType: "ProgramContact",
      entityId: contactId,
      ipAddress: getClientIp(req.headers),
      metadata: { action: "CONTACT_UPDATED" },
    });

    return NextResponse.json(updated);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    console.error("[PATCH /api/programs/:id/contacts/:contactId] Unhandled error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ programId: string; contactId: string }> }
) {
  try {
    const { programId, contactId } = await params;
    const auth = await requireProgramAccess(programId, OrgRole.OPERATOR);

    const existing = await prisma.programContact.findUnique({
      where: { id: contactId },
      select: { programId: true },
    });
    if (!existing || existing.programId !== programId) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    await prisma.programContact.delete({ where: { id: contactId } });

    await logEvent({
      programId,
      userId: auth.userId,
      action: "PROGRAM_UPDATED",
      entityType: "ProgramContact",
      entityId: contactId,
      ipAddress: getClientIp(req.headers),
      metadata: { action: "CONTACT_DELETED" },
    });

    return NextResponse.json({ deleted: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    console.error("[DELETE /api/programs/:id/contacts/:contactId] Unhandled error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
