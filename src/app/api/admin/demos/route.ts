import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/server/auth";
import { getDemo } from "@/lib/demo/catalog";
import { generateRequestId, structuredError } from "@/lib/config";

/**
 * GET /api/admin/demos
 *
 * Platform-admin analytics for gated demo videos: per-slug engagement summary
 * plus a per-lead breakdown (view count, total watch time, furthest %,
 * completion, last viewed).
 */
export async function GET() {
  const requestId = generateRequestId();
  try {
    await requirePlatformAdmin();

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [leads, views] = await Promise.all([
      prisma.demoLead.findMany({ orderBy: { createdAt: "desc" } }),
      prisma.demoView.findMany({ orderBy: { startedAt: "desc" } }),
    ]);

    // Aggregate views per lead.
    const byLead = new Map<
      string,
      {
        viewCount: number;
        watchedSeconds: number;
        maxPositionSec: number;
        durationSec: number | null;
        completed: boolean;
        lastViewedAt: Date;
      }
    >();
    for (const v of views) {
      const cur = byLead.get(v.leadId);
      if (!cur) {
        byLead.set(v.leadId, {
          viewCount: 1,
          watchedSeconds: v.watchedSeconds,
          maxPositionSec: v.maxPositionSec,
          durationSec: v.durationSec,
          completed: v.completed,
          lastViewedAt: v.startedAt,
        });
      } else {
        cur.viewCount += 1;
        cur.watchedSeconds += v.watchedSeconds;
        cur.maxPositionSec = Math.max(cur.maxPositionSec, v.maxPositionSec);
        cur.durationSec = cur.durationSec ?? v.durationSec;
        cur.completed = cur.completed || v.completed;
        if (v.startedAt > cur.lastViewedAt) cur.lastViewedAt = v.startedAt;
      }
    }

    const leadRows = leads.map((lead) => {
      const agg = byLead.get(lead.id);
      const duration = agg?.durationSec ?? null;
      const furthestPct =
        duration && duration > 0 && agg
          ? Math.min(100, Math.round((agg.maxPositionSec / duration) * 100))
          : null;
      return {
        id: lead.id,
        email: lead.email,
        name: lead.name,
        company: lead.company,
        demoSlug: lead.demoSlug,
        demoTitle: getDemo(lead.demoSlug)?.title ?? lead.demoSlug,
        capturedAt: lead.createdAt,
        viewCount: agg?.viewCount ?? 0,
        totalWatchedSeconds: agg?.watchedSeconds ?? 0,
        furthestPct,
        completed: agg?.completed ?? false,
        lastViewedAt: agg?.lastViewedAt ?? null,
      };
    });

    // Per-demo summary.
    const slugs = new Set<string>([
      ...leads.map((l) => l.demoSlug),
      ...views.map((v) => v.demoSlug),
    ]);
    const demos = Array.from(slugs).map((slug) => {
      const slugViews = views.filter((v) => v.demoSlug === slug);
      const slugLeads = leads.filter((l) => l.demoSlug === slug);
      const totalViews = slugViews.length;
      const completedViews = slugViews.filter((v) => v.completed).length;
      const watchSum = slugViews.reduce((s, v) => s + v.watchedSeconds, 0);
      return {
        slug,
        title: getDemo(slug)?.title ?? slug,
        uniqueLeads: slugLeads.length,
        totalViews,
        viewsLast7Days: slugViews.filter((v) => v.startedAt >= sevenDaysAgo)
          .length,
        avgWatchSeconds: totalViews ? Math.round(watchSum / totalViews) : 0,
        completionRate: totalViews
          ? Math.round((completedViews / totalViews) * 100)
          : 0,
      };
    });

    return NextResponse.json({ requestId, demos, leads: leadRows });
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
      structuredError({ requestId, route: "/api/admin/demos GET", error: e }),
    );
    return NextResponse.json(
      { requestId, error: "Internal server error" },
      { status: 500 },
    );
  }
}
