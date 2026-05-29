import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getClientIp } from "@/lib/server/event-log";
import { sendEmail } from "@/lib/server/email";
import { getDemo } from "@/lib/demo/catalog";
import { isBusinessEmail } from "@/lib/demo/email-domains";
import {
  signAccess,
  accessCookieName,
  ACCESS_TTL_SECONDS,
} from "@/lib/demo/access-token";
import { generateRequestId, structuredError } from "@/lib/config";

/** Where new-lead notifications are sent. */
const NOTIFY_EMAIL = "samir@cgtsync.ai";

/** Max submissions per IP per hour (anti-spam). */
const RATE_LIMIT_PER_HOUR = 20;

const BodySchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  name: z.string().trim().max(120).optional(),
  company: z.string().trim().max(160).optional(),
});

/**
 * POST /api/demo/[slug]/access
 *
 * Public (no auth). Captures a prospect's business email to unlock a gated
 * demo video. Stores the lead + a new view session, notifies the team on a
 * new lead, and sets a signed access cookie so the page reveals the player.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const requestId = generateRequestId();
  try {
    const { slug } = await params;
    const demo = getDemo(slug);
    if (!demo) {
      return NextResponse.json({ error: "Demo not found" }, { status: 404 });
    }

    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "Invalid request";
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    const { email, name, company } = parsed.data;

    if (!isBusinessEmail(email)) {
      return NextResponse.json(
        {
          error:
            "Please use your business email address (personal email providers aren't accepted).",
        },
        { status: 422 },
      );
    }

    const ipAddress = getClientIp(req.headers);
    const userAgent = req.headers.get("user-agent") ?? null;

    // Anti-spam: cap submissions per IP in the last hour.
    if (ipAddress && ipAddress !== "unknown") {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const recent = await prisma.demoLead.count({
        where: { ipAddress, createdAt: { gte: oneHourAgo } },
      });
      if (recent >= RATE_LIMIT_PER_HOUR) {
        return NextResponse.json(
          { error: "Too many requests. Please try again later." },
          { status: 429 },
        );
      }
    }

    // Upsert the lead (one per demo+email) and record this view session.
    const existing = await prisma.demoLead.findUnique({
      where: { demoSlug_email: { demoSlug: slug, email } },
      select: { id: true },
    });
    const isNewLead = !existing;

    const lead = await prisma.demoLead.upsert({
      where: { demoSlug_email: { demoSlug: slug, email } },
      create: { email, name, company, demoSlug: slug, ipAddress, userAgent },
      update: { name, company, ipAddress, userAgent },
      select: { id: true },
    });

    const view = await prisma.demoView.create({
      data: { leadId: lead.id, demoSlug: slug, email },
      select: { id: true },
    });

    // Notify the team on a genuinely new lead (avoid noise on repeat views).
    if (isNewLead) {
      try {
        await sendEmail({
          to: NOTIFY_EMAIL,
          subject: `New CDMO demo view — ${email}`,
          html: notificationHtml({ email, name, company, demo: demo.title }),
          replyTo: email,
        });
      } catch (notifyError) {
        // A notification failure must never block the prospect.
        console.error(
          structuredError({
            requestId,
            route: "/api/demo/[slug]/access notify",
            error: notifyError,
          }),
        );
      }
    }

    // Set the signed access cookie so the page reveals the player.
    const cookieStore = await cookies();
    cookieStore.set(accessCookieName(slug), signAccess(slug, email, view.id), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      // Scope to "/" so the cookie reaches BOTH the page (/demo/<slug>) and the
      // heartbeat API (/api/demo/<slug>/heartbeat). A narrower /demo/<slug> path
      // would never be sent to /api/... requests, silently breaking watch-time
      // tracking. The token is bound to this slug, so a site-wide path is safe.
      path: "/",
      maxAge: ACCESS_TTL_SECONDS,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(
      structuredError({ requestId, route: "/api/demo/[slug]/access POST", error: e }),
    );
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 },
    );
  }
}

function notificationHtml(opts: {
  email: string;
  name?: string;
  company?: string;
  demo: string;
}): string {
  const rows = [
    ["Email", opts.email],
    ["Name", opts.name || "—"],
    ["Company", opts.company || "—"],
    ["Demo", opts.demo],
    ["When", new Date().toUTCString()],
  ]
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#64748b;">${k}</td><td style="padding:4px 0;color:#0f172a;font-weight:500;">${escapeHtml(
          v,
        )}</td></tr>`,
    )
    .join("");
  return `
    <div style="font-family:Inter,Arial,sans-serif;font-size:14px;color:#0f172a;">
      <p>A new prospect just unlocked the demo video.</p>
      <table style="border-collapse:collapse;margin-top:8px;">${rows}</table>
    </div>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
