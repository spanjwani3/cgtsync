import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { OrgRole } from "@/generated/prisma";
import { requireAuth, requireOrgAccess } from "@/lib/server/auth";
import { logEvent, getClientIp } from "@/lib/server/event-log";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth();

    // Look up user's first org membership
    const membership = await prisma.orgMember.findFirst({
      where: { userId: auth.userId },
      select: { orgId: true },
    });

    if (!membership) {
      return NextResponse.json({ error: "No organization found" }, { status: 404 });
    }

    const programs = await prisma.program.findMany({
      where: { orgId: membership.orgId },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ programs });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    if (message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { orgId, name, cdmoName, molecule, modality, description, currency, changeThreshold } = body;

    if (!orgId || !name || !cdmoName) {
      return NextResponse.json(
        { error: "orgId, name, and cdmoName are required" },
        { status: 400 }
      );
    }

    const auth = await requireOrgAccess(orgId, OrgRole.OPERATOR);

    const program = await prisma.program.create({
      data: {
        orgId,
        name,
        cdmoName,
        molecule: molecule ?? null,
        modality: modality ?? null,
        description: description ?? null,
        currency: currency ?? "USD",
        changeThreshold: changeThreshold ?? null,
      },
    });

    await logEvent({
      programId: program.id,
      userId: auth.userId,
      action: "PROGRAM_CREATED",
      entityType: "Program",
      entityId: program.id,
      metadata: { name, cdmoName },
      ipAddress: getClientIp(req.headers),
    });

    return NextResponse.json({ program }, { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    if (message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (message === "FORBIDDEN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
