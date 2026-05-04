"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type Role = "ADMIN" | "OPERATOR" | "READ_ONLY";

export interface MemberRow {
  userId: string;
  email: string;
  fullName: string | null;
  role: Role;
  joinedAt: string;
  lastActivityAt: string | null;
  isSelf: boolean;
}

interface InviteResult {
  status: "CREATED" | "ALREADY_MEMBER";
  userId: string;
  email: string;
  role: Role;
  password: string | null;
  magicLink: string | null;
  passwordReset: boolean;
  welcomeEmail: { sent: boolean; resendId: string | null; error: string | null };
  error: string | null;
}

interface ResendResult {
  userId: string;
  email: string;
  password: string;
  magicLink: string | null;
  welcomeEmail: { sent: boolean; resendId: string | null; error: string | null };
  error: string | null;
}

function relTime(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1mo ago" : `${months}mo ago`;
}

function rolePill(role: Role): string {
  switch (role) {
    case "ADMIN":
      return "bg-blue-100 text-blue-700";
    case "OPERATOR":
      return "bg-zinc-100 text-zinc-700";
    case "READ_ONLY":
      return "bg-zinc-100 text-zinc-500";
  }
}

export default function MembersClient({
  initialMembers,
}: {
  initialMembers: MemberRow[];
}) {
  const router = useRouter();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [credentialsModal, setCredentialsModal] = useState<
    | { kind: "invite"; result: InviteResult }
    | { kind: "resend"; result: ResendResult }
    | null
  >(null);
  const [resendingUserId, setResendingUserId] = useState<string | null>(null);
  const [confirmResend, setConfirmResend] = useState<MemberRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleResend(member: MemberRow) {
    setError(null);
    setResendingUserId(member.userId);
    try {
      const res = await fetch(
        `/api/org/members/${encodeURIComponent(member.userId)}/resend-invite`,
        { method: "POST" },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      setCredentialsModal({ kind: "resend", result: body.result as ResendResult });
      setConfirmResend(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Resend failed");
    } finally {
      setResendingUserId(null);
    }
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-muted">
          {initialMembers.length} member{initialMembers.length === 1 ? "" : "s"}
        </p>
        <button
          type="button"
          onClick={() => setInviteOpen(true)}
          className="btn-primary"
        >
          + Invite member
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-[11px] font-medium uppercase tracking-wide text-muted">
              <th className="px-5 py-3">User</th>
              <th className="px-5 py-3">Role</th>
              <th className="px-5 py-3">Joined</th>
              <th className="px-5 py-3">Last activity</th>
              <th className="px-5 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {initialMembers.map((m) => (
              <tr key={m.userId} className="border-b border-zinc-100 last:border-b-0">
                <td className="px-5 py-3">
                  <p className="font-medium text-zinc-900">
                    {m.fullName || m.email}
                    {m.isSelf && (
                      <span className="ml-2 text-[10px] font-normal text-muted">
                        (you)
                      </span>
                    )}
                  </p>
                  {m.fullName && <p className="text-[11px] text-muted">{m.email}</p>}
                </td>
                <td className="px-5 py-3">
                  <span
                    className={`inline-block rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase ${rolePill(m.role)}`}
                  >
                    {m.role}
                  </span>
                </td>
                <td className="px-5 py-3 text-xs text-zinc-700">
                  {new Date(m.joinedAt).toLocaleDateString()}
                </td>
                <td className="px-5 py-3 text-xs text-zinc-700">
                  {relTime(m.lastActivityAt)}
                </td>
                <td className="px-5 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => setConfirmResend(m)}
                    disabled={resendingUserId === m.userId}
                    className="rounded border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                  >
                    Resend invite
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[11px] text-muted">
        &ldquo;Resend invite&rdquo; generates a fresh temporary password and magic
        link, then re-emails the welcome message. Use it when the original email
        was lost or the user can&apos;t sign in. The user&apos;s previous password
        will stop working.
      </p>

      {inviteOpen && (
        <InviteMemberModal
          onClose={() => setInviteOpen(false)}
          onSuccess={(result) => {
            setInviteOpen(false);
            setCredentialsModal({ kind: "invite", result });
            router.refresh();
          }}
        />
      )}

      {confirmResend && (
        <ConfirmResendModal
          member={confirmResend}
          loading={resendingUserId === confirmResend.userId}
          onClose={() => setConfirmResend(null)}
          onConfirm={() => handleResend(confirmResend)}
        />
      )}

      {credentialsModal && (
        <CredentialsModal
          kind={credentialsModal.kind}
          result={credentialsModal.result}
          onClose={() => setCredentialsModal(null)}
        />
      )}
    </>
  );
}

function InviteMemberModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: (result: InviteResult) => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("OPERATOR");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/org/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), role }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(body.error ?? `HTTP ${res.status}`);
        return;
      }
      onSuccess(body.result as InviteResult);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Invite failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl"
      >
        <h2 className="text-lg font-semibold text-zinc-900">Invite member</h2>
        <p className="mt-1 text-xs text-muted">
          They&apos;ll receive an email with a magic link and temporary password.
        </p>

        <label className="mt-4 block text-xs font-medium text-zinc-700">
          Email
        </label>
        <input
          autoFocus
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="teammate@example.com"
          className="input mt-1"
          disabled={submitting}
        />

        <label className="mt-4 block text-xs font-medium text-zinc-700">
          Role
        </label>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
          className="input mt-1"
          disabled={submitting}
        >
          <option value="ADMIN">Admin — full access, can invite others</option>
          <option value="OPERATOR">Operator — can edit programs</option>
          <option value="READ_ONLY">Read-only — view only</option>
        </select>

        {err && (
          <div className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">
            {err}
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="btn-secondary disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !email.trim()}
            className="btn-primary disabled:opacity-50"
          >
            {submitting ? "Sending…" : "Send invite"}
          </button>
        </div>
      </form>
    </div>
  );
}

