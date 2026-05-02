import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma, EventAction } from "@/generated/prisma/client";
import { requirePlatformAdmin } from "@/lib/server/auth";
import { generateRequestId, structuredError } from "@/lib/config";

const VALID_ACTIONS = new Set(Object.values(EventAction));

const PAGE_SIZE = 50;

/**
 * GET /api/admin/activity
 *
 * Platform-admin activity feed across all tenants. Query event_logs joined
 * to programs → organizations (for tenant name) and users (for actor email).
 *
 * Query params:
 *   ?orgId=<uuid>      filter to one tenant
 *   ?action=<comma>    filter to one or more EventAction values
 *   ?from=<iso>        events on or after this timestamp
 *   ?to=<iso>          events on or before this timestamp
 *   ?page=<n>          1-indexed; PAGE_SIZE per page
 */
export async function GET(req: NextRequest) {
  const requestId = generateRequestId();
  try {
    await requirePlatformAdmin();

    const orgId = req.nextUrl.searchParams.get("orgId");
    const actionParam = req.nextUrl.searchParams.get("action");
    const fromParam = req.nextUrl.searchParams.get("from");
    const toParam = req.nextUrl.searchParams.get("to");
    const pageParam = req.nextUrl.searchParams.get("page");
    const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);

    const where: Prisma.EventLogWhereInput = {};

    if (orgId) {
      where.program = { orgId };
    }

    if (actionParam) {
      const actions = actionParam
        .split(",")
        .map((s) => s.trim())
        .filter((s): s is EventAction =>
          VALID_ACTIONS.has(s as EventAction),
        );
      if (actions.length > 0) {
        where.action = { in: actions };
      }
    }

    if (fromParam || toParam) {
      where.createdAt = {};
      if (fromParam) {
        const from = new Date(fromParam);
        if (!isNaN(from.getTime())) {
          (where.createdAt as { gte?: Date; lte?: Date }).gte = from;
        }
      }
      if (toParam) {
        const to = new Date(toParam);
        if (!isNaN(to.getTime())) {
          (where.createdAt as { gte?: Date; lte?: Date }).lte = to;
        }
      }
    }

    const [events, total, orgs] = await Promise.all([
      prisma.eventLog.findMany({
        where,
        include: {
          user: { select: { email: true, fullName: true } },
          program: {
            select: {
              id: true,
              name: true,
              org: { select: { id: true, slug: true, name: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      prisma.eventLog.count({ where }),
      // Tenant dropdown source — only orgs with real subdomain slugs
      prisma.organization.findMany({
        where: { slug: { not: { startsWith: "org-" } } },
        select: { id: true, name: true, slug: true },
        orderBy: { name: "asc" },
      }),
    ]);

    return NextResponse.json({
      requestId,
      events: events.map((e) => ({
        id: e.id,
        action: e.action,
        entityType: e.entityType,
        entityId: e.entityId,
        metadata: e.metadata,
        createdAt: e.createdAt,
        actor: e.user
          ? {
              email: e.user.email,
              fullName: e.user.fullName,
            }
          : null,
        program: e.program
          ? {
              id: e.program.id,
              name: e.program.name,
            }
          : null,
        tenant: e.program?.org
          ? {
              id: e.program.org.id,
              slug: e.program.org.slug,
              name: e.program.org.name,
            }
          : null,
      })),
      page,
      pageSize: PAGE_SIZE,
      total,
      hasMore: page * PAGE_SIZE < total,
      tenants: orgs,
    });
  } catch (e) {
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
      structuredError({ requestId, route: "/api/admin/activity GET", error: e }),
    );
    return NextResponse.json(
      { requestId, error: "Internal server error" },
      { status: 500 },
    );
  }
}
