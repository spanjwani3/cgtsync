import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { OrgRole } from "@/generated/prisma/client";
import { requireProgramAccess } from "@/lib/server/auth";
import { logEvent, getClientIp } from "@/lib/server/event-log";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ programId: string }> }
) {
  try {
    const { programId } = await params;
    const auth = await requireProgramAccess(programId);

    const contacts = await prisma.programContact.findMany({
      where: { programId },
      orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
    });

    // Derive "last contacted" from EmailLog
    const emails = contacts.map((c) => c.email);
    const lastEmails = emails.length > 0
      ? await prisma.emailLog.findMany({
          where: { programId, recipientEmail: { in: emails } },
          orderBy: { createdAt: "desc" },
          distinct: ["recipientEmail"],
          select: { recipientEmail: true, createdAt: true },
        })
      : [];
    const lastContactedMap = Object.fromEntries(
      lastEmails.map((l) => [l.recipientEmail, l.createdAt])
    );

    return NextResponse.json(
      contacts.map((c) => ({
        ...c,
        lastContactedAt: lastContactedMap[c.email] ?? null,
      }))
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    console.error("[GET /api/programs/:id/contacts] Unhandled error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ programId: string }> }
) {
  try {
    const { programId } = await params;
    const auth = await requireProgramAccess(programId, OrgRole.OPERATOR);
    const body = await req.json();
    const { name, email, title, organizationName, contactType, phone, isPrimary } = body;

    if (!name || !email) {
      return NextResponse.json({ error: "name and email are required" }, { status: 400 });
    }

    // If setting as primary, unset other primaries in this program
    if (isPrimary) {
      await prisma.programContact.updateMany({
        where: { programId, isPrimary: true },
        data: { isPrimary: false },
      });
    }

    const contact = await prisma.programContact.create({
      data: {
        programId,
        orgId: auth.orgId,
        name,
        email,
        title: title ?? null,
        organizationName: organizationName ?? null,
        contactType: contactType ?? "CLIENT",
        phone: phone ?? null,
        isPrimary: isPrimary ?? false,
      },
    });

    await logEvent({
      programId,
      userId: auth.userId,
      action: "PROGRAM_UPDATED",
      entityType: "ProgramContact",
      entityId: contact.id,
      ipAddress: getClientIp(req.headers),
      metadata: { action: "CONTACT_CREATED", contactEmail: email },
    });

    return NextResponse.json(contact, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    console.error("[POST /api/programs/:id/contacts] Unhandled error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
