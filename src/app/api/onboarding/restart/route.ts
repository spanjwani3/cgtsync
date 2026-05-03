import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/server/auth";

/**
 * Clears the v1 tour state keys so both stages re-fire on next visit.
 * Other (future) keys in onboardingState are preserved.
 */
export async function POST() {
  let auth;
  try {
    auth = await requireAuth();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const existing = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: { onboardingState: true },
  });

  const current =
    existing?.onboardingState && typeof existing.onboardingState === "object"
      ? (existing.onboardingState as Record<string, unknown>)
      : {};

  const next = { ...current };
  for (const key of Object.keys(next)) {
    if (key.startsWith("tour_v1_")) delete next[key];
  }

  await prisma.user.update({
    where: { id: auth.userId },
    data: { onboardingState: next },
  });

  return NextResponse.json({ ok: true });
}
