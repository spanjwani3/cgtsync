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
      // Upsert user record
      await prisma.user.upsert({
        where: { id: data.user.id },
        update: { email: data.user.email ?? "" },
        create: {
          id: data.user.id,
          email: data.user.email ?? "",
          fullName: data.user.user_metadata?.full_name ?? null,
        },
      });

      // Check if user has an org; if not, create default org
      const existingMembership = await prisma.orgMember.findFirst({
        where: { userId: data.user.id },
      });

      if (!existingMembership) {
        const org = await prisma.organization.create({
          data: {
            name: `${data.user.email?.split("@")[0]}'s Organization`,
            slug: `org-${data.user.id.slice(0, 8)}`,
          },
        });
        await prisma.orgMember.create({
          data: { orgId: org.id, userId: data.user.id, role: "ADMIN" },
        });
      }

      return NextResponse.redirect(new URL(next, req.url));
    }
  }

  return NextResponse.redirect(new URL("/login?error=auth_failed", req.url));
}
