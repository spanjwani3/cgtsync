/**
 * Tenant resolution from request host.
 *
 * In MULTI_TENANT_MODE the middleware extracts the subdomain from the Host
 * header, looks up the matching Organization by slug, and stamps the request
 * with `x-tenant-org-id` and `x-tenant-slug` headers. Server components and
 * route handlers read those headers via `getTenantContext()`.
 *
 * The flag exists so we can roll back to single-tenant behavior instantly if
 * the middleware misbehaves in production.
 */

import { headers } from "next/headers";

export const TENANT_ORG_HEADER = "x-tenant-org-id";
export const TENANT_SLUG_HEADER = "x-tenant-slug";

export const ROOT_DOMAIN = process.env.ROOT_DOMAIN ?? "cgtsync.ai";
export const MULTI_TENANT_MODE = process.env.MULTI_TENANT_MODE === "true";

/** Subdomains that are reserved for the platform and cannot be tenant slugs. */
export const RESERVED_SUBDOMAINS = new Set([
  "www",
  "api",
  "app",
  "auth",
  "admin",
  "mail",
  "inbox",
  "static",
  "assets",
  "cdn",
  "docs",
  "blog",
  "status",
]);

const SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function isValidTenantSlug(slug: string): boolean {
  if (!slug) return false;
  if (RESERVED_SUBDOMAINS.has(slug)) return false;
  if (slug.startsWith("org-")) return false; // auto-generated default-org slugs are not subdomains
  return SLUG_REGEX.test(slug);
}

export interface ParsedHost {
  host: string;
  subdomain: string | null;
  isRoot: boolean;
}

export function parseHost(rawHost: string | null | undefined): ParsedHost {
  const host = (rawHost ?? "").split(":")[0].toLowerCase();
  if (!host) return { host: "", subdomain: null, isRoot: false };

  if (host === ROOT_DOMAIN) return { host, subdomain: null, isRoot: true };
  if (host === `www.${ROOT_DOMAIN}`) return { host, subdomain: null, isRoot: true };

  const suffix = `.${ROOT_DOMAIN}`;
  if (host.endsWith(suffix)) {
    const sub = host.slice(0, -suffix.length);
    if (sub.includes(".")) return { host, subdomain: null, isRoot: false };
    return { host, subdomain: sub, isRoot: false };
  }

  // Local dev: foo.localhost
  if (host.endsWith(".localhost")) {
    const sub = host.slice(0, -".localhost".length);
    if (!sub || sub.includes(".")) return { host, subdomain: null, isRoot: false };
    return { host, subdomain: sub, isRoot: false };
  }

  if (host === "localhost") return { host, subdomain: null, isRoot: true };

  return { host, subdomain: null, isRoot: false };
}

export interface TenantContext {
  orgId: string;
  slug: string;
}

/** Read tenant context inside server components / route handlers. */
export async function getTenantContext(): Promise<TenantContext | null> {
  const h = await headers();
  const orgId = h.get(TENANT_ORG_HEADER);
  const slug = h.get(TENANT_SLUG_HEADER);
  if (!orgId || !slug) return null;
  return { orgId, slug };
}

// ─── Tenant URL helpers ──────────────────────────────────────

/**
 * Build a URL on a tenant subdomain (e.g. https://cellipont.cgtsync.ai/foo).
 * Use this for customer-facing links — confirmation emails, magic links,
 * etc. NEXT_PUBLIC_SITE_URL points at the apex which serves the marketing
 * site (Lovable), not the app.
 *
 * This file is imported by middleware.ts (Edge Runtime). Anything in here
 * MUST be Edge-safe — no Prisma, no Node.js APIs. The DB-backed variant
 * `buildTenantUrlForOrg(orgId, path)` lives in `./tenant-url.ts` precisely
 * to keep Prisma out of the middleware bundle.
 */
export function buildTenantUrl(orgSlug: string, path: string): string {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `https://${orgSlug}.${ROOT_DOMAIN}${cleanPath}`;
}
