"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import StatusBadge from "@/components/ui/StatusBadge";
import QuickLogModal from "@/components/cockpit/QuickLogModal";
import { useSyncProgram } from "@/components/layout/useSyncProgram";

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
  assignedPmId: string | null;
  assignedPm: { id: string; fullName: string | null; email: string } | null;
  _count: { baselines: number; changes: number; invoices: number; commitmentTerms: number };
}

interface OrgMember {
  id: string;
  fullName: string | null;
  email: string;
  role: string;
}

interface Baseline {
  id: string;
  version: number;
  title: string;
  status: string;
  lockedAt: string | null;
  confirmedAt: string | null;
}

interface Change {
  id: string;
  sequenceNum: number;
  title: string;
  status: string;
  severity: string;
  estimatedImpact: string | null;
  scheduleImpactDays?: number | null;
  createdAt: string;
}

interface RedFlag {
  id: string;
  description: string;
  amount: string;
  flag: string;
  flagNote: string | null;
  invoice: { invoiceNumber: string | null; id: string };
}

interface SmartTask {
  id: string;
  label: string;
  type: "REVIEW" | "ACTION" | "DISPUTE";
  href: string;
}

interface EmailLogEntry {
  id: string;
  recipientEmail: string;
  subject: string | null;
  templateType: string | null;
  entityType: string | null;
  entityId: string | null;
  status: string;
  sentAt: string | null;
  createdAt: string;
}

