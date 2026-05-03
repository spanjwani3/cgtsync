"use client";

import { useState } from "react";
import Link from "next/link";
import { Logo } from "@/components/brand/Logo";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      // Always show the same generic success state regardless of API
      // outcome — matches the server's anti-enumeration response.
      await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
    } catch {
      // Swallow network errors too — don't leak whether the request succeeded.
    } finally {
      setSubmitted(true);
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <div className="flex flex-col items-center">
        <div className="mb-2">
          <Logo size={56} variant="dark" />
        </div>
        <h1 className="text-2xl font-bold text-white">Check your inbox</h1>
        <p className="mt-4 text-center text-sm text-slate-400">
          If <span className="text-slate-200">{email}</span> is registered,
          we've sent a password reset link.
        </p>
        <p className="mt-2 text-center text-sm text-slate-500">
          The link expires in 1 hour. Be sure to check your spam folder.
        </p>
        <Link
          href="/login"
          className="mt-8 text-sm font-medium text-accent hover:text-accent-hover"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center">
      <div className="mb-2">
        <Logo size={56} variant="dark" />
      </div>
      <h1 className="text-2xl font-bold text-white">Reset your password</h1>
      <p className="mt-2 text-center text-sm text-slate-400">
        Enter the email associated with your account and we'll send you a
        reset link.
      </p>

      <div className="mt-8 w-full">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="you@company.com"
              className="mt-1.5 block w-full rounded-lg border border-slate-600 bg-slate-800/50 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="flex h-11 w-full items-center justify-center rounded-lg bg-accent text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <svg
                  className="h-4 w-4 animate-spin"
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
                Sending...
              </span>
            ) : (
              "Send reset link"
            )}
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-slate-500">
          Remembered it?{" "}
          <Link
            href="/login"
            className="font-medium text-accent hover:text-accent-hover"
          >
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
