/**
 * Tenant onboarding logic, shared between the admin UI
 * (`POST /api/admin/tenants`) and the CLI script
 * (`scripts/onboard-tenant.ts`).
 *
 * Creates Organization + Program + admin Supabase Auth users + OrgMember rows
 * + magic links. Idempotent — re-running with the same slug updates existing
 * rows and reissues magic links.
 */

import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";
import { isValidTenantSlug } from "@/lib/server/tenant";

export interface OnboardArgs {
  slug: string;
  name: string;
  program: string;
  cdmo?: string;
  admins: string[];
  inbound?: string | null;
  allowDomains?: string[];
}

export interface OnboardedAdmin {
  email: string;
  userId: string | null;
  magicLink: string | null;
  error: string | null;
}

export interface OnboardResult {
  org: { id: string; name: string; slug: string };
  program: { id: string; name: string };
  tenantHost: string;
  admins: OnboardedAdmin[];
}

export class OnboardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OnboardError";
  }
}

function getAdminSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new OnboardError(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function onboardTenant(args: OnboardArgs): Promise<OnboardResult> {
  const slug = args.slug.trim().toLowerCase();
  const name = args.name.trim();
  const programName = args.program.trim();
  const cdmo = (args.cdmo ?? args.name).trim();
  const inbound = args.inbound?.trim().toLowerCase() || null;
  const allowDomains = (args.allowDomains ?? [])
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  const admins = Array.from(
    new Set(args.admins.map((e) => e.trim()).filter(Boolean)),
  );

  if (!isValidTenantSlug(slug)) {
    throw new OnboardError(
      `Invalid slug "${slug}". Must be a-z 0-9 hyphens, not reserved, and not start with "org-".`,
    );
  }
  if (!name) throw new OnboardError("Org name required");
  if (!programName) throw new OnboardError("Program name required");
  if (admins.length === 0) {
    throw new OnboardError("At least one admin email required");
  }

  const supabase = getAdminSupabase();
  const rootDomain = process.env.ROOT_DOMAIN ?? "cgtsync.ai";
  const tenantHost = `https://${slug}.${rootDomain}`;

  const org = await prisma.organization.upsert({
    where: { slug },
    update: { name },
    create: { name, slug },
  });

  const existingProgram = await prisma.program.findFirst({
    where: { orgId: org.id, name: programName },
  });
  const program = existingProgram
    ? await prisma.program.update({
        where: { id: existingProgram.id },
        data: {
          cdmoName: cdmo,
          status: "ACTIVE",
          inboundEmailAddress: inbound,
          inboundSenderAllowlist: allowDomains,
        },
      })
    : await prisma.program.create({
        data: {
          orgId: org.id,
          name: programName,
          cdmoName: cdmo,
          status: "ACTIVE",
          currency: "USD",
          inboundEmailAddress: inbound,
          inboundSenderAllowlist: allowDomains,
          activatedAt: new Date(),
        },
      });

  const adminResults: OnboardedAdmin[] = [];
  for (const email of admins) {
    adminResults.push(
      await provisionAdmin(supabase, org.id, email, tenantHost),
    );
  }

  return {
    org: { id: org.id, name: org.name, slug: org.slug },
    program: { id: program.id, name: program.name },
    tenantHost,
    admins: adminResults,
  };
}

async function provisionAdmin(
  supabase: SupabaseClient,
  orgId: string,
  email: string,
  tenantHost: string,
): Promise<OnboardedAdmin> {
  let userId: string | null = null;
  let error: string | null = null;

  const created = await supabase.auth.admin.createUser({
    email,
    email_confirm: true,
  });

  if (created.data.user) {
    userId = created.data.user.id;
  } else if (created.error) {
    const lookup = await supabase.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });
    const existing = lookup.data?.users.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase(),
    );
    if (existing) {
      userId = existing.id;
    } else {
      error = created.error.message;
    }
  }

  if (!userId) {
    return { email, userId: null, magicLink: null, error };
  }

  await prisma.user.upsert({
    where: { id: userId },
    update: { email },
    create: { id: userId, email },
  });

  await prisma.orgMember.upsert({
    where: { orgId_userId: { orgId, userId } },
    update: { role: "ADMIN" },
    create: { orgId, userId, role: "ADMIN" },
  });

  const link = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: `${tenantHost}/callback` },
  });

  const properties = link.data?.properties as
    | { action_link?: string }
    | undefined;
  const action_link = properties?.action_link ?? null;

  return {
    email,
    userId,
    magicLink: action_link,
    error: link.error?.message ?? error,
  };
}
