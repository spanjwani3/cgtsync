/**
 * Tenant member invite and resend-invite helpers.
 *
 * Reuses the auth + email primitives from onboard-tenant.ts. Used by the
 * tenant-side Members settings page (POST /api/org/members and
 * /api/org/members/[userId]/resend-invite). Does NOT bypass tenant isolation
 * — callers must gate with requireTenantOrgAccess(ADMIN) upstream.
 *
 * Caveat: like onboardTenant, these helpers reset Supabase Auth passwords
 * directly. If the same email exists as a member of another tenant, that
 * tenant's password will be reset too. Acceptable for our current single-
 * tenant-per-user reality; revisit before we have shared users.
 */

import type { OrgRole } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  buildProvisionContextForOrg,
  generatePassword,
  getAdminSupabase,
  sendWelcomeEmail,
  type ProvisionContext,
} from "@/lib/server/onboard-tenant";

export type InviteStatus = "CREATED" | "ALREADY_MEMBER";

export interface InviteResult {
  status: InviteStatus;
  userId: string;
  email: string;
  role: OrgRole;
  password: string | null;
  magicLink: string | null;
  passwordReset: boolean;
  welcomeEmail: { sent: boolean; resendId: string | null; error: string | null };
  error: string | null;
}

export interface ResendResult {
  userId: string;
  email: string;
  password: string;
  magicLink: string | null;
  welcomeEmail: { sent: boolean; resendId: string | null; error: string | null };
  error: string | null;
}

export class InviteError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "InviteError";
    this.status = status;
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

async function findOrCreateSupabaseUser(
  email: string,
): Promise<{ userId: string; passwordReset: boolean; password: string; error: string | null }> {
  const supabase = getAdminSupabase();
  const password = generatePassword();

  const created = await supabase.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
  });

  if (created.data.user) {
    return { userId: created.data.user.id, passwordReset: false, password, error: null };
  }

  // Look up existing user (createUser failed because email already exists)
  const lookup = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
  const existing = lookup.data?.users.find(
    (u) => u.email?.toLowerCase() === email.toLowerCase(),
  );
  if (!existing) {
    throw new InviteError(
      created.error?.message ?? "Failed to create or find Supabase user",
      500,
    );
  }
  // Existing user — reset their password so the new credential we email works.
  const updated = await supabase.auth.admin.updateUserById(existing.id, { password });
  if (updated.error) {
    return {
      userId: existing.id,
      passwordReset: false,
      password,
      error: `Password reset failed: ${updated.error.message}`,
    };
  }
  return { userId: existing.id, passwordReset: true, password, error: null };
}

async function generateMagicLink(
  email: string,
  ctx: ProvisionContext,
): Promise<{ link: string | null; error: string | null }> {
  const supabase = getAdminSupabase();
  const link = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: `${ctx.tenantHost}/callback` },
  });
  const properties = link.data?.properties as { action_link?: string } | undefined;
  return {
    link: properties?.action_link ?? null,
    error: link.error?.message ?? null,
  };
}

/**
 * Invite a new member to a tenant. If the email is already an OrgMember of
 * this org, returns ALREADY_MEMBER without creating credentials.
 */
export async function inviteMember(
  orgId: string,
  rawEmail: string,
  role: OrgRole,
): Promise<InviteResult> {
  const email = normalizeEmail(rawEmail);
  if (!EMAIL_RE.test(email)) {
    throw new InviteError("Invalid email", 400);
  }

  const ctx = await buildProvisionContextForOrg(orgId);
  if (!ctx) throw new InviteError("Org not found", 404);

  // Check if already a member of this org
  const existingUser = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existingUser) {
    const existingMember = await prisma.orgMember.findUnique({
      where: { orgId_userId: { orgId, userId: existingUser.id } },
      select: { role: true },
    });
    if (existingMember) {
      return {
        status: "ALREADY_MEMBER",
        userId: existingUser.id,
        email,
        role: existingMember.role,
        password: null,
        magicLink: null,
        passwordReset: false,
        welcomeEmail: { sent: false, resendId: null, error: "skipped: already a member" },
        error: null,
      };
    }
  }

  const { userId, passwordReset, password, error: provisionError } =
    await findOrCreateSupabaseUser(email);

  await prisma.user.upsert({
    where: { id: userId },
    update: { email },
    create: { id: userId, email },
  });

  await prisma.orgMember.upsert({
    where: { orgId_userId: { orgId, userId } },
    update: { role },
    create: { orgId, userId, role },
  });

  const { link: magicLink, error: linkError } = await generateMagicLink(email, ctx);
  const combinedError = provisionError ?? linkError;

  const welcomeEmail = await sendWelcomeEmail({
    ctx,
    userId,
    email,
    password,
    magicLink,
    passwordReset,
    skipReason: combinedError ?? (magicLink ? null : "no magic link"),
  });

  return {
    status: "CREATED",
    userId,
    email,
    role,
    password,
    magicLink,
    passwordReset,
    welcomeEmail,
    error: combinedError,
  };
}

/**
 * Re-issue credentials for an existing OrgMember. Generates a new temp
 * password, resets Supabase password, generates a fresh magic link, and
 * resends the welcome email. Mirrors onboardTenant idempotency behavior.
 */
export async function resendInvite(
  orgId: string,
  userId: string,
): Promise<ResendResult> {
  const member = await prisma.orgMember.findUnique({
    where: { orgId_userId: { orgId, userId } },
    select: { user: { select: { id: true, email: true } } },
  });
  if (!member) throw new InviteError("Member not found in this org", 404);

  const ctx = await buildProvisionContextForOrg(orgId);
  if (!ctx) throw new InviteError("Org not found", 404);

  const supabase = getAdminSupabase();
  const password = generatePassword();
  const updated = await supabase.auth.admin.updateUserById(userId, { password });
  let provisionError: string | null = null;
  if (updated.error) {
    provisionError = `Password reset failed: ${updated.error.message}`;
  }

  const { link: magicLink, error: linkError } = await generateMagicLink(
    member.user.email,
    ctx,
  );
  const combinedError = provisionError ?? linkError;

  const welcomeEmail = await sendWelcomeEmail({
    ctx,
    userId,
    email: member.user.email,
    password,
    magicLink,
    passwordReset: true,
    skipReason: combinedError ?? (magicLink ? null : "no magic link"),
  });

  return {
    userId,
    email: member.user.email,
    password,
    magicLink,
    welcomeEmail,
    error: combinedError,
  };
}
