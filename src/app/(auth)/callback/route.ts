import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/programs";

  if (code) {
    const supabase = await createClient();
    const { error, data } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.user) {
      // Upsert user record (idempotent)
      await prisma.user.upsert({
        where: { id: data.user.id },
        update: { email: data.user.email ?? "" },
        create: {
          id: data.user.id,
          email: data.user.email ?? "",
          fullName: data.user.user_metadata?.full_name ?? null,
        },
      });

      // Ensure org membership exists (idempotent — handles race conditions)
      await ensureOrgMembership(data.user.id, data.user.email ?? "");

      return NextResponse.redirect(new URL(next, req.url));
    }
  }

  return NextResponse.redirect(new URL("/login?error=auth_failed", req.url));
}

/**
 * Create default org + membership if the user doesn't have one.
 * Wrapped in try-catch to handle the race where two concurrent requests
 * both see no membership and both try to create — the unique slug constraint
 * on organizations will reject the second attempt.
 */
async function ensureOrgMembership(userId: string, email: string) {
  const existing = await prisma.orgMember.findFirst({
    where: { userId },
  });
  if (existing) return;

  try {
    const org = await prisma.organization.create({
      data: {
        name: `${email.split("@")[0]}'s Organization`,
        slug: `org-${userId.slice(0, 8)}`,
      },
    });
    await prisma.orgMember.create({
      data: { orgId: org.id, userId, role: "ADMIN" },
    });
  } catch {
    // Unique constraint violation (slug or orgId_userId) — another request
    // already created the org. This is expected under concurrent requests.
  }
}
