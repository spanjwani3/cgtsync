"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import StatusBadge from "@/components/ui/StatusBadge";

interface Program {
  id: string;
  name: string;
  cdmoName: string;
  molecule: string | null;
  modality: string | null;
  status: string;
  currency: string;
  changeThreshold: string | null;
  activatedAt: string | null;
  _count: { baselines: number; changes: number; invoices: number; commitmentTerms: number };
}

interface TimelineEvent {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  user?: { email: string } | null;
}

interface RedFlag {
  id: string;
  description: string;
  amount: string;
  flag: string;
  flagNote: string | null;
  invoice: { invoiceNumber: string | null; id: string };
}

export default function CockpitPage() {
  const { programId } = useParams<{ programId: string }>();
  const [program, setProgram] = useState<Program | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [flags, setFlags] = useState<RedFlag[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [pRes] = await Promise.all([
      fetch(`/api/programs/${programId}`),
    ]);
    if (pRes.ok) {
      const pData = await pRes.json();
      setProgram(pData.program ?? pData);
    }

    // Load flagged line items
    const invRes = await fetch(`/api/invoices?programId=${programId}`);
    if (invRes.ok) {
      const invoices = await invRes.json();
      const allFlags: RedFlag[] = [];
      for (const inv of invoices) {
        const detailRes = await fetch(`/api/invoices/${inv.id}`);
        if (detailRes.ok) {
          const detail = await detailRes.json();
          for (const li of detail.lineItems ?? []) {
            if (li.flag !== "NONE") {
              allFlags.push({ ...li, invoice: { invoiceNumber: inv.invoiceNumber, id: inv.id } });
            }
          }
        }
      }
      setFlags(allFlags);
    }
    setLoading(false);
  }, [programId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <div className="py-8 text-sm text-zinc-500">Loading cockpit...</div>;
  if (!program) return <div className="py-8 text-sm text-red-500">Program not found</div>;

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">{program.name}</h1>
          <p className="mt-1 text-sm text-zinc-500">{program.cdmoName} · {[program.molecule, program.modality].filter(Boolean).join(" · ")}</p>
        </div>
        <StatusBadge status={program.status} />
      </div>

      {/* Key metrics */}
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-5">
        <Link href={`/programs/${programId}/baseline`} className="rounded-lg border border-card-border bg-card-bg p-4 transition-shadow hover:shadow-md">
          <p className="text-xs font-medium text-zinc-500">Baselines</p>
          <p className="mt-1 text-2xl font-semibold text-zinc-900">{program._count.baselines}</p>
        </Link>
        <Link href={`/programs/${programId}/changes`} className="rounded-lg border border-card-border bg-card-bg p-4 transition-shadow hover:shadow-md">
          <p className="text-xs font-medium text-zinc-500">Changes</p>
          <p className="mt-1 text-2xl font-semibold text-zinc-900">{program._count.changes}</p>
        </Link>
        <Link href={`/programs/${programId}/invoices`} className="rounded-lg border border-card-border bg-card-bg p-4 transition-shadow hover:shadow-md">
          <p className="text-xs font-medium text-zinc-500">Invoices</p>
          <p className="mt-1 text-2xl font-semibold text-zinc-900">{program._count.invoices}</p>
        </Link>
        <Link href={`/programs/${programId}/timeline`} className="rounded-lg border border-card-border bg-card-bg p-4 transition-shadow hover:shadow-md">
          <p className="text-xs font-medium text-zinc-500">Timeline</p>
          <p className="mt-1 text-2xl font-semibold text-zinc-900">{program._count.commitmentTerms}</p>
        </Link>
        <div className="rounded-lg border border-card-border bg-card-bg p-4">
          <p className="text-xs font-medium text-zinc-500">Red Flags</p>
          <p className={`mt-1 text-2xl font-semibold ${flags.length > 0 ? "text-red-600" : "text-green-600"}`}>{flags.length}</p>
        </div>
      </div>

      {/* Program details */}
      <div className="mt-6 rounded-lg border border-card-border bg-card-bg p-5">
        <h2 className="text-sm font-medium text-zinc-700">Program Details</h2>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <div>
            <dt className="text-zinc-500">Currency</dt>
            <dd className="font-medium text-zinc-900">{program.currency}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Auto-log Threshold</dt>
            <dd className="font-medium text-zinc-900">
              {program.changeThreshold ? `${program.currency} ${Number(program.changeThreshold).toLocaleString()}` : "Not set"}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">Activated</dt>
            <dd className="font-medium text-zinc-900">
              {program.activatedAt ? new Date(program.activatedAt).toLocaleDateString() : "Not yet"}
            </dd>
          </div>
        </dl>
      </div>

      {/* Red Flags */}
      {flags.length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm font-medium text-zinc-700">Red Flags</h2>
          <div className="mt-3 space-y-2">
            {flags.map((f) => (
              <div key={f.id} className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-3">
                <StatusBadge status={f.flag} />
                <div className="flex-1">
                  <p className="text-sm font-medium text-zinc-900">{f.description}</p>
                  <p className="text-xs text-red-600">{f.flagNote}</p>
                  <p className="mt-1 text-xs text-zinc-500">
                    Invoice: {f.invoice.invoiceNumber ?? f.invoice.id} · Amount: ${Number(f.amount).toLocaleString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick links */}
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Link href={`/programs/${programId}/baseline`} className="rounded-lg border border-card-border bg-card-bg p-4 text-center text-sm font-medium text-zinc-700 hover:bg-zinc-50">
          Assumption Locker
        </Link>
        <Link href={`/programs/${programId}/timeline`} className="rounded-lg border border-card-border bg-card-bg p-4 text-center text-sm font-medium text-zinc-700 hover:bg-zinc-50">
          Commitment Timeline
        </Link>
        <Link href={`/programs/${programId}/evidence`} className="rounded-lg border border-card-border bg-card-bg p-4 text-center text-sm font-medium text-zinc-700 hover:bg-zinc-50">
          Evidence Log
        </Link>
        <Link href={`/programs/${programId}/exports`} className="rounded-lg border border-card-border bg-card-bg p-4 text-center text-sm font-medium text-zinc-700 hover:bg-zinc-50">
          Export Center
        </Link>
      </div>
    </div>
  );
}
