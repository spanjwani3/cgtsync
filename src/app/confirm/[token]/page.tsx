"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";

interface LinkData {
  id: string;
  scope: string;
  expiresAt: string;
  singleUse: boolean;
  confirmedAt: string | null;
}

export default function ConfirmPage() {
  const { token } = useParams<{ token: string }>();
  const [link, setLink] = useState<LinkData | null>(null);
  const [entity, setEntity] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      const res = await fetch(`/api/gateway/magic-link/${token}`);
      if (res.ok) {
        const data = await res.json();
        setLink(data.link);
        setEntity(data.entity);
        if (data.link?.confirmedAt) setConfirmed(true);
      } else {
        setError("This link is invalid, expired, or has already been used.");
      }
      setLoading(false);
    }
    load();
  }, [token]);

  async function handleConfirm() {
    setConfirming(true);
    const res = await fetch(`/api/gateway/magic-link/${token}`, { method: "POST" });
    if (res.ok) {
      setConfirmed(true);
    } else {
      const data = await res.json();
      setError(data.error || "Confirmation failed");
    }
    setConfirming(false);
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50">
        <p className="text-sm text-zinc-500">Validating link...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50">
        <div className="w-full max-w-md rounded-lg border border-red-200 bg-white p-8 text-center">
          <h1 className="text-lg font-semibold text-red-700">Link Error</h1>
          <p className="mt-2 text-sm text-zinc-600">{error}</p>
        </div>
      </div>
    );
  }

  const scopeLabel = link?.scope === "BASELINE_CONFIRM" ? "Baseline Confirmation" : "Change Confirmation";
  const entityName = entity ? ((entity as Record<string, unknown>).title as string) ?? "Item" : "Item";
  const programName = entity && (entity as Record<string, unknown>).program
    ? ((entity as Record<string, unknown>).program as Record<string, unknown>).name as string
    : "";

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50">
      <div className="w-full max-w-lg rounded-lg border border-card-border bg-white p-8">
        <div className="text-center">
          <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider">CGT-Sync</p>
          <h1 className="mt-2 text-xl font-semibold text-zinc-900">{scopeLabel}</h1>
          {programName && <p className="mt-1 text-sm text-zinc-500">{programName}</p>}
        </div>

        <div className="mt-6 rounded-md border border-zinc-200 bg-zinc-50 p-4">
          <h2 className="text-sm font-medium text-zinc-900">{entityName}</h2>
          {entity && (entity as Record<string, unknown>).status ? (
            <p className="mt-1 text-xs text-zinc-500">Status: {(entity as Record<string, unknown>).status as string}</p>
          ) : null}
          {entity && (entity as Record<string, unknown>).clauses ? (
            <div className="mt-3">
              <p className="text-xs font-medium text-zinc-500">Clauses:</p>
              <ul className="mt-1 space-y-1">
                {((entity as Record<string, unknown>).clauses as Array<Record<string, unknown>>).map((c, i) => (
                  <li key={i} className="text-xs text-zinc-600">
                    {c.clauseRef ? `${c.clauseRef}: ` : ""}{c.title as string}
                    {c.value ? ` — ${Number(c.value).toLocaleString()} ${c.unit ?? ""}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        {link && (
          <p className="mt-3 text-center text-xs text-zinc-400">
            Expires: {new Date(link.expiresAt).toLocaleString()}
            {link.singleUse && " · Single use"}
          </p>
        )}

        {confirmed ? (
          <div className="mt-6 rounded-md border border-green-200 bg-green-50 p-4 text-center">
            <p className="text-sm font-medium text-green-700">Confirmed</p>
            <p className="mt-1 text-xs text-green-600">This action has been confirmed and recorded.</p>
          </div>
        ) : (
          <button
            onClick={handleConfirm}
            disabled={confirming}
            className="mt-6 flex h-11 w-full items-center justify-center rounded-md bg-green-600 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-50"
          >
            {confirming ? "Confirming..." : "Confirm"}
          </button>
        )}
      </div>
    </div>
  );
}
