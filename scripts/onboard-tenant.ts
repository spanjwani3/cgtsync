/**
 * Onboard a new tenant: create the org, the first program, and admin users
 * in Supabase Auth, then mint magic links for each admin.
 *
 * Usage:
 *   npx tsx scripts/onboard-tenant.ts \
 *     --slug cellipont \
 *     --name "Cellipont" \
 *     --program "Cellipont — CDMO Manufacturing" \
 *     --cdmo "Cellipont" \
 *     --admin jkuzniar@cellipont.com,dkommireddy@cellipont.com,ebeale@cellipont.com \
 *     --inbound cellipont@inbox.cgtsync.ai \
 *     --allow-domain cellipont.com
 *
 * Requires env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * DATABASE_URL, DIRECT_URL, ROOT_DOMAIN.
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { createClient } from "@supabase/supabase-js";
import { isValidTenantSlug } from "../src/lib/server/tenant";

const prisma = new PrismaClient({
  adapter: new PrismaPg(
    new Pool({
      connectionString:
        process.env.DATABASE_URL ?? process.env.DIRECT_URL ?? "",
    }),
  ),
});

interface Args {
  slug: string;
  name: string;
  program: string;
  cdmo: string;
  admins: string[];
  inbound: string | null;
  allowDomains: string[];
}

function parseArgs(argv: string[]): Args {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = "true";
    } else {
      out[key] = next;
      i++;
    }
  }

  const required = ["slug", "name", "program", "admin"];
  for (const k of required) {
    if (!out[k]) {
      throw new Error(`Missing required arg --${k}`);
    }
  }

  return {
    slug: out.slug.trim().toLowerCase(),
    name: out.name.trim(),
    program: out.program.trim(),
    cdmo: (out.cdmo ?? out.name).trim(),
    admins: out.admin.split(",").map((e) => e.trim()).filter(Boolean),
    inbound: out.inbound ? out.inbound.trim().toLowerCase() : null,
    allowDomains: (out["allow-domain"] ?? "")
      .split(",")
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!isValidTenantSlug(args.slug)) {
    throw new Error(
      `Invalid slug "${args.slug}". Must be a-z 0-9 hyphens, not reserved, and not start with "org-".`,
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const rootDomain = process.env.ROOT_DOMAIN ?? "cgtsync.ai";
  const tenantHost = `https://${args.slug}.${rootDomain}`;

  console.log(`Onboarding tenant: ${args.name} (${args.slug})`);
  console.log(`Tenant URL:        ${tenantHost}`);
  console.log("");

  const org = await prisma.organization.upsert({
    where: { slug: args.slug },
    update: { name: args.name },
    create: { name: args.name, slug: args.slug },
  });
  console.log(`Org:     ${org.name} (${org.id})`);

  const existingProgram = await prisma.program.findFirst({
    where: { orgId: org.id, name: args.program },
  });
  const program = existingProgram
    ? await prisma.program.update({
        where: { id: existingProgram.id },
        data: {
          cdmoName: args.cdmo,
          status: "ACTIVE",
          inboundEmailAddress: args.inbound,
          inboundSenderAllowlist: args.allowDomains,
        },
      })
    : await prisma.program.create({
        data: {
          orgId: org.id,
          name: args.program,
          cdmoName: args.cdmo,
          status: "ACTIVE",
          currency: "USD",
          inboundEmailAddress: args.inbound,
          inboundSenderAllowlist: args.allowDomains,
          activatedAt: new Date(),
        },
      });
  console.log(`Program: ${program.name} (${program.id})`);
  if (args.inbound) {
    console.log(`Inbox:   ${args.inbound}`);
  }
  if (args.allowDomains.length) {
    console.log(`Allowed: ${args.allowDomains.join(", ")}`);
  }
  console.log("");

  for (const email of args.admins) {
    const result = await provisionAdmin(supabase, org.id, email, tenantHost);
    console.log(`Admin:   ${email}`);
    console.log(`  user id:    ${result.userId}`);
    console.log(`  magic link: ${result.magicLink ?? "(failed to mint — see error)"}`);
    if (result.error) {
      console.log(`  error:      ${result.error}`);
    }
    console.log("");
  }

  console.log("Done.");
}

interface AdminResult {
  userId: string;
  magicLink: string | null;
  error: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseAdmin = any;

async function provisionAdmin(
  supabase: SupabaseAdmin,
  orgId: string,
  email: string,
  redirectBase: string,
): Promise<AdminResult> {
  let userId: string | null = null;
  let error: string | null = null;

  const created = await supabase.auth.admin.createUser({
    email,
    email_confirm: true,
  });

  if (created.data.user) {
    userId = created.data.user.id;
  } else if (created.error) {
    const lookup = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
    const existing = lookup.data?.users.find(
      (u: { email?: string | null }) =>
        u.email?.toLowerCase() === email.toLowerCase(),
    );
    if (existing) {
      userId = existing.id;
    } else {
      error = created.error.message;
    }
  }

  if (!userId) {
    return { userId: "", magicLink: null, error };
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
    options: { redirectTo: `${redirectBase}/auth/callback` },
  });

  const action_link =
    (link.data?.properties as { action_link?: string } | undefined)
      ?.action_link ?? null;

  return { userId, magicLink: action_link, error: link.error?.message ?? error };
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
