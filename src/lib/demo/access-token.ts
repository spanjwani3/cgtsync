/**
 * Signed access tokens for gated demo pages.
 *
 * After a visitor submits a business email we set an httpOnly cookie holding
 * an HMAC-signed token binding the demo slug, the email, and a view-session id
 * to an expiry. On subsequent requests the server verifies the token so the
 * visitor can keep watching (and we can attribute playback heartbeats to the
 * right view) without re-entering their email until it expires.
 *
 * The token is opaque to the client and tamper-evident (HMAC-SHA256). It is
 * NOT encrypted — it carries no secrets, only the email the visitor just typed.
 */

import crypto from "crypto";

/** How long an access grant lasts. Long enough to watch the full video. */
export const ACCESS_TTL_SECONDS = 4 * 60 * 60; // 4 hours

/** Cookie name for a given demo slug. */
export function accessCookieName(slug: string): string {
  return `demo_access_${slug}`;
}

interface AccessPayload {
  slug: string;
  email: string;
  viewId: string;
  /** Expiry as a unix timestamp (seconds). */
  exp: number;
}

function getSecret(): string {
  const secret =
    process.env.DEMO_ACCESS_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) {
    throw new Error(
      "DEMO_ACCESS_SECRET (or SUPABASE_SERVICE_ROLE_KEY) must be set to sign demo access tokens",
    );
  }
  return secret;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function sign(data: string): string {
  return base64url(
    crypto.createHmac("sha256", getSecret()).update(data).digest(),
  );
}

/**
 * Create a signed access token for a (slug, email, viewId) granting access
 * for ACCESS_TTL_SECONDS.
 */
export function signAccess(
  slug: string,
  email: string,
  viewId: string,
): string {
  const payload: AccessPayload = {
    slug,
    email,
    viewId,
    exp: Math.floor(Date.now() / 1000) + ACCESS_TTL_SECONDS,
  };
  const body = base64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

/**
 * Verify a token for the given slug. Returns the payload if the signature is
 * valid, the slug matches, and it hasn't expired; otherwise null.
 */
export function verifyAccess(
  token: string | undefined,
  slug: string,
): AccessPayload | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;

  const expected = sign(body);
  // Constant-time compare; lengths must match first.
  if (
    sig.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  ) {
    return null;
  }

  let payload: AccessPayload;
  try {
    payload = JSON.parse(
      Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(),
    );
  } catch {
    return null;
  }

  if (payload.slug !== slug) return null;
  if (typeof payload.exp !== "number" || payload.exp < Date.now() / 1000) {
    return null;
  }
  return payload;
}
