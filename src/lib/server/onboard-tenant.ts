/**
 * Tenant onboarding logic, shared between the admin UI
 * (`POST /api/admin/tenants`) and the CLI script
 * (`scripts/onboard-tenant.ts`).
 *
 * Creates Organization + Program + admin Supabase Auth users + OrgMember rows
 * + a temp password + magic link per admin, then sends each admin a welcome
 * email via Resend with login URL, magic link, and temp password. Idempotent —
 * re-running with the same slug updates existing rows, resets passwords, and
 * reissues magic links + welcome emails. Email send is best-effort: if Resend
 * rejects, tenant creation still succeeds and the credentials are returned in
 * the response for hand-delivery as a fallback.
 */

import { randomBytes } from "crypto";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";
import { isValidTenantSlug } from "@/lib/server/tenant";
import { sendEmail, logEmailSend } from "@/lib/server/email";
import { renderWelcomeEmail } from "@/lib/server/email-templates";
import { getOrgBranding } from "@/lib/server/org-branding";
import { addProjectDomain } from "@/lib/server/vercel";
import { EmailTemplateType } from "@/generated/prisma/client";

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
  password: string | null;
  passwordReset: boolean;
  magicLink: string | null;
  welcomeEmail: {
    sent: boolean;
    resendId: string | null;
    error: string | null;
  };
  error: string | null;
}

export interface OnboardResult {
  org: { id: string; name: string; slug: string };
  program: { id: string; name: string };
  tenantHost: string;
  loginUrl: string;
  admins: OnboardedAdmin[];
  vercelDomain: { added: boolean; error: string | null };
}

export class OnboardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OnboardError";
  }
}

/** Unambiguous alphabet (no 0/O/l/1/I) so users can copy the password without confusion. */
const PW_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

function generatePassword(): string {
  const bytes = randomBytes(16);
  let out = "";
  for (let i = 0; i < 16; i++) {
    out += PW_ALPHABET[bytes[i] % PW_ALPHABET.length];
  }
  return out;
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

  const provisionCtx = {
    orgId: org.id,
    orgSlug: org.slug,
    orgName: org.name,
    programId: program.id,
    programName: program.name,
    tenantHost,
    loginUrl: `${tenantHost}/login`,
  };
  const adminResults: OnboardedAdmin[] = [];
  for (const email of admins) {
    adminResults.push(await provisionAdmin(supabase, provisionCtx, email));
  }

  // Register the tenant subdomain with Vercel so TLS provisions automatically.
  // Best-effort: if Vercel is unreachable or token is missing, tenant creation
  // continues and the platform admin can add the domain manually in Vercel UI.
  const vercelDomain = await addProjectDomain(`${slug}.${rootDomain}`);

  // Create a default IngestAddress for the program so /scope shows a working
  // forwarding address immediately (no need for the customer to visit /scope
  // to bootstrap one). Uses the first successfully-provisioned admin as
  // createdById; skipped silently if no admin was created.
  const firstAdminId = adminResults.find((a) => a.userId)?.userId;
  if (firstAdminId) {
    const shortId = program.id.replace(/-/g, "").slice(0, 8);
    const domain = process.env.INGEST_EMAIL_DOMAIN ?? "inbox.cgtsync.ai";
    const ingestAddr = `prg-${shortId}@${domain}`;
    await prisma.ingestAddress.upsert({
      where: { address: ingestAddr },
      update: { isActive: true },
      create: {
        programId: program.id,
        orgId: org.id,
        address: ingestAddr,
        label: "Default ingest address",
        createdById: firstAdminId,
      },
    });
  }

  return {
    org: { id: org.id, name: org.name, slug: org.slug },
    program: { id: program.id, name: program.name },
    tenantHost,
    loginUrl: `${tenantHost}/login`,
    admins: adminResults,
    vercelDomain,
  };
}

interface ProvisionContext {
  orgId: string;
  orgSlug: string;
  orgName: string;
  programId: string;
  programName: string;
  tenantHost: string;
  loginUrl: string;
}

