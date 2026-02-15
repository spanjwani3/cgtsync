import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireProgramAccess } from "@/lib/server/auth";
import { generateRequestId } from "@/lib/config";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  const requestId = generateRequestId();
  try {
    const programId = req.nextUrl.searchParams.get("programId");
    if (!programId || !UUID_RE.test(programId)) {
      return NextResponse.json(
        { requestId, error: "programId query parameter required (UUID)" },
        { status: 400 }
      );
    }
    await requireProgramAccess(programId);

    const limit = Math.min(
      Number(req.nextUrl.searchParams.get("limit") ?? "100"),
      500
    );
    const offset = Number(req.nextUrl.searchParams.get("offset") ?? "0");

    const [entries, total] = await Promise.all([
      prisma.eventLog.findMany({
        where: { programId },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
        include: { user: { select: { email: true } } },
      }),
      prisma.eventLog.count({ where: { programId } }),
    ]);

    return NextResponse.json({ requestId, entries, total, limit, offset });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED")
      return NextResponse.json({ requestId, error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN")
      return NextResponse.json({ requestId, error: "Forbidden" }, { status: 403 });
    return NextResponse.json(
      { requestId, error: "Internal server error" },
      { status: 500 }
    );
  }
}
