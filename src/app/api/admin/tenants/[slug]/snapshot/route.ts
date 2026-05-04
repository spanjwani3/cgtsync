import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/server/auth";
import { generateRequestId, structuredError } from "@/lib/config";
import {
  findOrgBySlug,
  getTenantSnapshot,
} from "@/lib/server/admin/tenantSnapshot";

/**
 * GET /api/admin/tenants/[slug]/snapshot
 *
 * Platform-admin tenant snapshot. Cross-org read; bypasses requireOrgAccess
 * intentionally and is gated solely by requirePlatformAdmin().
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const requestId = generateRequestId();
  try {
    await requirePlatformAdmin();
    const { slug } = await params;

    const org = await findOrgBySlug(slug);
    if (!org) {
      return NextResponse.json(
        { requestId, error: "Tenant not found" },
        { status: 404 },
      );
    }

    const snapshot = await getTenantSnapshot(org.id);
    if (!snapshot) {
      return NextResponse.json(
        { requestId, error: "Tenant not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ requestId, snapshot });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED")
      return NextResponse.json(
        { requestId, error: "Unauthorized" },
        { status: 401 },
      );
    if (msg === "FORBIDDEN")
      return NextResponse.json(
        { requestId, error: "Platform admin access required" },
        { status: 403 },
      );
    console.error(
      structuredError({
        requestId,
        route: "/api/admin/tenants/[slug]/snapshot GET",
        error: e,
      }),
    );
    return NextResponse.json(
      { requestId, error: "Internal server error" },
      { status: 500 },
    );
  }
}
