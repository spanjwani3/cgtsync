/**
 * CLI wrapper around the shared `onboardTenant()` logic in
 * `src/lib/server/onboard-tenant.ts`. Same code path as the admin UI at
 * `/admin/tenants/new`. Use this when you don't have a browser available
 * or want to script tenant provisioning.
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

import { onboardTenant } from "../src/lib/server/onboard-tenant";
import { prisma } from "../src/lib/prisma";

interface RawArgs {
  slug: string;
  name: string;
  program: string;
  cdmo?: string;
  admins: string[];
  inbound: string | null;
  allowDomains: string[];
}

function parseArgs(argv: string[]): RawArgs {
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
    if (!out[k]) throw new Error(`Missing required arg --${k}`);
  }

  return {
    slug: out.slug,
    name: out.name,
    program: out.program,
    cdmo: out.cdmo,
    admins: out.admin.split(",").map((e) => e.trim()).filter(Boolean),
    inbound: out.inbound ?? null,
    allowDomains: (out["allow-domain"] ?? "")
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const result = await onboardTenant({
    slug: args.slug,
    name: args.name,
    program: args.program,
    cdmo: args.cdmo,
    admins: args.admins,
    inbound: args.inbound,
    allowDomains: args.allowDomains,
  });

  console.log(`Onboarded tenant: ${result.org.name} (${result.org.slug})`);
  console.log(`Tenant URL:       ${result.tenantHost}`);
  console.log(`Org id:           ${result.org.id}`);
  console.log(`Program:          ${result.program.name} (${result.program.id})`);
  console.log("");
  for (const a of result.admins) {
    const welcome = a.welcomeEmail.sent
      ? `sent (resend id ${a.welcomeEmail.resendId})`
      : `NOT SENT — ${a.welcomeEmail.error ?? "unknown"}`;
    console.log(`Admin: ${a.email}`);
    console.log(`  user id:        ${a.userId ?? "(failed)"}`);
    console.log(`  welcome email:  ${welcome}`);
    console.log(`  magic link:     ${a.magicLink ?? "(failed to mint)"}`);
    console.log(`  temp password:  ${a.password ?? "(none)"}`);
    if (a.error) console.log(`  error:          ${a.error}`);
    console.log("");
  }
  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
