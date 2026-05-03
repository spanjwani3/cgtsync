import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/server/auth";

const VALID_KEY = /^tour_v1_(overview|program)_(completed_at|dismissed_at|remind_at)$/;

export async function POST(req: NextRequest) {
  let auth;
  try {
    auth = await requireAuth();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    key?: string;
    value?: string | null;
  } | null;

  if (!body || typeof body.key !== "string" || !VALID_KEY.test(body.key)) {
    return NextResponse.json(
      { error: "key must match tour_v1_(overview|program)_(completed_at|dismissed_at|remind_at)" },
      { status: 400 },
    );
  }

  if (body.value !== null && typeof body.value !== "string") {
    return NextResponse.json(
      { error: "value must be an ISO timestamp string or null" },
      { status: 400 },
    );
  }

  if (typeof body.value === "string" && Number.isNaN(Date.parse(body.value))) {
    return NextResponse.json(
      { error: "value must be a parseable ISO timestamp" },
      { status: 400 },
    );
  }

  // Merge into existing JSON state — Prisma JSON updates replace the whole
  // column, so read-modify-write is required. Concurrent writes to different
  // keys in the same session are unlikely (Joyride emits one milestone at a
  // time), so a transaction isn't worth the overhead here.
  const existing = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: { onboardingState: true },
  });

  const current =
    existing?.onboardingState && typeof existing.onboardingState === "object"
      ? (existing.onboardingState as Record<string, unknown>)
      : {};

  const next = { ...current, [body.key]: body.value };

  const updated = await prisma.user.update({
    where: { id: auth.userId },
    data: { onboardingState: next },
    select: { onboardingState: true },
  });

  return NextResponse.json({ onboardingState: updated.onboardingState });
}
