"use client";

import { useState } from "react";
import ContactSelector from "@/components/ui/ContactSelector";

type Step = "idle" | "creating" | "releasing" | "sending" | "done" | "error";

interface QuickLogResult {
  changeId: string;
  sequenceNum: number;
  title: string;
  status: string;
  emailSent: boolean;
  autoLogged: boolean;
}

export default function QuickLogModal({
  programId,
  changeThreshold,
  onSuccess,
  onClose,
}: {
  programId: string;
  changeThreshold?: number | null;
  onSuccess: (result: QuickLogResult) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [estimatedImpact, setEstimatedImpact] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [message, setMessage] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<QuickLogResult | null>(null);

  const impactNum = estimatedImpact ? parseFloat(estimatedImpact) : null;
  const belowThreshold =
    changeThreshold != null && impactNum != null && impactNum < changeThreshold;

  async function handleSubmit() {
    if (!title.trim()) return;
    if (!belowThreshold && !clientEmail.trim()) return;

    setError("");

    try {
      // Step 1: Create change in DRAFT
      setStep("creating");
      const createRes = await fetch("/api/changes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          programId,
          title: title.trim(),
          description: message.trim() || null,
          estimatedImpact: impactNum,
        }),
      });
      if (!createRes.ok) {
        const d = await createRes.json().catch(() => ({}));
        throw new Error(d.error ?? "Failed to create change");
      }
      const change = await createRes.json();

      // Step 2: Release
      setStep("releasing");
      const releaseRes = await fetch(`/api/changes/${change.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "RELEASED" }),
      });
      if (!releaseRes.ok) {
        const d = await releaseRes.json().catch(() => ({}));
        throw new Error(d.error ?? "Failed to release change");
      }
      const released = await releaseRes.json();
      const autoLogged = released.status === "LOGGED";

      // Step 3: Send confirmation email (only if RELEASED, not auto-LOGGED)
      let emailSent = false;
      if (!autoLogged && clientEmail.trim()) {
        setStep("sending");
        const sendRes = await fetch("/api/gateway/confirmation/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            programId,
            entityType: "CHANGE",
            entityId: change.id,
            recipientEmail: clientEmail.trim(),
            message: message.trim() || undefined,
          }),
        });
        if (!sendRes.ok) {
          const d = await sendRes.json().catch(() => ({}));
          throw new Error(d.error ?? "Change created but email failed to send");
        }
        emailSent = true;
      }

      const finalResult: QuickLogResult = {
        changeId: change.id,
        sequenceNum: change.sequenceNum,
        title: title.trim(),
        status: released.status,
        emailSent,
        autoLogged,
      };
      setResult(finalResult);
      setStep("done");
      onSuccess(finalResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setStep("error");
    }
  }

  const stepLabels: Record<string, string> = {
    creating: "Creating change...",
    releasing: "Releasing...",
    sending: "Sending confirmation...",
  };

  const isSubmitting = step === "creating" || step === "releasing" || step === "sending";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        {step === "done" && result ? (
          /* ──── Success state ──── */
          <div className="text-center py-4">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
              <svg className="h-6 w-6 text-green-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h2 className="mt-3 text-lg font-semibold text-zinc-900">
              Change #{result.sequenceNum} Logged
            </h2>
            <p className="mt-2 text-sm text-zinc-600">
              {result.autoLogged
                ? "Below threshold \u2014 auto-logged without confirmation."
                : result.emailSent
                  ? `Confirmation email sent to ${clientEmail}.`
                  : "Released and awaiting confirmation."
              }
            </p>
            <button onClick={onClose} className="btn-primary mt-5 w-full">
              Done
            </button>
          </div>
        ) : (
          /* ──── Form state ──── */
          <>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-zinc-900">Quick Log Change</h2>
                <p className="mt-0.5 text-xs text-zinc-500">Log a scope change and send for confirmation in one step.</p>
              </div>
              <button onClick={onClose} className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>

            <div className="mt-5 space-y-4">
              {/* Title */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-600">What changed? *</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="E.g., Vendor requested additional batch testing"
                  className="input"
                  disabled={isSubmitting}
                  autoFocus
                />
              </div>

              {/* Cost Impact */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-600">Cost Impact ($)</label>
                <input
                  type="number"
                  value={estimatedImpact}
                  onChange={(e) => setEstimatedImpact(e.target.value)}
                  placeholder="0"
                  className="input"
                  disabled={isSubmitting}
                />
                {belowThreshold && (
                  <p className="mt-1 text-[11px] text-amber-600">
                    Below ${changeThreshold?.toLocaleString()} threshold \u2014 will auto-log without confirmation
                  </p>
                )}
              </div>

              {/* Client Email */}
              {!belowThreshold && (
                <ContactSelector
                  programId={programId}
                  value={clientEmail}
                  onChange={(email) => setClientEmail(email)}
                  label="Client email *"
                  placeholder="counterparty@cdmo.com"
                  contactType="CLIENT"
                />
              )}

              {/* Message */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-600">Note to client (optional)</label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Brief context for the confirmation request..."
                  className="input resize-none"
                  rows={2}
                  disabled={isSubmitting}
                />
              </div>

              {/* Error */}
              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                  {error}
                </div>
              )}

              {/* Submit */}
              <button
                onClick={handleSubmit}
                disabled={isSubmitting || !title.trim() || (!belowThreshold && !clientEmail.trim())}
                className="btn-primary h-11 w-full disabled:opacity-50"
              >
                {isSubmitting ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                    {stepLabels[step] ?? "Processing..."}
                  </span>
                ) : belowThreshold ? (
                  "Log Change (Auto)"
                ) : (
                  "Log & Send Confirmation"
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
