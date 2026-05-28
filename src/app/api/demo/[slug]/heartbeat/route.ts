import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getDemo } from "@/lib/demo/catalog";
import { verifyAccess, accessCookieName } from "@/lib/demo/access-token";
import { generateRequestId, structuredError } from "@/lib/config";

/** Upper bound on a sane demo length (seconds) to clamp inflated values. */
const MAX_REASONABLE_SECONDS = 4 * 60 * 60;

const BodySchema = z.object({
  watchedSeconds: z.number().nonnegative().finite(),
  positionSeconds: z.number().nonnegative().finite(),
  durationSeconds: z.number().nonnegative().finite().optional(),
});

/**
 * POST /api/demo/[slug]/heartbeat
 *
 * Public (gated by the signed access cookie). Records playback progress for
 * the current view session so the admin analytics can show watch time and
 * completion. Fire-and-forget from the client.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const requestId = generateRequestId();
  try {
    const { slug } = await params;
    if (!getDemo(slug)) {
      return NextResponse.json({ error: "Demo not found" }, { status: 404 });
    }

    const cookieStore = await cookies();
    const token = cookieStore.get(accessCookieName(slug))?.value;
    const access = verifyAccess(token, slug);
    if (!access) {
      return NextResponse.json({ error: "No active access" }, { status: 401 });
    }

    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const clamp = (n: number) =>
      Math.min(Math.round(n), MAX_REASONABLE_SECONDS);
    const watched = clamp(parsed.data.watchedSeconds);
    const position = clamp(parsed.data.positionSeconds);
    const duration = parsed.data.durationSeconds
      ? clamp(parsed.data.durationSeconds)
      : null;

    const view = await prisma.demoView.findUnique({
      where: { id: access.viewId },
      select: {
        id: true,
        demoSlug: true,
        watchedSeconds: true,
        maxPositionSec: true,
        durationSec: true,
      },
    });
    if (!view || view.demoSlug !== slug) {
      return NextResponse.json({ error: "View not found" }, { status: 404 });
    }

    const newWatched = Math.max(view.watchedSeconds, watched);
    const newMaxPos = Math.max(view.maxPositionSec, position);
    const newDuration = duration ?? view.durationSec;
    const completed =
      newDuration != null && newDuration > 0 && newMaxPos >= 0.9 * newDuration;

    await prisma.demoView.update({
      where: { id: view.id },
      data: {
        watchedSeconds: newWatched,
        maxPositionSec: newMaxPos,
        durationSec: newDuration,
        completed,
        lastHeartbeatAt: new Date(),
      },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(
      structuredError({
        requestId,
        route: "/api/demo/[slug]/heartbeat POST",
        error: e,
      }),
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
