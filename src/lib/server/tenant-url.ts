/**
 * DB-backed tenant URL helper.
 *
 * Lives in a separate file from `tenant.ts` because tenant.ts is imported
 * by middleware.ts which runs on the Edge Runtime. Edge can't load
 * Node.js APIs (node:fs, node:crypto, etc.) — Prisma's pg adapter pulls
 * those in. Even a dynamic `await import("@/lib/prisma")` inside
 * tenant.ts gets traced into the middleware bundle by the Next.js Edge
 * bundler and fails the deploy.
 *
 * This file is server-side-only (Node runtime). Never import it from
 * middleware.ts or any other Edge-runtime entry point.
 */

import { prisma } from "@/lib/prisma";
import { buildTenantUrl } from "./tenant";

/**
 * Look up an org by id and build a tenant-subdomain URL for it.
 * Throws ORG_NOT_FOUND if the org doesn't exist.
 */
export async function buildTenantUrlForOrg(
  orgId: string,
  path: string,
): Promise<string> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { slug: true },
  });
  if (!org) throw new Error("ORG_NOT_FOUND");
  return buildTenantUrl(org.slug, path);
}
