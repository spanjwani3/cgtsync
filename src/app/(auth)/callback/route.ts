import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { MULTI_TENANT_MODE } from "@/lib/server/tenant";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/programs";

  if (code) {
    const supabase = await createClient();
    const { error, data } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.user) {
      await prisma.user.upsert({
        where: { id: data.user.id },
        update: { email: data.user.email ?? "" },
        create: {
          id: data.user.id,
          email: data.user.email ?? "",
          fullName: data.user.user_metadata?.full_name ?? null,
        },
      });

      const hasMembership = await ensureOrgMembership(
        data.user.id,
        data.user.email ?? "",
      );
      if (!hasMembership) {
        await supabase.auth.signOut();
        return NextResponse.redirect(
          new URL("/login?error=no_org_membership", req.url),
        );
      }

      return NextResponse.redirect(new URL(next, req.url));
    }
  }

  return NextResponse.redirect(new URL("/login?error=auth_failed", req.url));
}

/**
 * In single-tenant mode, auto-create a default org so first-time users land
 * somewhere. In multi-tenant production mode, fail closed: only users who
 * were pre-provisioned by the onboarding script proceed.
 */
async function ensureOrgMembership(
  userId: string,
  email: string,
): Promise<boolean> {
  const existing = await prisma.orgMember.findFirst({ where: { userId } });
  if (existing) return true;

  if (MULTI_TENANT_MODE) {
    return false;
  }

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
    return true;
  } catch {
    const retried = await prisma.orgMember.findFirst({ where: { userId } });
    return retried !== null;
  }
}
