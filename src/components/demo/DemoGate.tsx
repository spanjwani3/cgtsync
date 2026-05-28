"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/brand/Logo";
import type { Demo } from "@/lib/demo/catalog";

/**
 * Branded email-capture gate for a demo video. On a valid business email it
 * unlocks access (server sets a signed cookie) and refreshes the page, which
 * then renders the embedded player.
 */
export function DemoGate({ slug, demo }: { slug: string; demo: Demo }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/demo/${slug}/access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          name: name || undefined,
          company: company || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Something went wrong. Please try again.");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex w-full flex-col items-center">
      <Logo size={56} variant="dark" />
      <h1 className="mt-6 text-center text-2xl font-bold tracking-tight text-white">
        {demo.title}
      </h1>
      <p className="mt-2 max-w-sm text-center text-sm text-slate-400">
        {demo.subtitle}
      </p>

      <form onSubmit={handleSubmit} className="mt-8 w-full space-y-3">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-300">
            Business email <span className="text-accent">*</span>
          </label>
          <input
            type="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            className="block w-full rounded-lg border border-slate-600 bg-slate-800/50 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Optional"
              className="block w-full rounded-lg border border-slate-600 bg-slate-800/50 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">
              Company
            </label>
            <input
              type="text"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Optional"
              className="block w-full rounded-lg border border-slate-600 bg-slate-800/50 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
        </div>

        {error && (
          <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="flex h-11 w-full items-center justify-center rounded-lg bg-accent text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
        >
          {submitting ? "Unlocking…" : "Watch the demo"}
        </button>
      </form>

      <p className="mt-4 max-w-sm text-center text-xs text-slate-500">
        We&apos;ll only use your email to follow up about CGT Sync.
      </p>
    </div>
  );
}
