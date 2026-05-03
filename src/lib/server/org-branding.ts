import { prisma } from "@/lib/prisma";
import { DEFAULT_ACCENT, isValidHex } from "@/lib/brand/shade";

export interface OrgBranding {
  accentColor: string;
  logoUrl: string | null;
}

/**
 * Loads tenant branding for outbound surfaces (emails, PDFs).
 * Falls back to CGT Sync defaults when the org hasn't configured anything
 * or has a malformed accent value.
 */
export async function getOrgBranding(orgId: string): Promise<OrgBranding> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { accentColor: true, logoUrl: true },
  });
  const accent =
    org?.accentColor && isValidHex(org.accentColor)
      ? org.accentColor
      : DEFAULT_ACCENT;
  return {
    accentColor: accent,
    logoUrl: org?.logoUrl ?? null,
  };
}
