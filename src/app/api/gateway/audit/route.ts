import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { OrgRole } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireProgramAccess, requireTenantOrgAccess } from "@/lib/server/auth";
import { generateRequestId } from "@/lib/config";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = typeof value === "string" ? value : JSON.stringify(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET(req: NextRequest) {
  const requestId = generateRequestId();
  try {
    const params = req.nextUrl.searchParams;
    const programId = params.get("programId");
    const tenantWide = params.get("orgId") === "self";

    let where: Prisma.EventLogWhereInput;

    if (tenantWide) {
      const auth = await requireTenantOrgAccess(OrgRole.ADMIN);
      where = { program: { orgId: auth.orgId } };

      const programFilter = params.get("filterProgramId");
      if (programFilter) {
        if (!UUID_RE.test(programFilter)) {
          return NextResponse.json(
            { requestId, error: "filterProgramId must be a UUID" },
            { status: 400 },
          );
        }
        where.programId = programFilter;
      }
    } else {
      if (!programId || !UUID_RE.test(programId)) {
        return NextResponse.json(
          { requestId, error: "programId query parameter required (UUID), or pass orgId=self for tenant-wide" },
          { status: 400 },
        );
      }
      await requireProgramAccess(programId);
      where = { programId };
    }

    const userId = params.get("userId");
    if (userId) {
      if (!UUID_RE.test(userId)) {
        return NextResponse.json(
          { requestId, error: "userId must be a UUID" },
          { status: 400 },
        );
      }
      where.userId = userId;
    }

    const action = params.get("action");
    if (action) {
      where.action = action as Prisma.EventLogWhereInput["action"];
    }

    const from = params.get("from");
    const to = params.get("to");
    if (from || to) {
      const range: Prisma.DateTimeFilter = {};
      if (from) {
        const d = new Date(from);
        if (Number.isNaN(d.getTime())) {
          return NextResponse.json(
            { requestId, error: "from must be a valid ISO timestamp" },
            { status: 400 },
          );
        }
        range.gte = d;
      }
      if (to) {
        const d = new Date(to);
        if (Number.isNaN(d.getTime())) {
          return NextResponse.json(
            { requestId, error: "to must be a valid ISO timestamp" },
            { status: 400 },
          );
        }
        range.lte = d;
      }
      where.createdAt = range;
    }

    const format = params.get("format");

    if (format === "csv") {
      const entries = await prisma.eventLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 10000,
        include: {
          user: { select: { email: true } },
          program: { select: { name: true } },
        },
      });

      const header = ["timestamp", "user", "program", "action", "entity_type", "entity_id", "ip", "metadata"];
      const rows = entries.map((e) => [
        e.createdAt.toISOString(),
        e.user?.email ?? "",
        e.program?.name ?? "",
        e.action,
        e.entityType ?? "",
        e.entityId ?? "",
        e.ipAddress ?? "",
        e.metadata ? JSON.stringify(e.metadata) : "",
      ]);

      const csv = [header, ...rows]
        .map((row) => row.map(csvEscape).join(","))
        .join("\n");

      const filename = `audit-${new Date().toISOString().slice(0, 10)}.csv`;

      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    }

    const limit = Math.min(
      Number(params.get("limit") ?? "100"),
      500,
    );
    const offset = Number(params.get("offset") ?? "0");

    const [entries, total] = await Promise.all([
      prisma.eventLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
        include: {
          user: { select: { email: true } },
          program: tenantWide ? { select: { id: true, name: true } } : undefined,
        },
      }),
      prisma.eventLog.count({ where }),
    ]);

    return NextResponse.json({ requestId, entries, total, limit, offset });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED")
      return NextResponse.json({ requestId, error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN")
      return NextResponse.json({ requestId, error: "Forbidden" }, { status: 403 });
    console.error("[GET /api/gateway/audit] Unhandled error:", e);
    return NextResponse.json(
      { requestId, error: "Internal server error" },
      { status: 500 },
    );
  }
}
