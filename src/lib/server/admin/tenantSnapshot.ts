/**
 * Platform-admin tenant snapshot.
 *
 * Aggregates a single tenant's state for the support cockpit at
 * /admin/tenants/[slug]. Intentionally bypasses requireOrgAccess — callers
 * MUST gate with requirePlatformAdmin() upstream.
 */

import { prisma } from "@/lib/prisma";
import type { OrgRole, ProgramStatus, BaselineStatus } from "@/generated/prisma/client";

export type TenantSnapshot = {
  org: {
    id: string;
    name: string;
    slug: string;
    logoUrl: string | null;
    accentColor: string | null;
    createdAt: Date;
  };
  users: Array<{
    userId: string;
    email: string;
    fullName: string | null;
    role: OrgRole;
    joinedAt: Date;
    lastActivityAt: Date | null;
    eventCountLast30Days: number;
  }>;
  programs: Array<{
    id: string;
    name: string;
    status: ProgramStatus;
    cdmoName: string;
    modality: string | null;
    currency: string;
    baseline: {
      status: BaselineStatus;
      version: number;
      lockedAt: Date | null;
    } | null;
    counts: {
      changes: number;
      invoices: number;
      openScopeAlerts: number;
    };
    money: {
      flagged: number;
      disputed: number;
    };
    lastInvoiceAt: Date | null;
    lastEvidenceUploadAt: Date | null;
  }>;
  activity: Array<{
    id: string;
    action: string;
    entityType: string | null;
    entityId: string | null;
    metadata: Record<string, unknown> | null;
    ipAddress: string | null;
    createdAt: Date;
    user: { email: string; fullName: string | null } | null;
    program: { id: string; name: string } | null;
  }>;
  totals: {
    moneyFlagged: number;
    moneyDisputed: number;
    scopeAlertsOpen: number;
    scopeAlertsResolvedLast30Days: number;
    invoicesTotal: number;
    invoicesFlagged: number;
    invoicesApproved: number;
    invoicesDisputed: number;
    baselinesLocked: number;
    activeProgramsCount: number;
  };
  health: {
    lastEvidenceUploadAt: Date | null;
    lastBaselineLockedAt: Date | null;
    lastInvoiceAt: Date | null;
    stuckSignals: Array<{ severity: "info" | "warn"; message: string }>;
  };
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Look up an organization by slug. Returns null if missing.
 * Cross-tenant lookup — admin-only callers.
 */
export async function findOrgBySlug(slug: string) {
  return prisma.organization.findUnique({
    where: { slug },
    select: {
      id: true,
      name: true,
      slug: true,
      logoUrl: true,
      accentColor: true,
      createdAt: true,
    },
  });
}

export async function getTenantSnapshot(orgId: string): Promise<TenantSnapshot | null> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: {
      id: true,
      name: true,
      slug: true,
      logoUrl: true,
      accentColor: true,
      createdAt: true,
    },
  });
  if (!org) return null;

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);

  const [
    members,
    programs,
    activity,
    invoices,
    openScopeAlertsByProgram,
    resolvedScopeAlertsRecent,
    eventCountsByUser,
    lastActivityByUser,
    lastEvidenceByProgram,
    lastInvoiceByProgram,
    latestBaselines,
  ] = await Promise.all([
    prisma.orgMember.findMany({
      where: { orgId },
      select: {
        userId: true,
        role: true,
        createdAt: true,
        user: { select: { email: true, fullName: true } },
      },
    }),
    prisma.program.findMany({
      where: { orgId },
      select: {
        id: true,
        name: true,
        status: true,
        cdmoName: true,
        modality: true,
        currency: true,
        _count: {
          select: { changes: true, invoices: true },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.eventLog.findMany({
      where: { program: { orgId } },
      include: {
        user: { select: { email: true, fullName: true } },
        program: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.invoice.findMany({
      where: { program: { orgId } },
      select: {
        id: true,
        programId: true,
        status: true,
        totalAmount: true,
        invoiceDate: true,
        lineItems: { select: { amount: true, flag: true } },
      },
    }),
    prisma.scopeAlert.groupBy({
      by: ["programId"],
      where: { program: { orgId }, status: "OPEN" },
      _count: { _all: true },
    }),
    prisma.scopeAlert.count({
      where: {
        program: { orgId },
        status: { not: "OPEN" },
        resolvedAt: { gte: thirtyDaysAgo },
      },
    }),
    prisma.eventLog.groupBy({
      by: ["userId"],
      where: {
        program: { orgId },
        createdAt: { gte: thirtyDaysAgo },
        userId: { not: null },
      },
      _count: { _all: true },
    }),
    prisma.eventLog.groupBy({
      by: ["userId"],
      where: { program: { orgId }, userId: { not: null } },
      _max: { createdAt: true },
    }),
    prisma.evidence.groupBy({
      by: ["programId"],
      where: { program: { orgId } },
      _max: { createdAt: true },
    }),
    prisma.invoice.groupBy({
      by: ["programId"],
      where: { program: { orgId } },
      _max: { createdAt: true },
    }),
    prisma.baseline.findMany({
      where: { program: { orgId } },
      select: { programId: true, version: true, status: true, lockedAt: true },
      orderBy: [{ programId: "asc" }, { version: "desc" }],
    }),
  ]);

  // Index lookups
  const lastActivityMap = new Map<string, Date>();
  for (const r of lastActivityByUser) {
    if (r.userId && r._max.createdAt) lastActivityMap.set(r.userId, r._max.createdAt);
  }
  const eventCountMap = new Map<string, number>();
  for (const r of eventCountsByUser) {
    if (r.userId) eventCountMap.set(r.userId, r._count._all);
  }
  const openAlertsMap = new Map<string, number>();
  for (const r of openScopeAlertsByProgram) {
    openAlertsMap.set(r.programId, r._count._all);
  }
  const lastEvidenceMap = new Map<string, Date>();
  for (const r of lastEvidenceByProgram) {
    if (r._max.createdAt) lastEvidenceMap.set(r.programId, r._max.createdAt);
  }
  const lastInvoiceMap = new Map<string, Date>();
  for (const r of lastInvoiceByProgram) {
    if (r._max.createdAt) lastInvoiceMap.set(r.programId, r._max.createdAt);
  }

  // Latest baseline per program (already sorted version desc — first hit wins)
  const latestBaselineMap = new Map<
    string,
    { version: number; status: BaselineStatus; lockedAt: Date | null }
  >();
  for (const b of latestBaselines) {
    if (!latestBaselineMap.has(b.programId)) {
      latestBaselineMap.set(b.programId, {
        version: b.version,
        status: b.status,
        lockedAt: b.lockedAt,
      });
    }
  }

  // Per-program $ aggregates from invoices + line items
  const moneyByProgram = new Map<string, { flagged: number; disputed: number }>();
  let totalFlagged = 0;
  let totalDisputed = 0;
  let invoicesFlagged = 0;
  let invoicesApproved = 0;
  let invoicesDisputed = 0;

  for (const inv of invoices) {
    const programBucket = moneyByProgram.get(inv.programId) ?? { flagged: 0, disputed: 0 };

    // Flagged: sum line items whose flag != NONE
    for (const li of inv.lineItems) {
      if (li.flag !== "NONE") {
        const amt = Number(li.amount);
        programBucket.flagged += amt;
        totalFlagged += amt;
      }
    }

    // Disputed: invoice-level totalAmount when status = DISPUTED
    if (inv.status === "DISPUTED" && inv.totalAmount) {
      const amt = Number(inv.totalAmount);
      programBucket.disputed += amt;
      totalDisputed += amt;
    }

    moneyByProgram.set(inv.programId, programBucket);

    if (inv.status === "FLAGGED") invoicesFlagged++;
    if (inv.status === "APPROVED") invoicesApproved++;
    if (inv.status === "DISPUTED") invoicesDisputed++;
  }

  // Build user rows
  const users = members
    .map((m) => ({
      userId: m.userId,
      email: m.user.email,
      fullName: m.user.fullName,
      role: m.role,
      joinedAt: m.createdAt,
      lastActivityAt: lastActivityMap.get(m.userId) ?? null,
      eventCountLast30Days: eventCountMap.get(m.userId) ?? 0,
    }))
    .sort((a, b) => {
      // Most recently active first; nulls (never active) last
      const ax = a.lastActivityAt?.getTime() ?? -1;
      const bx = b.lastActivityAt?.getTime() ?? -1;
      return bx - ax;
    });

  // Build program rows
  const programRows = programs.map((p) => {
    const money = moneyByProgram.get(p.id) ?? { flagged: 0, disputed: 0 };
    const baseline = latestBaselineMap.get(p.id) ?? null;
    return {
      id: p.id,
      name: p.name,
      status: p.status,
      cdmoName: p.cdmoName,
      modality: p.modality,
      currency: p.currency,
      baseline,
      counts: {
        changes: p._count.changes,
        invoices: p._count.invoices,
        openScopeAlerts: openAlertsMap.get(p.id) ?? 0,
      },
      money,
      lastInvoiceAt: lastInvoiceMap.get(p.id) ?? null,
      lastEvidenceUploadAt: lastEvidenceMap.get(p.id) ?? null,
    };
  });

  // Totals
  const baselinesLocked = [...latestBaselineMap.values()].filter(
    (b) => b.status === "LOCKED",
  ).length;
  const activeProgramsCount = programs.filter((p) => p.status === "ACTIVE").length;
  const scopeAlertsOpen = [...openAlertsMap.values()].reduce((a, b) => a + b, 0);

  // Health timestamps (org-wide max)
  let lastEvidenceUploadAt: Date | null = null;
  for (const v of lastEvidenceMap.values()) {
    if (!lastEvidenceUploadAt || v > lastEvidenceUploadAt) lastEvidenceUploadAt = v;
  }
  let lastInvoiceAt: Date | null = null;
  for (const v of lastInvoiceMap.values()) {
    if (!lastInvoiceAt || v > lastInvoiceAt) lastInvoiceAt = v;
  }
  let lastBaselineLockedAt: Date | null = null;
  for (const b of latestBaselineMap.values()) {
    if (b.lockedAt && (!lastBaselineLockedAt || b.lockedAt > lastBaselineLockedAt)) {
      lastBaselineLockedAt = b.lockedAt;
    }
  }

  // Stuck signals — conservative thresholds
  const stuckSignals: TenantSnapshot["health"]["stuckSignals"] = [];
  const orgAgeDays = (now.getTime() - org.createdAt.getTime()) / DAY_MS;

  if (orgAgeDays > 7 && baselinesLocked === 0 && programs.length > 0) {
    stuckSignals.push({
      severity: "warn",
      message: "No baseline locked yet — onboarding may be stuck.",
    });
  }
  if (
    baselinesLocked > 0 &&
    (!lastInvoiceAt || now.getTime() - lastInvoiceAt.getTime() > 30 * DAY_MS)
  ) {
    stuckSignals.push({
      severity: "warn",
      message: "No invoices in the last 30 days.",
    });
  }
  // Stale open scope alerts
  const staleAlertCount = await prisma.scopeAlert.count({
    where: {
      program: { orgId },
      status: "OPEN",
      createdAt: { lt: new Date(now.getTime() - 14 * DAY_MS) },
    },
  });
  if (staleAlertCount > 0) {
    stuckSignals.push({
      severity: "info",
      message: `${staleAlertCount} scope alert${staleAlertCount === 1 ? "" : "s"} open >14 days.`,
    });
  }
  // Inactive users
  const inactiveJoinedLongAgo = users.filter(
    (u) =>
      u.lastActivityAt === null &&
      now.getTime() - u.joinedAt.getTime() > 7 * DAY_MS,
  ).length;
  if (inactiveJoinedLongAgo > 0) {
    stuckSignals.push({
      severity: "info",
      message: `${inactiveJoinedLongAgo} user${inactiveJoinedLongAgo === 1 ? "" : "s"} haven't taken any action since onboarding.`,
    });
  }

  return {
    org,
    users,
    programs: programRows,
    activity: activity.map((e) => ({
      id: e.id,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId,
      metadata: (e.metadata ?? null) as Record<string, unknown> | null,
      ipAddress: e.ipAddress,
      createdAt: e.createdAt,
      user: e.user ? { email: e.user.email, fullName: e.user.fullName } : null,
      program: e.program ? { id: e.program.id, name: e.program.name } : null,
    })),
    totals: {
      moneyFlagged: totalFlagged,
      moneyDisputed: totalDisputed,
      scopeAlertsOpen,
      scopeAlertsResolvedLast30Days: resolvedScopeAlertsRecent,
      invoicesTotal: invoices.length,
      invoicesFlagged,
      invoicesApproved,
      invoicesDisputed,
      baselinesLocked,
      activeProgramsCount,
    },
    health: {
      lastEvidenceUploadAt,
      lastBaselineLockedAt,
      lastInvoiceAt,
      stuckSignals,
    },
  };
}