function ConfirmResendModal({
  member,
  loading,
  onClose,
  onConfirm,
}: {
  member: MemberRow;
  loading: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
        <h2 className="text-lg font-semibold text-zinc-900">
          Resend invite to {member.email}?
        </h2>
        <p className="mt-2 text-sm text-zinc-700">
          This will generate a new temporary password and magic link, and resend
          the welcome email. Their existing password will stop working.
        </p>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="btn-secondary disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="btn-primary disabled:opacity-50"
          >
            {loading ? "Sending…" : "Resend invite"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CredentialsModal({
  kind,
  result,
  onClose,
}: {
  kind: "invite" | "resend";
  result: InviteResult | ResendResult;
  onClose: () => void;
}) {
  const isInvite = kind === "invite";
  const inviteResult = isInvite ? (result as InviteResult) : null;
  const alreadyMember = inviteResult?.status === "ALREADY_MEMBER";

  if (alreadyMember) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
          <h2 className="text-lg font-semibold text-zinc-900">Already a member</h2>
          <p className="mt-2 text-sm text-zinc-700">
            <span className="font-mono">{result.email}</span> is already a member
            of this workspace with role{" "}
            <span className="font-mono">{inviteResult?.role}</span>. To re-issue
            credentials, use &ldquo;Resend invite&rdquo; on their row.
          </p>
          <div className="mt-4 flex justify-end">
            <button type="button" onClick={onClose} className="btn-primary">
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  const password = result.password;
  const magicLink = result.magicLink;
  const emailSent = result.welcomeEmail.sent;
  const emailError = result.welcomeEmail.error;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl">
        <h2 className="text-lg font-semibold text-zinc-900">
          {isInvite ? "Member invited" : "Invite resent"}
        </h2>
        <p className="mt-1 text-sm text-zinc-700">
          {emailSent
            ? `Welcome email sent to ${result.email}.`
            : `Welcome email did NOT send. Hand-deliver the credentials below.`}
        </p>
        {!emailSent && emailError && (
          <p className="mt-1 text-xs text-red-700">Email error: {emailError}</p>
        )}

        <div className="mt-4 space-y-2 rounded border border-zinc-200 bg-zinc-50 p-3 text-xs">
          <div>
            <span className="text-muted">Email: </span>
            <span className="font-mono text-zinc-900">{result.email}</span>
          </div>
          {password && (
            <div>
              <span className="text-muted">Temporary password: </span>
              <span className="select-all font-mono font-semibold text-zinc-900">
                {password}
              </span>
            </div>
          )}
          {magicLink && (
            <div className="break-all">
              <span className="text-muted">Magic link: </span>
              <a
                href={magicLink}
                target="_blank"
                rel="noreferrer"
                className="select-all font-mono text-accent-text underline"
              >
                {magicLink}
              </a>
            </div>
          )}
        </div>

        <p className="mt-3 text-[11px] text-muted">
          The temporary password is shown once for hand-delivery. It is also
          included in the welcome email if delivery succeeded. The user should
          change their password from Settings after signing in.
        </p>

        <div className="mt-4 flex justify-end">
          <button type="button" onClick={onClose} className="btn-primary">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
