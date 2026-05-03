"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [processingMagicLink, setProcessingMagicLink] = useState(false);

  // Magic links generated via supabase.auth.admin.generateLink use the
  // implicit flow — tokens arrive in the URL fragment after Supabase
  // redirects to /callback. /callback can't see fragments (server-side),
  // so it bounces here with ?error=auth_failed and the fragment trailing.
  // Detect the fragment, install the session, and continue to /programs.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash;
    if (!hash || !hash.includes("access_token=")) return;

    const params = new URLSearchParams(hash.slice(1));
    const access_token = params.get("access_token");
    const refresh_token = params.get("refresh_token");
    if (!access_token || !refresh_token) return;

    setProcessingMagicLink(true);
    (async () => {
      const supabase = createClient();
      const { error: setErr } = await supabase.auth.setSession({
        access_token,
        refresh_token,
      });
      if (setErr) {
        setError(`Magic link sign-in failed: ${setErr.message}`);
        setProcessingMagicLink(false);
        // Strip the fragment so refresh doesn't loop.
        window.history.replaceState({}, "", "/login");
        return;
      }
      // Strip fragment + error query and navigate.
      router.replace("/programs");
      router.refresh();
    })();
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      router.push("/dashboard");
      router.refresh();
    }
  }

  if (processingMagicLink) {
    return (
      <div className="flex flex-col items-center">
        <div className="mb-2">
          <svg
            className="h-14 w-14 text-teal-400"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-white">CGT-Sync</h1>
        <p className="mt-6 text-sm text-slate-300">Signing you in…</p>
        <svg
          className="mt-3 h-5 w-5 animate-spin text-teal-400"
          viewBox="0 0 24 24"
          fill="none"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center">
      {/* Shield logo */}
      <div className="mb-2">
        <svg className="h-14 w-14 text-teal-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
      </div>
      <h1 className="text-2xl font-bold text-white">CGT-Sync</h1>
      <p className="mt-2 text-center text-sm text-slate-400">
        The governed truth layer for<br />cell &amp; gene therapy programs.
      </p>

      <div className="mt-8 w-full">
        {error && (
          <div className="mb-4 rounded-lg bg-red-500/10 p-3 text-sm text-red-300">{error}</div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300">Email</label>
            <input
              type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
              placeholder="you@company.com"
              className="mt-1.5 block w-full rounded-lg border border-slate-600 bg-slate-800/50 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300">Password</label>
            <input
              type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
              placeholder="Enter your password"
              className="mt-1.5 block w-full rounded-lg border border-slate-600 bg-slate-800/50 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
            />
          </div>
          <button
            type="submit" disabled={loading}
            className="flex h-11 w-full items-center justify-center rounded-lg bg-teal-500 text-sm font-semibold text-white transition-colors hover:bg-teal-400 disabled:opacity-50"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                Signing in...
              </span>
            ) : "Sign In"}
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-slate-500">
          No account?{" "}
          <Link href="/signup" className="font-medium text-teal-400 hover:text-teal-300">Sign up</Link>
        </p>
      </div>
    </div>
  );
}
