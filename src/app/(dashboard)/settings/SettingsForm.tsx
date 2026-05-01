"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function SettingsForm({
  email,
  fullName: initialFullName,
}: {
  email: string;
  fullName: string;
}) {
  const supabase = createClient();

  const [fullName, setFullName] = useState(initialFullName);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<
    { kind: "ok" | "error"; text: string } | null
  >(null);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState<
    { kind: "ok" | "error"; text: string } | null
  >(null);

  async function handleProfileSave(e: React.FormEvent) {
    e.preventDefault();
    setProfileSaving(true);
    setProfileMsg(null);
    const { error } = await supabase.auth.updateUser({
      data: { full_name: fullName.trim() },
    });
    if (error) {
      setProfileMsg({ kind: "error", text: error.message });
    } else {
      setProfileMsg({ kind: "ok", text: "Saved." });
    }
    setProfileSaving(false);
  }

  async function handlePasswordSave(e: React.FormEvent) {
    e.preventDefault();
    setPwMsg(null);

    if (newPassword.length < 8) {
      setPwMsg({
        kind: "error",
        text: "Password must be at least 8 characters.",
      });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwMsg({ kind: "error", text: "Passwords don't match." });
      return;
    }

    setPwSaving(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      setPwMsg({ kind: "error", text: error.message });
    } else {
      setPwMsg({
        kind: "ok",
        text: "Password updated. Use the new password next time you sign in.",
      });
      setNewPassword("");
      setConfirmPassword("");
    }
    setPwSaving(false);
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-zinc-900">Settings</h1>
      <p className="mt-1 text-sm text-muted">
        Manage your account information and password.
      </p>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Account
        </h2>
        <form onSubmit={handleProfileSave} className="mt-3 card space-y-4">
          <Field label="Email" hint="Cannot be changed here.">
            <input
              type="email"
              value={email}
              disabled
              className="input opacity-60"
            />
          </Field>
          <Field label="Display name">
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="input"
              placeholder="Your name"
            />
          </Field>
          {profileMsg && <Message msg={profileMsg} />}
          <div>
            <button
              type="submit"
              disabled={profileSaving}
              className="btn-primary disabled:opacity-50"
            >
              {profileSaving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Change password
        </h2>
        <form onSubmit={handlePasswordSave} className="mt-3 card space-y-4">
          <Field label="New password" hint="At least 8 characters.">
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              className="input"
            />
          </Field>
          <Field label="Confirm new password">
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              className="input"
            />
          </Field>
          {pwMsg && <Message msg={pwMsg} />}
          <div>
            <button
              type="submit"
              disabled={pwSaving}
              className="btn-primary disabled:opacity-50"
            >
              {pwSaving ? "Updating…" : "Update password"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-zinc-700">{label}</span>
      {hint && <span className="mt-0.5 block text-xs text-muted">{hint}</span>}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

function Message({ msg }: { msg: { kind: "ok" | "error"; text: string } }) {
  if (msg.kind === "ok") {
    return (
      <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700">
        {msg.text}
      </div>
    );
  }
  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
      {msg.text}
    </div>
  );
}
