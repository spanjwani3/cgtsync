"use client";

import { useEffect, useState } from "react";

interface ExpectedTable {
  model: string;
  table: string;
  exists?: boolean;
}

interface HealthData {
  requestId: string;
  status: string;
  checks: {
    db_ok: boolean;
    db_error: string | null;
    migrations_ok: boolean;
    expected_tables: ExpectedTable[];
    missing_tables: string[];
    required_env_present: Record<string, boolean>;
    evidence_bucket_exists: boolean;
    evidence_bucket_name: string;
    bucket_error: string | null;
    app_url_present: boolean;
  };
}

interface DbCheckData {
  requestId: string;
  ok: boolean;
  expected: ExpectedTable[];
  missing: string[];
  extra: string[];
  migrations_table_exists: boolean;
  recent_migrations: { id: string; migration_name: string; finished_at: string | null }[];
  fix: string | null;
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
  const [dbCheck, setDbCheck] = useState<DbCheckData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [showDbDetail, setShowDbDetail] = useState(false);

  async function fetchHealth() {
    setLoading(true);
    setError(null);
    try {
      const [healthRes, dbRes] = await Promise.all([
        fetch("/api/admin/health"),
        fetch("/api/admin/db-check"),
      ]);
      if (!healthRes.ok) {
        const body = await healthRes.json().catch(() => ({}));
        setError(body.error ?? `HTTP ${healthRes.status}`);
        return;
      }
      setData(await healthRes.json());
      if (dbRes.ok) {
        setDbCheck(await dbRes.json());
      }
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
  const totalTables = c.expected_tables.length;
  const presentTables = totalTables - c.missing_tables.length;

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
          label={`Migrations applied (${presentTables}/${totalTables} tables)`}
          ok={c.migrations_ok}
          fix={
            c.missing_tables.length > 0
              ? `Missing tables: ${c.missing_tables.join(", ")}. Run: npx prisma migrate deploy`
              : "Run: npx prisma migrate deploy"
          }
        />

        {c.db_ok && (
          <button
            onClick={() => setShowDbDetail(!showDbDetail)}
            className="text-xs text-zinc-500 hover:text-zinc-700 underline"
          >
            {showDbDetail ? "Hide" : "Show"} database detail
          </button>
        )}

        {showDbDetail && dbCheck && (
          <div className="rounded-md border bg-zinc-50 p-4 space-y-2">
            <p className="text-xs font-medium text-zinc-600">
              Table Status (from schema.prisma)
            </p>
            <div className="grid grid-cols-2 gap-1 text-xs">
              {dbCheck.expected.map((t) => (
                <div key={t.table} className="flex items-center gap-1.5">
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${t.exists ? "bg-green-500" : "bg-red-500"}`}
                  />
                  <span className="text-zinc-500">{t.model}</span>
                  <span className="text-zinc-400">({t.table})</span>
                </div>
              ))}
            </div>
            {dbCheck.recent_migrations.length > 0 && (
              <>
                <p className="text-xs font-medium text-zinc-600 mt-3">
                  Recent Migrations
                </p>
                {dbCheck.recent_migrations.map((m) => (
                  <p key={m.id} className="text-xs text-zinc-500 font-mono">
                    {m.migration_name}
                  </p>
                ))}
              </>
            )}
            {!dbCheck.migrations_table_exists && (
              <p className="text-xs text-red-600">
                _prisma_migrations table not found. Run: npx prisma migrate deploy
              </p>
            )}
          </div>
        )}

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
