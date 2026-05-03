"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Logo } from "@/components/brand/Logo";
import {
  DEFAULT_ACCENT,
  contrastRatio,
  isValidHex,
  shade,
} from "@/lib/brand/shade";

interface Props {
  orgName: string;
  initialLogoUrl: string | null;
  initialAccentColor: string | null;
}

export default function BrandingForm({
  orgName,
  initialLogoUrl,
  initialAccentColor,
}: Props) {
  const [accent, setAccent] = useState<string>(
    initialAccentColor && isValidHex(initialAccentColor)
      ? initialAccentColor
      : DEFAULT_ACCENT,
  );
  const [accentDirty, setAccentDirty] = useState(false);
  const [logoSignedUrl, setLogoSignedUrl] = useState<string | null>(null);
  const [hasLogo, setHasLogo] = useState<boolean>(!!initialLogoUrl);
  const [savingAccent, setSavingAccent] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/org/branding")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data?.org) return;
        setLogoSignedUrl(data.org.logoSignedUrl ?? null);
        setHasLogo(!!data.org.logoUrl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const validHex = isValidHex(accent);
  const contrast = useMemo(
    () => (validHex ? contrastRatio(accent, "#ffffff") : 0),
    [accent, validHex],
  );
  const contrastWarning = validHex && contrast < 4.5;

  function onPickAccent(value: string) {
    setAccent(value);
    setAccentDirty(true);
    setSavedAt(null);
  }

  async function saveAccent(value: string | null) {
    setSavingAccent(true);
    setError(null);
    try {
      const res = await fetch("/api/org/branding", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accentColor: value }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to save");
      }
      setAccentDirty(false);
      setSavedAt(Date.now());
      if (value === null) setAccent(DEFAULT_ACCENT);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSavingAccent(false);
    }
  }

  async function uploadLogo(file: File) {
    setUploadingLogo(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/org/logo", { method: "POST", body: fd });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Upload failed");
      }
      const data = await res.json();
      setLogoSignedUrl(data.logoSignedUrl ?? null);
      setHasLogo(!!data.logoUrl);
      setSavedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploadingLogo(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const previewAccent = validHex ? accent : DEFAULT_ACCENT;
  const previewHover = shade(previewAccent, -12);

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Logo section */}
      <section className="card">
        <h2 className="text-base font-semibold text-zinc-900">Logo</h2>
        <p className="mt-1 text-sm text-muted">
          Shown in the sidebar in place of the CGT Sync wordmark. PNG or SVG, transparent background recommended.
        </p>
        <div className="mt-4 flex items-center gap-5">
          <div
            className="flex h-16 w-16 items-center justify-center rounded-lg border border-card-border bg-navy"
            aria-label="Logo preview"
          >
            {logoSignedUrl ? (
              <img
                src={logoSignedUrl}
                alt={`${orgName} logo`}
                className="max-h-12 max-w-12 object-contain"
              />
            ) : (
              <Logo size={32} variant="dark" accentColor={previewAccent} />
            )}
          </div>
          <div className="flex flex-col gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/svg+xml,image/jpeg"
              disabled={uploadingLogo}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadLogo(f);
              }}
              className="block text-sm text-zinc-600 file:mr-3 file:rounded-md file:border-0 file:bg-accent file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-accent-hover disabled:opacity-50"
            />
            {hasLogo && (
              <p className="text-xs text-muted">
                Custom logo active. Upload again to replace.
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Accent color section */}
      <section className="card">
        <h2 className="text-base font-semibold text-zinc-900">Accent color</h2>
        <p className="mt-1 text-sm text-muted">
          Used for active nav items, primary buttons, focus rings, and the call-to-action color in your outbound emails and PDFs.
        </p>

        <div className="mt-4 flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-zinc-700">Pick</span>
            <input
              type="color"
              value={validHex ? accent : DEFAULT_ACCENT}
              onChange={(e) => onPickAccent(e.target.value)}
              className="h-11 w-16 cursor-pointer rounded-md border border-card-border bg-white p-1"
              aria-label="Accent color picker"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-zinc-700">Hex</span>
            <input
              type="text"
              value={accent}
              onChange={(e) => onPickAccent(e.target.value.trim())}
              placeholder="#2563eb"
              spellCheck={false}
              className="input h-11 w-36 font-mono text-sm uppercase"
              aria-invalid={!validHex}
            />
          </label>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => saveAccent(accent)}
            disabled={!validHex || !accentDirty || savingAccent}
            className="h-11 rounded-md bg-accent px-4 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {savingAccent ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => saveAccent(null)}
            disabled={savingAccent}
            className="h-11 rounded-md border border-card-border bg-white px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
            title="Reset to CGT Sync default"
          >
            Reset to default
          </button>
        </div>

        {!validHex && (
          <p className="mt-2 text-xs text-red-600">
            Enter a 6-digit hex like <code className="font-mono">#2563eb</code>.
          </p>
        )}
        {contrastWarning && (
          <p className="mt-2 text-xs text-amber-700">
            Low contrast on white ({contrast.toFixed(2)}:1). White text on this color may be hard to read.
          </p>
        )}
        {savedAt && !accentDirty && (
          <p className="mt-2 text-xs text-emerald-700">Saved.</p>
        )}

        {/* Live preview */}
        <div className="mt-6 rounded-lg border border-card-border bg-zinc-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">
            Preview
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            {/* Mini sidebar swatch */}
            <div
              className="flex w-44 flex-col gap-1.5 rounded-md bg-navy p-3"
              style={{
                ["--accent" as string]: previewAccent,
                ["--sidebar-active" as string]: previewAccent,
              }}
            >
              <div className="flex items-center gap-2">
                {logoSignedUrl ? (
                  <img
                    src={logoSignedUrl}
                    alt=""
                    className="h-5 w-auto max-w-[20px] object-contain"
                  />
                ) : (
                  <Logo size={20} variant="dark" accentColor={previewAccent} />
                )}
                <span className="text-xs font-semibold text-white">
                  {orgName}
                </span>
              </div>
              <div
                className="mt-1 rounded px-2 py-1.5 text-[11px] font-medium text-white"
                style={{ backgroundColor: previewAccent }}
              >
                Programs
              </div>
              <div className="rounded px-2 py-1.5 text-[11px] text-slate-300">
                Changes
              </div>
            </div>

            {/* Button preview */}
            <button
              type="button"
              className="h-10 rounded-md px-4 text-sm font-medium text-white transition-colors"
              style={{ backgroundColor: previewAccent }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = previewHover;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = previewAccent;
              }}
            >
              Confirm baseline
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
