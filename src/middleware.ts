import { NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import {
  MULTI_TENANT_MODE,
  ROOT_DOMAIN,
  TENANT_ORG_HEADER,
  TENANT_SLUG_HEADER,
  isAdminHost,
  isValidTenantSlug,
  parseHost,
} from "@/lib/server/tenant";

export async function middleware(request: NextRequest) {
  const url = request.nextUrl;
  const rawHost = request.headers.get("host");
  const host = (rawHost ?? "").split(":")[0].toLowerCase();
  const isLocal = host === "localhost" || host.endsWith(".localhost");
  const isAdmin = isAdminHost(rawHost);
  const isAdminPath =
    url.pathname.startsWith("/admin") || url.pathname.startsWith("/api/admin");

  // Platform admin lives on a single canonical host (admin.<ROOT_DOMAIN>).
  // Tenant subdomains never serve /admin/* or /api/admin/* — redirect those
  // paths so admin cookies/sessions stay scoped to the admin subdomain.
  // Localhost is exempt so dev still works without DNS gymnastics.
  if (isAdminPath && !isAdmin && !isLocal) {
    const target = new URL(
      `https://admin.${ROOT_DOMAIN}${url.pathname}${url.search}`,
    );
    return NextResponse.redirect(target);
  }

  // On the admin host, skip tenant resolution — admin pages don't need
  // an org context. requirePlatformAdmin() gates the actual admin routes.
  if (isAdmin) {
    return await updateSession(request);
  }

  if (!MULTI_TENANT_MODE) {
    return await updateSession(request);
  }

  const { subdomain, isRoot } = parseHost(rawHost);

  if (isRoot || subdomain === null) {
    return await updateSession(request);
  }

  if (!isValidTenantSlug(subdomain)) {
    return NextResponse.redirect(
      new URL(`https://${process.env.ROOT_DOMAIN ?? "cgtsync.ai"}/unknown-tenant`),
    );
  }

  const tenant = await resolveTenantBySlug(subdomain);
  if (!tenant) {
    return NextResponse.redirect(
      new URL(`https://${process.env.ROOT_DOMAIN ?? "cgtsync.ai"}/unknown-tenant`),
    );
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(TENANT_ORG_HEADER, tenant.orgId);
  requestHeaders.set(TENANT_SLUG_HEADER, tenant.slug);

  const requestWithTenant = new NextRequest(request, {
    headers: requestHeaders,
  });

  const response = await updateSession(requestWithTenant);
  response.headers.set(TENANT_ORG_HEADER, tenant.orgId);
  response.headers.set(TENANT_SLUG_HEADER, tenant.slug);
  return response;
}

interface ResolvedTenant {
  orgId: string;
  slug: string;
}

const tenantCache = new Map<string, { value: ResolvedTenant | null; expires: number }>();
const TENANT_CACHE_TTL_MS = 60_000;

async function resolveTenantBySlug(slug: string): Promise<ResolvedTenant | null> {
  const cached = tenantCache.get(slug);
  if (cached && cached.expires > Date.now()) return cached.value;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return null;

  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/organizations?select=id,slug&slug=eq.${encodeURIComponent(slug)}&limit=1`,
      {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
        cache: "no-store",
      },
    );
    if (!res.ok) {
      tenantCache.set(slug, { value: null, expires: Date.now() + TENANT_CACHE_TTL_MS });
      return null;
    }
    const rows = (await res.json()) as Array<{ id: string; slug: string }>;
    if (!rows.length) {
      tenantCache.set(slug, { value: null, expires: Date.now() + TENANT_CACHE_TTL_MS });
      return null;
    }
    const value = { orgId: rows[0].id, slug: rows[0].slug };
    tenantCache.set(slug, { value, expires: Date.now() + TENANT_CACHE_TTL_MS });
    return value;
  } catch {
    return null;
  }
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
