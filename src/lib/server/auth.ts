import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { OrgRole } from "@/generated/prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/server/tenant";

export interface AuthContext {
  userId: string;
  email: string;
}

export interface OrgAuthContext extends AuthContext {
  orgId: string;
  role: OrgRole;
}

export interface ProgramAuthContext extends OrgAuthContext {
  programId: string;
}

/**
 * Get the authenticated user from the Supabase session.
 * Returns null if not authenticated.
 */
export async function getAuthUser(): Promise<AuthContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  return {
    userId: user.id,
    email: user.email ?? "",
  };
}

/**
 * Require authentication. Returns auth context or throws redirect.
 */
export async function requireAuth(): Promise<AuthContext> {
  const auth = await getAuthUser();
  if (!auth) {
    throw new Error("UNAUTHORIZED");
  }
  return auth;
}

/**
 * Check if the user has membership in an org and return their role.
 */
export async function getOrgMembership(
  userId: string,
  orgId: string
): Promise<{ role: OrgRole } | null> {
  const member = await prisma.orgMember.findUnique({
    where: { orgId_userId: { orgId, userId } },
    select: { role: true },
  });
  return member;
}

/**
 * Require org membership. Returns org auth context or responds with error.
 */
export async function requireOrgAccess(
  orgId: string,
  minRole?: OrgRole
): Promise<OrgAuthContext> {
  const auth = await requireAuth();
  const membership = await getOrgMembership(auth.userId, orgId);

  if (!membership) {
    throw new Error("FORBIDDEN");
  }

  if (minRole) {
    const roleHierarchy: Record<OrgRole, number> = {
      [OrgRole.READ_ONLY]: 0,
      [OrgRole.OPERATOR]: 1,
      [OrgRole.ADMIN]: 2,
    };
    if (roleHierarchy[membership.role] < roleHierarchy[minRole]) {
      throw new Error("FORBIDDEN");
    }
  }

  return {
    ...auth,
    orgId,
    role: membership.role,
  };
}

/**
 * Require access to the tenant org resolved by subdomain middleware.
 * Use this in routes scoped to the request host rather than a URL param.
 * Falls back to a generic requireAuth if no tenant header is present
 * (multi-tenant mode disabled).
 */
export async function requireTenantOrgAccess(
  minRole?: OrgRole,
): Promise<OrgAuthContext | AuthContext> {
  const tenant = await getTenantContext();
  if (!tenant) {
    return await requireAuth();
  }
  return await requireOrgAccess(tenant.orgId, minRole);
}

/**
 * Require the authenticated user to be a platform admin (super admin).
 * Membership is determined by the PLATFORM_ADMIN_EMAILS env var
 * (comma-separated, case-insensitive). Throws FORBIDDEN if not in the list.
 */
export async function requirePlatformAdmin(): Promise<AuthContext> {
  const auth = await requireAuth();
  const allowlist = (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (!allowlist.includes(auth.email.toLowerCase())) {
    throw new Error("FORBIDDEN");
  }
  return auth;
}

/**
 * Require program access. Looks up program's org and checks membership.
 */
export async function requireProgramAccess(
  programId: string,
  minRole?: OrgRole
): Promise<ProgramAuthContext> {
  const program = await prisma.program.findUnique({
    where: { id: programId },
    select: { orgId: true },
  });

  if (!program) {
    throw new Error("NOT_FOUND");
  }

  const orgAuth = await requireOrgAccess(program.orgId, minRole);

  return {
    ...orgAuth,
    programId,
  };
}

/**
 * API route wrapper that handles auth errors consistently.
 */
export function withAuth<T>(
  handler: (auth: AuthContext, req: NextRequest) => Promise<NextResponse<T>>
) {
  return async (req: NextRequest) => {
    try {
      const auth = await requireAuth();
      return await handler(auth, req);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      if (message === "UNAUTHORIZED") {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      if (message === "FORBIDDEN") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (message === "NOT_FOUND") {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  };
}