export default function CockpitPage() {
  const { programId } = useParams<{ programId: string }>();
  const [program, setProgram] = useState<Program | null>(null);
  const [baselines, setBaselines] = useState<Baseline[]>([]);
  const [changes, setChanges] = useState<Change[]>([]);
  const [flags, setFlags] = useState<RedFlag[]>([]);
  const [tasks, setTasks] = useState<SmartTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [pmDropdownOpen, setPmDropdownOpen] = useState(false);
  const [savingPm, setSavingPm] = useState(false);
  const pmDropdownRef = useRef<HTMLDivElement>(null);
  const [emailStatuses, setEmailStatuses] = useState<Record<string, string>>({});
  const [emailLogs, setEmailLogs] = useState<EmailLogEntry[]>([]);
  const [showQuickLog, setShowQuickLog] = useState(false);

  useSyncProgram(program ? { id: program.id, name: program.name, molecule: program.molecule } : null);

  const load = useCallback(async () => {
    // Fetch program, baselines, and changes in parallel
    const [pRes, bRes, cRes] = await Promise.all([
      fetch(`/api/programs/${programId}`),
      fetch(`/api/baselines?programId=${programId}`),
      fetch(`/api/changes?programId=${programId}`),
    ]);

    if (pRes.ok) {
      const pData = await pRes.json();
      setProgram(pData.program ?? pData);
    }

    let allChanges: Change[] = [];
    if (bRes.ok) {
      const bData = await bRes.json();
      setBaselines(bData);
    }
    if (cRes.ok) {
      allChanges = await cRes.json();
      setChanges(allChanges);
    }

    // Fetch invoice flags
    const allFlags: RedFlag[] = [];
    const invRes = await fetch(`/api/invoices?programId=${programId}`);
    if (invRes.ok) {
      const invoices = await invRes.json();
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

    // Build smart tasks
    const smartTasks: SmartTask[] = [];
    const pending = allChanges.filter((c) => c.status === "RELEASED");
    if (pending.length > 0) {
      smartTasks.push({ id: "pending-changes", label: `${pending.length} Pending Change${pending.length > 1 ? "s" : ""} to review`, type: "REVIEW", href: `/programs/${programId}/changes` });
    }
    const drafts = allChanges.filter((c) => c.status === "DRAFT");
    if (drafts.length > 0) {
      smartTasks.push({ id: "draft-changes", label: `${drafts.length} Draft Change${drafts.length > 1 ? "s" : ""} to release`, type: "ACTION", href: `/programs/${programId}/changes` });
    }
    if (allFlags.length > 0) {
      smartTasks.push({ id: "flagged-invoices", label: `${allFlags.length} Invoice Flag${allFlags.length > 1 ? "s" : ""} to resolve`, type: "DISPUTE", href: `/programs/${programId}/invoices` });
    }
    setTasks(smartTasks);
    setLoading(false);
  }, [programId]);

  useEffect(() => { load(); }, [load]);

  // Fetch org members for PM dropdown
  useEffect(() => {
    fetch("/api/org/members")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data?.members) setMembers(data.members); })
      .catch(() => {});
  }, []);

  // Fetch email delivery statuses for pending confirmations
  useEffect(() => {
    if (!programId) return;
    fetch(`/api/gateway/email/log?programId=${programId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.logs) return;
        setEmailLogs(data.logs as EmailLogEntry[]);
        const statuses: Record<string, string> = {};
        for (const log of data.logs as { entityType: string | null; entityId: string | null; status: string }[]) {
          if (log.entityId && !statuses[log.entityId]) {
            statuses[log.entityId] = log.status;
          }
        }
        setEmailStatuses(statuses);
      })
      .catch(() => {});
  }, [programId, loading]);

  // Close PM dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (pmDropdownRef.current && !pmDropdownRef.current.contains(e.target as Node)) {
        setPmDropdownOpen(false);
      }
    }
    if (pmDropdownOpen) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [pmDropdownOpen]);

  async function assignPm(memberId: string | null) {
    setSavingPm(true);
    setPmDropdownOpen(false);
    try {
      const res = await fetch(`/api/programs/${programId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignedPmId: memberId }),
      });
      if (res.ok) {
        await load();
      } else {
        const err = await res.json().catch(() => null);
        alert(err?.error ?? "Failed to assign PM");
      }
    } catch {
      alert("Failed to assign PM");
    }
    setSavingPm(false);
  }

  function getInitials(name: string | null, email: string): string {
    if (name) return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
    return email[0].toUpperCase();
  }

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="flex items-center gap-3 text-sm text-muted">
        <svg className="h-5 w-5 animate-spin text-accent" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
        Loading cockpit...
      </div>
    </div>
  );
  if (!program) return <div className="py-8 text-sm text-red-500">Program not found</div>;

  // ── Truth Status: Show actual baseline version + lock state ──
  const latestBaseline = baselines.length > 0 ? baselines[0] : null; // sorted desc by version
  let truthLabel: string;
  let truthSub: string;
  let truthColor: string;
  if (!latestBaseline) {
    truthLabel = "No Baseline";
    truthSub = "Upload SOW to start";
    truthColor = "text-zinc-400";
  } else if (latestBaseline.status === "LOCKED") {
    truthLabel = `Locked v${latestBaseline.version}`;
    truthSub = latestBaseline.title;
    truthColor = "text-green-600";
  } else if (latestBaseline.status === "CONFIRMED") {
    truthLabel = `Confirmed v${latestBaseline.version}`;
    truthSub = "Awaiting lock";
    truthColor = "text-blue-600";
  } else if (latestBaseline.status === "RELEASED") {
    truthLabel = `Released v${latestBaseline.version}`;
    truthSub = "Awaiting CDMO confirmation";
    truthColor = "text-amber-600";
  } else {
    truthLabel = `Draft v${latestBaseline.version}`;
    truthSub = "Not yet released";
    truthColor = "text-zinc-500";
  }

  // ── Change Velocity: monthly $ + days delta ──
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const thisMonthChanges = changes.filter((c) => new Date(c.createdAt) >= monthStart);
  const monthlyDollars = thisMonthChanges.reduce((sum, c) => sum + (c.estimatedImpact ? Math.abs(Number(c.estimatedImpact)) : 0), 0);
  const monthlyDays = thisMonthChanges.reduce((sum, c) => sum + (c.scheduleImpactDays ? Math.abs(c.scheduleImpactDays) : 0), 0);

  const fmtDollars = monthlyDollars >= 1000
    ? `${program.currency} ${(monthlyDollars / 1000).toFixed(monthlyDollars >= 10000 ? 0 : 1)}k`
    : `${program.currency} ${monthlyDollars.toLocaleString()}`;

  let velocityLabel: string;
  if (monthlyDollars > 0 && monthlyDays > 0) {
    velocityLabel = `+${fmtDollars} / +${monthlyDays}d`;
  } else if (monthlyDollars > 0) {
    velocityLabel = `+${fmtDollars}`;
  } else if (monthlyDays > 0) {
    velocityLabel = `+${monthlyDays} days`;
  } else {
    velocityLabel = "No drift";
  }
  const velocitySub = `${thisMonthChanges.length} change${thisMonthChanges.length !== 1 ? "s" : ""} this month`;

  // ── Pending Confirmations: RELEASED changes/baselines awaiting CDMO ──
  const pendingConfirmations: { id: string; entityId: string; label: string; type: string; href: string }[] = [];
  for (const b of baselines) {
    if (b.status === "RELEASED") {
      pendingConfirmations.push({
        id: `b-${b.id}`,
        entityId: b.id,
        label: `Baseline v${b.version}: ${b.title}`,
        type: "BASELINE",
        href: `/programs/${programId}/baseline`,
      });
    }
  }
  for (const c of changes) {
    if (c.status === "RELEASED") {
      pendingConfirmations.push({
        id: `c-${c.id}`,
        entityId: c.id,
        label: `Change #${c.sequenceNum}: ${c.title}`,
        type: "CHANGE",
        href: `/programs/${programId}/changes`,
      });
    }
  }

  function emailStatusBadge(entityId: string) {
    const status = emailStatuses[entityId];
    if (!status) return <span className="text-xs text-zinc-400">No email sent</span>;
    const styles: Record<string, string> = {
      QUEUED: "bg-zinc-100 text-zinc-600",
      SENT: "bg-blue-100 text-blue-700",
      DELIVERED: "bg-green-100 text-green-700",
      OPENED: "bg-emerald-100 text-emerald-700",
      BOUNCED: "bg-red-100 text-red-700",
      FAILED: "bg-red-100 text-red-700",
    };
    return (
      <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${styles[status] ?? "bg-zinc-100 text-zinc-600"}`}>
        {status === "OPENED" ? "Opened" : status === "DELIVERED" ? "Delivered" : status === "SENT" ? "Sent" : status === "BOUNCED" ? "Bounced" : status === "FAILED" ? "Failed" : "Queued"}
      </span>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted">Program Cockpit</p>
          <h1 className="mt-0.5 text-2xl font-bold text-zinc-900">{program.name}</h1>
          <p className="mt-1 text-sm text-muted">{program.cdmoName} {program.molecule ? `· ${program.molecule}` : ""} {program.modality ? `· ${program.modality}` : ""}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowQuickLog(true)}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-accent/90"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Quick Log
          </button>
          <StatusBadge status={program.status} />
          {/* PM Assignment Dropdown */}
          <div className="relative" ref={pmDropdownRef}>
            <button
              onClick={() => setPmDropdownOpen((o) => !o)}
              disabled={savingPm}
              className="flex items-center gap-2 rounded-lg bg-accent-light px-3 py-1.5 text-xs font-semibold text-accent-text transition-colors hover:bg-accent-light/80"
            >
              {program.assignedPm ? (
                <>
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[9px] font-bold text-white">
                    {getInitials(program.assignedPm.fullName, program.assignedPm.email)}
                  </span>
                  {program.assignedPm.fullName ?? program.assignedPm.email}
                </>
              ) : (
                savingPm ? "Saving..." : "Assign PM"
              )}
              <svg className="h-3 w-3 opacity-60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
            </button>
            {pmDropdownOpen && (
              <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-card-border bg-white py-1 shadow-lg">
                {program.assignedPm && (
                  <button
                    onClick={() => assignPm(null)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-red-600 hover:bg-red-50"
                  >
                    Unassign PM
                  </button>
                )}
                {members.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => assignPm(m.id)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-zinc-50 ${
                      program.assignedPmId === m.id ? "bg-accent-light font-semibold text-accent-text" : "text-zinc-700"
                    }`}
                  >
                    <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-zinc-200 text-[9px] font-semibold text-zinc-600">
                      {getInitials(m.fullName, m.email)}
                    </span>
                    <span className="truncate">{m.fullName ?? m.email}</span>
                    {m.role === "ADMIN" && <span className="ml-auto text-[10px] text-zinc-400">Admin</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Metric cards */}
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Link href={`/programs/${programId}/baseline`} className="card card-hover">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">Truth Status</p>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-50">
              <svg className="h-4 w-4 text-purple-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
            </div>
          </div>
          <p className={`mt-2 text-xl font-bold ${truthColor}`}>{truthLabel}</p>
          <p className="mt-1 truncate text-xs text-muted">{truthSub}</p>
        </Link>

        <Link href={`/programs/${programId}/timeline`} className="card card-hover">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">Timeline</p>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50">
              <svg className="h-4 w-4 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
            </div>
          </div>
          <p className="mt-2 text-2xl font-bold text-zinc-900">{program._count.commitmentTerms}</p>
          <p className="mt-1 text-xs text-muted">commitment terms</p>
        </Link>

        <Link href={`/programs/${programId}/changes`} className="card card-hover">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">Change Velocity</p>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50">
              <svg className="h-4 w-4 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" /></svg>
            </div>
          </div>
          <p className={`mt-2 text-xl font-bold ${monthlyDollars > 0 || monthlyDays > 0 ? "text-amber-600" : "text-zinc-900"}`}>
            {velocityLabel}
          </p>
          <p className="mt-1 text-xs text-muted">{velocitySub}</p>
        </Link>

        <Link href={`/programs/${programId}/invoices`} className="card card-hover">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">Invoice Health</p>
            <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${flags.length > 0 ? "bg-red-50" : "bg-green-50"}`}>
              <svg className={`h-4 w-4 ${flags.length > 0 ? "text-red-500" : "text-green-500"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
            </div>
          </div>
          <p className={`mt-2 text-2xl font-bold ${flags.length > 0 ? "text-red-600" : "text-zinc-900"}`}>
            {flags.length > 0 ? `${flags.length} Flagged` : `${program._count.invoices} Clean`}
          </p>
          <p className="mt-1 text-xs text-muted">{program._count.invoices} invoice{program._count.invoices !== 1 ? "s" : ""} total</p>
        </Link>
      </div>

      {/* Pending Confirmations — CDMO action items */}
      {pendingConfirmations.length > 0 && (
        <div className="mt-6 card border-amber-200 bg-amber-50/30">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-900">Pending Confirmations</h2>
            <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-amber-100 px-1.5 text-xs font-bold text-amber-700">{pendingConfirmations.length}</span>
          </div>
          <p className="mt-1 text-xs text-muted">Items sent to CDMO awaiting confirmation</p>
          <div className="mt-3 space-y-2">
            {pendingConfirmations.map((item) => (
              <Link
                key={item.id}
                href={item.href}
                className="flex items-center justify-between rounded-lg border border-amber-200 bg-white p-3 transition-colors hover:shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${
                    item.type === "BASELINE" ? "bg-purple-100 text-purple-700" : "bg-amber-100 text-amber-700"
                  }`}>{item.type}</span>
                  <span className="text-sm font-medium text-zinc-700">{item.label}</span>
                </div>
                <div className="flex items-center gap-2">
                  {emailStatusBadge(item.entityId)}
                  <span className="text-xs text-amber-600">Awaiting response</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Two-column: Details + Red Flags */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Program details card */}
        <div className="card">
          <h2 className="text-sm font-semibold text-zinc-900">Program Details</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted">CDMO</dt>
              <dd className="font-medium text-zinc-900">{program.cdmoName}</dd>
            </div>
            <div className="flex justify-between border-t border-card-border pt-3">
              <dt className="text-muted">Currency</dt>
              <dd className="font-medium text-zinc-900">{program.currency}</dd>
            </div>
            <div className="flex justify-between border-t border-card-border pt-3">
              <dt className="text-muted">Auto-log Threshold</dt>
              <dd className="font-medium text-zinc-900">
                {program.changeThreshold ? `${program.currency} ${Number(program.changeThreshold).toLocaleString()}` : "Not set"}
              </dd>
            </div>
            <div className="flex justify-between border-t border-card-border pt-3">
              <dt className="text-muted">Activated</dt>
              <dd className="font-medium text-zinc-900">
                {program.activatedAt ? new Date(program.activatedAt).toLocaleDateString() : "Not yet"}
              </dd>
            </div>
          </dl>
        </div>

        {/* Red Flags */}
        <div className="card">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-900">Red Flags</h2>
            {flags.length > 0 && (
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-100 text-xs font-bold text-red-600">{flags.length}</span>
            )}
          </div>
          {flags.length === 0 ? (
            <div className="mt-6 flex flex-col items-center py-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-50">
                <svg className="h-5 w-5 text-green-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
              </div>
              <p className="mt-2 text-sm text-muted">No red flags - all clear</p>
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              {flags.slice(0, 5).map((f) => (
                <div key={f.id} className="flex items-start gap-3 rounded-lg border border-red-100 bg-red-50/50 p-3">
                  <StatusBadge status={f.flag} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-zinc-900">{f.description}</p>
                    {f.flagNote && <p className="mt-0.5 text-xs text-red-600">{f.flagNote}</p>}
                    <p className="mt-1 text-xs text-muted">
                      Invoice: {f.invoice.invoiceNumber ?? "N/A"} · ${Number(f.amount).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
              {flags.length > 5 && (
                <Link href={`/programs/${programId}/invoices`} className="block text-center text-xs font-medium text-accent hover:text-accent-text">
                  View all {flags.length} flags
                </Link>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Smart Tasks */}
      {tasks.length > 0 && (
        <div className="mt-6 card">
          <h2 className="text-sm font-semibold text-zinc-900">Smart Tasks</h2>
          <div className="mt-3 space-y-2">
            {tasks.map((task) => {
              const colors = task.type === "REVIEW" ? "border-amber-200 bg-amber-50 text-amber-700"
                : task.type === "DISPUTE" ? "border-red-200 bg-red-50 text-red-700"
                : "border-blue-200 bg-blue-50 text-blue-700";
              const badgeColors = task.type === "REVIEW" ? "bg-amber-100 text-amber-700"
                : task.type === "DISPUTE" ? "bg-red-100 text-red-700"
                : "bg-blue-100 text-blue-700";
              return (
                <Link key={task.id} href={task.href} className={`flex items-center justify-between rounded-lg border p-3 transition-colors hover:shadow-sm ${colors}`}>
                  <div className="flex items-center gap-3">
                    <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${badgeColors}`}>{task.type}</span>
                    <span className="text-sm font-medium">{task.label}</span>
                  </div>
                  <svg className="h-4 w-4 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Quick links */}
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { href: `/programs/${programId}/baseline`, label: "Assumption Locker", icon: "M3 11h18v11H3zM7 11V7a5 5 0 0110 0v4", color: "bg-purple-50 text-purple-500" },
          { href: `/programs/${programId}/evidence`, label: "Evidence Log", icon: "M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z", color: "bg-blue-50 text-blue-500" },
          { href: `/programs/${programId}/exports`, label: "Export Center", icon: "M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3", color: "bg-emerald-50 text-emerald-500" },
          { href: `/programs/${programId}/timeline`, label: "Commitment Timeline", icon: "M12 2a10 10 0 100 20 10 10 0 000-20zM12 6v6l4 2", color: "bg-amber-50 text-amber-500" },
        ].map((item) => (
          <Link key={item.href} href={item.href} className="card card-hover flex items-center gap-3">
            <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${item.color}`}>
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={item.icon} /></svg>
            </div>
            <span className="text-sm font-medium text-zinc-700">{item.label}</span>
          </Link>
        ))}
      </div>

      {/* Email Activity */}
      {emailLogs.length > 0 && (
        <div className="mt-6 card">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-900">Email Activity</h2>
            <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-blue-100 px-1.5 text-xs font-bold text-blue-700">{emailLogs.length}</span>
          </div>
          <p className="mt-1 text-xs text-muted">Recent emails sent from this program</p>
          <div className="mt-3 space-y-2">
            {emailLogs.slice(0, 5).map((log) => {
              const templateColors: Record<string, string> = {
                CONFIRMATION: "bg-amber-100 text-amber-700",
                DISPUTE: "bg-red-100 text-red-700",
                REMINDER: "bg-blue-100 text-blue-700",
                FOLLOW_UP: "bg-purple-100 text-purple-700",
              };
              const templateLabel = log.templateType ?? "EMAIL";
              const templateStyle = templateColors[templateLabel] ?? "bg-zinc-100 text-zinc-600";
              const ago = (() => {
                const diff = Date.now() - new Date(log.createdAt).getTime();
                const mins = Math.floor(diff / 60000);
                if (mins < 1) return "just now";
                if (mins < 60) return `${mins}m ago`;
                const hrs = Math.floor(mins / 60);
                if (hrs < 24) return `${hrs}h ago`;
                const days = Math.floor(hrs / 24);
                return `${days}d ago`;
              })();
              return (
                <div key={log.id} className="flex items-center justify-between rounded-lg border border-card-border bg-white p-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${templateStyle}`}>{templateLabel}</span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-zinc-700">{log.subject ?? log.recipientEmail}</p>
                      {log.subject && <p className="truncate text-xs text-muted">{log.recipientEmail}</p>}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {(() => {
                      const styles: Record<string, string> = {
                        QUEUED: "bg-zinc-100 text-zinc-600",
                        SENT: "bg-blue-100 text-blue-700",
                        DELIVERED: "bg-green-100 text-green-700",
                        OPENED: "bg-emerald-100 text-emerald-700",
                        BOUNCED: "bg-red-100 text-red-700",
                        FAILED: "bg-red-100 text-red-700",
                      };
                      return (
                        <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${styles[log.status] ?? "bg-zinc-100 text-zinc-600"}`}>
                          {log.status === "OPENED" ? "Opened" : log.status === "DELIVERED" ? "Delivered" : log.status === "SENT" ? "Sent" : log.status === "BOUNCED" ? "Bounced" : log.status === "FAILED" ? "Failed" : "Queued"}
                        </span>
                      );
                    })()}
                    <span className="text-xs text-muted">{ago}</span>
                  </div>
                </div>
              );
            })}
          </div>
          {emailLogs.length > 5 && (
            <Link href={`/programs/${programId}/timeline`} className="mt-3 block text-center text-xs font-medium text-accent hover:text-accent-text">
              View all {emailLogs.length} emails
            </Link>
          )}
        </div>
      )}

      {/* Quick Log Modal */}
      {showQuickLog && (
        <QuickLogModal
          programId={programId}
          changeThreshold={program.changeThreshold ? Number(program.changeThreshold) : null}
          onSuccess={() => {
            setShowQuickLog(false);
            load();
          }}
          onClose={() => setShowQuickLog(false)}
        />
      )}
    </div>
  );
}
