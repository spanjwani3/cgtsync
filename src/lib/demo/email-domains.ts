/**
 * Free / personal email-provider domains. Demo access requires a business
 * email, so submissions from these domains are rejected. This is a heuristic
 * (a complete list is impossible) covering the common consumer providers.
 */
export const FREE_EMAIL_DOMAINS = new Set<string>([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "ymail.com",
  "rocketmail.com",
  "outlook.com",
  "hotmail.com",
  "hotmail.co.uk",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "gmx.com",
  "gmx.net",
  "mail.com",
  "zoho.com",
  "yandex.com",
  "yandex.ru",
  "qq.com",
  "163.com",
  "126.com",
  "fastmail.com",
  "hey.com",
  "tutanota.com",
]);

/**
 * Returns true if the email looks like a valid business address: a
 * syntactically valid email whose domain is not in the free-provider list.
 * Domain comparison is case-insensitive.
 */
export function isBusinessEmail(email: string): boolean {
  const trimmed = email.trim().toLowerCase();
  // Minimal shape check; the API layer also validates with zod's .email().
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return false;
  const domain = trimmed.split("@")[1];
  if (!domain) return false;
  return !FREE_EMAIL_DOMAINS.has(domain);
}
