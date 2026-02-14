"use client";

import { useEffect, useState } from "react";

interface HealthData {
  status: string;
  checks: {
    db_ok: boolean;
    db_error: string | null;
    migrations_ok: boolean;
    missing_tables: string[];
    required_env_present: Record<string, boolean>;
    evidence_bucket_exists: boolean;
    evidence_bucket_name: string;
    bucket_error: string | null;
    app_url_present: boolean;
  };
}

function Check({
  label,
  ok,
  fix,
}: {
  label: string;
  ok: boolean;
  fix?: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-md border px-4 py-3">
      <span
        className={`mt-0.5 inline-block h-3 w-3 rounded-full ${ok ? "bg-green-500" : "bg-red-500"}`}
      />
      <div className="flex-1">
        <p className={`text-sm font-medium ${ok ? "text-zinc-700" : "text-red-700"}`}>
          {label}
        </p>
        {!ok && fix && (
          <p className="mt-1 text-xs text-zinc-500">{fix}</p>
        )}
      </div>
    </div>
  );
}

export default function AdminHealthPage() {
  const [data, setData] = useState<HealthData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [bootstrapping, setBootstrapping] = useState(false);

  async function fetchHealth() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/health");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch health");
    } finally {
      setLoading(false);
    }
  }

  async function handleBootstrap() {
    setBootstrapping(true);
    try {
      const res = await fetch("/api/admin/bootstrap", { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        alert(`Bootstrap failed: ${body.error}`);
      } else {
        alert(body.message);
        fetchHealth();
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Bootstrap failed");
    } finally {
      setBootstrapping(false);
    }
  }

  useEffect(() => {
    fetchHealth();
  }, []);

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl py-8">
        <h1 className="text-xl font-bold text-zinc-900">System Health</h1>
        <p className="mt-4 text-sm text-zinc-500">Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl py-8">
        <h1 className="text-xl font-bold text-zinc-900">System Health</h1>
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const c = data.checks;

  return (
    <div className="mx-auto max-w-2xl py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-zinc-900">System Health</h1>
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            data.status === "healthy"
              ? "bg-green-100 text-green-800"
              : "bg-red-100 text-red-800"
          }`}
        >
          {data.status}
        </span>
      </div>

      <div className="mt-6 space-y-3">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide">
          Infrastructure
        </h2>

        <Check
          label="Database connection"
          ok={c.db_ok}
          fix={
            c.db_error
              ? `Error: ${c.db_error}. Check DATABASE_URL in your environment variables.`
              : "Set DATABASE_URL to your Supabase connection string (port 6543 for pooler)."
          }
        />

        <Check
          label={`Migrations applied (${13 - c.missing_tables.length}/13 tables)`}
          ok={c.migrations_ok}
          fix={
            c.missing_tables.length > 0
              ? `Missing tables: ${c.missing_tables.join(", ")}. Run: npx prisma migrate deploy`
              : "Run: npx prisma migrate deploy"
          }
        />

        <Check
          label={`Evidence bucket "${c.evidence_bucket_name}"`}
          ok={c.evidence_bucket_exists}
          fix={
            c.bucket_error
              ? `${c.bucket_error}. Click "Bootstrap Storage" below or create the bucket manually in Supabase Dashboard → Storage.`
              : 'Click "Bootstrap Storage" below to create it automatically.'
          }
        />

        {!c.evidence_bucket_exists && (
          <button
            onClick={handleBootstrap}
            disabled={bootstrapping}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {bootstrapping ? "Creating..." : "Bootstrap Storage"}
          </button>
        )}

        <Check
          label="NEXT_PUBLIC_APP_URL"
          ok={c.app_url_present}
          fix="Set NEXT_PUBLIC_APP_URL to your production URL (e.g. https://your-app.vercel.app). Required for auth redirects."
        />
      </div>

      <div className="mt-8 space-y-3">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide">
          Environment Variables
        </h2>
        {Object.entries(c.required_env_present).map(([key, present]) => (
          <Check
            key={key}
            label={key}
            ok={present}
            fix={`Set ${key} in Vercel → Settings → Environment Variables.`}
          />
        ))}
      </div>

      <div className="mt-8 space-y-3">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide">
          Pilot Acceptance Checklist
        </h2>
        <div className="rounded-md border bg-zinc-50 p-4 text-xs text-zinc-600 space-y-1">
          <p>1. Create Program (via /onboarding)</p>
          <p>2. Upload SOW as Evidence (type = SOW_MSA)</p>
          <p>3. Create Baseline + add clauses manually</p>
          <p>4. Lock baseline (DRAFT → RELEASED → CONFIRMED → LOCKED)</p>
          <p>5. Create Change event manually</p>
          <p>6. Upload Invoice (type = INVOICE) + add line items</p>
          <p>7. Map/flag line items to clauses</p>
          <p>8. Generate Dispute Packet PDF</p>
          <p>9. Export governance packs</p>
        </div>
      </div>

      <div className="mt-6">
        <button
          onClick={fetchHealth}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
        >
          Refresh
        </button>
      </div>
    </div>
  );
}
