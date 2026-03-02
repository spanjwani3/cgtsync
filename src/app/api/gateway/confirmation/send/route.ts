import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { OrgRole, MagicLinkScope } from "@/generated/prisma/client";
import { requireProgramAccess } from "@/lib/server/auth";
import { generateRequestId, structuredError } from "@/lib/config";
import { createConfirmationEmail } from "@/lib/server/magic-link";

export async function POST(req: NextRequest) {
  const requestId = generateRequestId();
  let userId: string | undefined;
  try {
    const body = await req.json();
    const { programId, entityType, entityId, recipientEmail, recipientName, message } = body;

    if (!programId || !entityType || !entityId || !recipientEmail) {
      return NextResponse.json(
        { requestId, error: "Missing required fields: programId, entityType, entityId, recipientEmail" },
        { status: 400 }
      );
    }

    if (entityType !== "BASELINE" && entityType !== "CHANGE") {
      return NextResponse.json(
        { requestId, error: "entityType must be BASELINE or CHANGE" },
        { status: 400 }
      );
    }

    const auth = await requireProgramAccess(programId, OrgRole.OPERATOR);
    userId = auth.userId;

    // Validate entity is in RELEASED status
    let entityTitle = "";
    let items: { label: string; value: string }[] = [];

    if (entityType === "BASELINE") {
      const baseline = await prisma.baseline.findUnique({
        where: { id: entityId },
        include: { clauses: { take: 5, orderBy: { sortOrder: "asc" } } },
      });
      if (!baseline || baseline.programId !== programId) {
        return NextResponse.json({ requestId, error: "Baseline not found" }, { status: 404 });
      }
      if (baseline.status !== "RELEASED") {
        return NextResponse.json(
          { requestId, error: "Baseline must be in RELEASED status to send confirmation" },
          { status: 400 }
        );
      }
      entityTitle = baseline.title;
      items = [
        { label: "Version", value: `v${baseline.version}` },
        { label: "Clauses", value: `${baseline.clauses.length} items` },
      ];
    } else {
      const change = await prisma.change.findUnique({ where: { id: entityId } });
      if (!change || change.programId !== programId) {
        return NextResponse.json({ requestId, error: "Change not found" }, { status: 404 });
      }
      if (change.status !== "RELEASED") {
        return NextResponse.json(
          { requestId, error: "Change must be in RELEASED status to send confirmation" },
          { status: 400 }
        );
      }
      entityTitle = change.title;
      items = [
        { label: "Change #", value: String(change.sequenceNum) },
        { label: "Severity", value: change.severity },
        ...(change.estimatedImpact
          ? [{ label: "Impact", value: `$${Number(change.estimatedImpact).toLocaleString()}` }]
          : []),
      ];
    }

    // Get PM name and org name for email
    const [sender, org] = await Promise.all([
      prisma.user.findUnique({ where: { id: auth.userId }, select: { fullName: true } }),
      prisma.organization.findFirst({
        where: { id: auth.orgId },
        select: { name: true },
      }),
    ]);

    const scope = entityType === "BASELINE"
      ? MagicLinkScope.BASELINE_CONFIRM
      : MagicLinkScope.CHANGE_CONFIRM;

    const result = await createConfirmationEmail({
      scope,
      entityId,
      createdById: auth.userId,
      programId,
      orgId: auth.orgId,
      recipientEmail,
      recipientName,
      message,
      entityTitle,
      items,
      pmName: sender?.fullName ?? undefined,
      orgName: org?.name ?? undefined,
    });

    if (result.error) {
      return NextResponse.json(
        { requestId, emailLogId: result.emailLogId, error: result.error },
        { status: 502 }
      );
    }

    return NextResponse.json({
      requestId,
      emailLogId: result.emailLogId,
      magicLinkId: result.magicLinkId,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    if (message === "UNAUTHORIZED") {
      return NextResponse.json({ requestId, error: "Unauthorized" }, { status: 401 });
    }
    if (message === "FORBIDDEN") {
      return NextResponse.json({ requestId, error: "Forbidden" }, { status: 403 });
    }
    if (message === "RATE_LIMIT_EXCEEDED") {
      return NextResponse.json(
        { requestId, error: "Rate limit exceeded" },
        { status: 429 }
      );
    }
    console.error(structuredError({
      requestId,
      route: "POST /api/gateway/confirmation/send",
      error: e,
      userId,
    }));
    return NextResponse.json({ requestId, error: "Internal server error" }, { status: 500 });
  }
}
