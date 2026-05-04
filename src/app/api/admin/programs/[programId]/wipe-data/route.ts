import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/server/auth";
import { generateRequestId, structuredError } from "@/lib/config";
import {
  countProgramData,
  wipeProgramData,
} from "@/lib/server/admin/wipeProgramData";

/**
 * GET /api/admin/programs/[programId]/wipe-data
 *
 * Preview: returns counts of what wipeProgramData would delete. Read-only.
 * Platform admin only.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ programId: string }> },
) {
  const requestId = generateRequestId();
  try {
    await requirePlatformAdmin();
    const { programId } = await params;

    const program = await prisma.program.findUnique({
      where: { id: programId },
      select: {
        id: true,
        name: true,
        org: { select: { id: true, slug: true, name: true } },
      },
    });
    if (!program) {
      return NextResponse.json(
        { requestId, error: "Program not found" },
        { status: 404 },
      );
    }

    const counts = await countProgramData(program.id);
    const orgMemberCount = await prisma.orgMember.count({
      where: { orgId: program.org.id },
    });
    return NextResponse.json({ requestId, program, counts, orgMemberCount });
  } catch (e) {
    return errorResponse(requestId, e, "GET");
  }
}

/**
 * POST /api/admin/programs/[programId]/wipe-data
 *
 * Destructive: wipes all program-scoped data, preserving the program shell
 * (program row, org, members, branding, ingest addresses).
 *
 * Body must include `confirmName` exactly matching the program's name as a
 * second factor against accidental clicks. Platform admin only.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ programId: string }> },
) {
  const requestId = generateRequestId();
  try {
    await requirePlatformAdmin();
    const { programId } = await params;
    const body = (await req.json().catch(() => null)) as
      | { confirmName?: unknown; keepEventLogs?: unknown }
      | null;
    if (!body || typeof body.confirmName !== "string") {
      return NextResponse.json(
        { requestId, error: "confirmName required" },
        { status: 400 },
      );
    }

    const program = await prisma.program.findUnique({
      where: { id: programId },
      select: {
        id: true,
        name: true,
        org: { select: { id: true, slug: true, name: true } },
      },
    });
    if (!program) {
      return NextResponse.json(
        { requestId, error: "Program not found" },
        { status: 404 },
      );
    }

    if (body.confirmName.trim() !== program.name) {
      return NextResponse.json(
        {
          requestId,
          error: `Confirmation mismatch: type the program name exactly to confirm`,
        },
        { status: 400 },
      );
    }

    const before = await countProgramData(program.id);
    await wipeProgramData(program.id, {
      keepEventLogs: body.keepEventLogs === true,
    });
    const after = await countProgramData(program.id);

    return NextResponse.json({
      requestId,
      program,
      before,
      after,
    });
  } catch (e) {
    return errorResponse(requestId, e, "POST");
  }
}

function errorResponse(requestId: string, e: unknown, method: string) {
  const msg = e instanceof Error ? e.message : "";
  if (msg === "UNAUTHORIZED")
    return NextResponse.json(
      { requestId, error: "Unauthorized" },
      { status: 401 },
    );
  if (msg === "FORBIDDEN")
    return NextResponse.json(
      { requestId, error: "Platform admin access required" },
      { status: 403 },
    );
  console.error(
    structuredError({
      requestId,
      route: `/api/admin/programs/[programId]/wipe-data ${method}`,
      error: e,
    }),
  );
  return NextResponse.json(
    { requestId, error: "Internal server error" },
    { status: 500 },
  );
}