async function provisionAdmin(
  supabase: SupabaseClient,
  ctx: ProvisionContext,
  email: string,
): Promise<OnboardedAdmin> {
  const password = generatePassword();
  let userId: string | null = null;
  let passwordReset = false;
  let error: string | null = null;

  const created = await supabase.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
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
      // Existing user — reset their password so the new credential works.
      // Sessions issued on the old password are invalidated.
      const updated = await supabase.auth.admin.updateUserById(userId, {
        password,
      });
      if (updated.error) {
        error = `Password reset failed: ${updated.error.message}`;
      } else {
        passwordReset = true;
      }
    } else {
      error = created.error.message;
    }
  }

  if (!userId) {
    return {
      email,
      userId: null,
      password: null,
      passwordReset: false,
      magicLink: null,
      welcomeEmail: { sent: false, resendId: null, error: "skipped: user creation failed" },
      error,
    };
  }

  await prisma.user.upsert({
    where: { id: userId },
    update: { email },
    create: { id: userId, email },
  });

  await prisma.orgMember.upsert({
    where: { orgId_userId: { orgId: ctx.orgId, userId } },
    update: { role: "ADMIN" },
    create: { orgId: ctx.orgId, userId, role: "ADMIN" },
  });

  const link = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: `${ctx.tenantHost}/callback` },
  });

  const properties = link.data?.properties as
    | { action_link?: string }
    | undefined;
  const action_link = properties?.action_link ?? null;
  const linkError = link.error?.message ?? null;
  const combinedError = error ?? linkError;

  const welcomeEmail = await sendWelcomeEmail({
    ctx,
    userId,
    email,
    password,
    magicLink: action_link,
    passwordReset,
    skipReason: combinedError ?? (action_link ? null : "no magic link"),
  });

  return {
    email,
    userId,
    password,
    passwordReset,
    magicLink: action_link,
    welcomeEmail,
    error: combinedError,
  };
}

interface SendWelcomeArgs {
  ctx: ProvisionContext;
  userId: string;
  email: string;
  password: string;
  magicLink: string | null;
  passwordReset: boolean;
  skipReason: string | null;
}

async function sendWelcomeEmail(
  args: SendWelcomeArgs,
): Promise<{ sent: boolean; resendId: string | null; error: string | null }> {
  if (args.skipReason || !args.magicLink) {
    return {
      sent: false,
      resendId: null,
      error: args.skipReason ?? "no magic link",
    };
  }

  const subject = `Welcome to CGT Sync — your ${args.ctx.orgName} admin account`;
  try {
    const branding = await getOrgBranding(args.ctx.orgId);
    const html = renderWelcomeEmail({
      recipientEmail: args.email,
      orgName: args.ctx.orgName,
      programName: args.ctx.programName,
      loginUrl: args.ctx.loginUrl,
      magicLink: args.magicLink,
      tempPassword: args.password,
      accentColor: branding.accentColor,
    });
    const sendResult = await sendEmail({ to: args.email, subject, html });

    try {
      await logEmailSend({
        orgId: args.ctx.orgId,
        programId: args.ctx.programId,
        senderUserId: args.userId,
        recipientEmail: args.email,
        subject,
        templateType: EmailTemplateType.WELCOME,
        resendId: sendResult.id,
        metadata: {
          tenantSlug: args.ctx.orgSlug,
          passwordReset: args.passwordReset,
        },
      });
    } catch (logErr) {
      console.warn(
        "logEmailSend failed during welcome email; email itself was sent:",
        logErr,
      );
    }

    return sendResult.id
      ? { sent: true, resendId: sendResult.id, error: null }
      : {
          sent: false,
          resendId: null,
          error: sendResult.error ?? "Resend returned no id",
        };
  } catch (e) {
    return {
      sent: false,
      resendId: null,
      error: e instanceof Error ? e.message : "Welcome email failed",
    };
  }
}
