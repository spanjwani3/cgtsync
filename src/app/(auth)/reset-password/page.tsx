"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type Status = "installing" | "ready" | "saving" | "done" | "error";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("installing");
  const [errorMsg, setErrorMsg] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  // Recovery links from supabase.auth.admin.generateLink({ type: 'recovery' })
  // use the implicit flow — tokens land in the URL fragment. Mirror the PR #15
  // /login fragment handler: parse fragment → setSession → strip fragment.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash;
    if (!hash || !hash.includes("access_token=")) {
      setStatus("error");
      setErrorMsg("This reset link is invalid or has expired.");
      return;
    }
    const params = new URLSearchParams(hash.slice(1));
    const access_token = params.get("access_token");
    const refresh_token = params.get("refresh_token");
    if (!access_token || !refresh_token) {
      setStatus("error");
      setErrorMsg("This reset link is invalid.");
      return;
    }
    (async () => {
      const supabase = createClient();
      const { error } = await supabase.auth.setSession({
        access_token,
        refresh_token,
      });
      window.history.replaceState({}, "", "/reset-password");
      if (error) {
        setStatus("error");
        setErrorMsg(`Reset link error: ${error.message}`);
        return;
      }
      setStatus("ready");
    })();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword.length < 8) {
      setErrorMsg("Password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirm) {
      setErrorMsg("Passwords don't match.");
      return;
    }
    setErrorMsg("");
    setStatus("saving");
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      setErrorMsg(error.message);
      setStatus("ready");
      return;
    }
    setStatus("done");
    router.replace("/programs");
    router.refresh();
  }

  if (status === "installing") {
    return (
      <div className="flex flex-col items-center">
        <Shield />
        <h1 className="text-2xl font-bold text-white">CGT-Sync</h1>
        <p className="mt-6 text-sm text-slate-300">Verifying reset link…</p>
        <Spinner />
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex flex-col items-center">
        <Shield />
        <h1 className="text-2xl font-bold text-white">Link expired</h1>
        <p className="mt-4 text-center text-sm text-slate-400">{errorMsg}</p>
        <Link
          href="/forgot-password"
          className="mt-8 rounded-lg bg-teal-500 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-400"
        >
          Request a new reset link
        </Link>
        <Link
          href="/login"
          className="mt-4 text-sm font-medium text-slate-400 hover:text-slate-300"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  if (status === "done") {
    return (
      <div className="flex flex-col items-center">
        <Shield />
        <h1 className="text-2xl font-bold text-white">Password updated</h1>
        <p className="mt-4 text-center text-sm text-slate-400">
          Redirecting…
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center">
      <Shield />
      <h1 className="text-2xl font-bold text-white">Set new password</h1>
      <p className="mt-2 text-center text-sm text-slate-400">
        Choose a new password for your CGT-Sync account.
      </p>

      <div className="mt-8 w-full">
        {errorMsg && (
          <div className="mb-4 rounded-lg bg-red-500/10 p-3 text-sm text-red-300">
            {errorMsg}
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300">
              New password
            </label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
              placeholder="At least 8 characters"
              className="mt-1.5 block w-full rounded-lg border border-slate-600 bg-slate-800/50 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300">
              Confirm new password
            </label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              minLength={8}
              placeholder="Re-enter password"
              className="mt-1.5 block w-full rounded-lg border border-slate-600 bg-slate-800/50 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
            />
          </div>
          <button
            type="submit"
            disabled={status === "saving"}
            className="flex h-11 w-full items-center justify-center rounded-lg bg-teal-500 text-sm font-semibold text-white transition-colors hover:bg-teal-400 disabled:opacity-50"
          >
            {status === "saving" ? (
              <span className="flex items-center gap-2">
                <Spinner small />
                Updating…
              </span>
            ) : (
              "Update password"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

function Shield() {
  return (
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
  );
}

function Spinner({ small }: { small?: boolean }) {
  return (
    <svg
      className={`${small ? "h-4 w-4" : "mt-3 h-5 w-5"} animate-spin text-teal-400`}
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
  );
}
