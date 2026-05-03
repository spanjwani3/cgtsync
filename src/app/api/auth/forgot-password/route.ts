import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";
import { sendEmail, logEmailSend } from "@/lib/server/email";
import { renderPasswordResetEmail } from "@/lib/server/email-templates";
import { EmailTemplateType } from "@/generated/prisma/client";
import { generateRequestId } from "@/lib/config";

/**
 * Self-service password recovery. Public POST (no auth).
 *
 * Always returns the same generic 200 payload regardless of whether the
 * email matches a user, an org member, or fails Supabase generation —
 * defends against account enumeration. Failures are logged server-side
 * so we can debug without leaking via the response.
 *
 * Flow: look up user → generate Supabase recovery link via Admin API →
 * send branded email via Resend → log to EmailLog. Email contains a
 * link to {tenantHost}/reset-password which installs the recovery
 * session client-side (mirrors PR #15 magic-link fragment handler).
 */

const GENERIC_RESPONSE = {
  ok: true,
  message: "If that email is registered, you'll receive a reset link shortly.",
};

export async function POST(req: NextRequest) {
  const requestId = generateRequestId();

  let email = "";
  try {
    const body = await req.json();
    email =
      typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  } catch {
    // Malformed body — still return generic success.
    return NextResponse.json({ requestId, ...GENERIC_RESPONSE });
  }

  if (!email || !email.includes("@")) {
    return NextResponse.json({ requestId, ...GENERIC_RESPONSE });
  }

  // Derive request host for redirect URL. Use forwarded headers when
  // behind a proxy (Vercel sets x-forwarded-host / x-forwarded-proto).
  const forwardedHost = req.headers.get("x-forwarded-host");
  const hostHeader = req.headers.get("host") ?? "";
  const host = (forwardedHost ?? hostHeader).toLowerCase();
  const isLocal = host.startsWith("localhost") || host.endsWith(".localhost");
  const proto =
    req.headers.get("x-forwarded-proto") ?? (isLocal ? "http" : "https");
  const loginUrl = `${proto}://${host}/login`;
  const redirectTo = `${proto}://${host}/reset-password`;

  try {
    // Short-circuit: if no app User row exists for this email, skip the
    // Supabase admin lookup (which is paginated and slower).
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      console.warn("[forgot-password]", { requestId, email, reason: "no_app_user" });
      return NextResponse.json({ requestId, ...GENERIC_RESPONSE });
    }

    const member = await prisma.orgMember.findFirst({
      where: { userId: user.id },
      include: { org: true },
    });
    if (!member) {
      console.warn("[forgot-password]", {
        requestId,
        email,
        reason: "no_org_membership",
      });
      return NextResponse.json({ requestId, ...GENERIC_RESPONSE });
    }

    // For EmailLog: pick the org's first program (created earliest).
    // EmailLog.programId is non-nullable, so we skip logging if no program
    // exists — practically every onboarded tenant has at least one.
    const program = await prisma.program.findFirst({
      where: { orgId: member.orgId },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      console.error("[forgot-password]", {
        requestId,
        email,
        reason: "missing_supabase_env",
      });
      return NextResponse.json({ requestId, ...GENERIC_RESPONSE });
    }

    const supabase = createSupabaseClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const link = await supabase.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo },
    });

    const properties = link.data?.properties as
      | { action_link?: string }
      | undefined;
    const actionLink = properties?.action_link;
    if (!actionLink || link.error) {
      console.warn("[forgot-password]", {
        requestId,
        email,
        reason: "generate_link_failed",
        error: link.error?.message,
      });
      return NextResponse.json({ requestId, ...GENERIC_RESPONSE });
    }

    const subject = `Reset your CGT Sync password`;
    const html = renderPasswordResetEmail({
      recipientEmail: email,
      resetLink: actionLink,
      loginUrl,
      orgName: member.org.name,
    });

    const sendResult = await sendEmail({ to: email, subject, html });
    if (!sendResult.id) {
      console.warn("[forgot-password]", {
        requestId,
        email,
        reason: "send_failed",
        error: sendResult.error,
      });
      return NextResponse.json({ requestId, ...GENERIC_RESPONSE });
    }

    if (program) {
      try {
        await logEmailSend({
          orgId: member.orgId,
          programId: program.id,
          senderUserId: user.id,
          recipientEmail: email,
          subject,
          templateType: EmailTemplateType.PASSWORD_RESET,
          resendId: sendResult.id,
          metadata: {
            tenantSlug: member.org.slug,
            requestHost: host,
            selfServe: true,
          },
        });
      } catch (logErr) {
        console.warn(
          "[forgot-password] logEmailSend failed; email itself was sent",
          { requestId, email, error: logErr },
        );
      }
    }

    return NextResponse.json({ requestId, ...GENERIC_RESPONSE });
  } catch (e) {
    // Top-level catch: any unexpected failure still returns generic 200
    // so the response shape is identical regardless of branch.
    console.error("[forgot-password]", {
      requestId,
      email,
      reason: "unexpected",
      error: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json({ requestId, ...GENERIC_RESPONSE });
  }
}
