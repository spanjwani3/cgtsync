"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import StatusBadge from "@/components/ui/StatusBadge";
import { SkeletonCard } from "@/components/ui/Skeleton";

interface ProgramItem {
  id: string;
  name: string;
  cdmoName: string;
  molecule: string | null;
  modality: string | null;
  status: string;
  assignedPmId: string | null;
  assignedPm: { id: string; fullName: string | null; email: string } | null;
  _count: { baselines: number; changes: number; invoices: number };
}

interface OrgMember {
  id: string;
  fullName: string | null;
  email: string;
  role: string;
}

export default function ProgramsPage() {
  const [programs, setPrograms] = useState<ProgramItem[]>([]);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterPm, setFilterPm] = useState<string>("");
  const [myOnly, setMyOnly] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("cgtsync_my_programs") === "true";
    }
    return false;
  });
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const loadPrograms = useCallback(async () => {
    setLoading(true);
    try {
      let url = "/api/programs";
      if (filterPm) url += `?assignedPmId=${filterPm}`;
      else if (myOnly && currentUserId) url += `?assignedPmId=${currentUserId}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setPrograms(data.programs);
      }
    } catch {
      // silent
    }
    setLoading(false);
  }, [filterPm, myOnly, currentUserId]);

  useEffect(() => {
    // Load members for filter dropdown
    fetch("/api/org/members")
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data?.members) setMembers(data.members);
      })
      .catch(() => {});

    // Get current user ID
    fetch("/api/programs")
      .then((res) => res.ok ? res.json() : null)
      .catch(() => null);
  }, []);

  // Get current user from a lightweight call
  useEffect(() => {
    fetch("/api/org/members")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.members) {
          // The first member is usually the current user, but we need the actual current user
          // We'll get it from the auth context by checking which programs the user can see
          setMembers(data.members);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadPrograms();
  }, [loadPrograms]);

  function toggleMyPrograms() {
    const newVal = !myOnly;
    setMyOnly(newVal);
    setFilterPm("");
    if (typeof window !== "undefined") {
      localStorage.setItem("cgtsync_my_programs", String(newVal));
    }
  }

  function getInitials(name: string | null, email: string): string {
    if (name) {
      return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
    }
    return email[0].toUpperCase();
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Programs</h1>
          <p className="mt-1 text-sm text-muted">Manage your Sponsor-CDMO programs</p>
        </div>
        <Link href="/onboarding" data-tour="new-program-btn" className="btn-primary">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          New Program
        </Link>
      </div>

      {/* Filter Bar */}
      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={toggleMyPrograms}
          className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
            myOnly
              ? "bg-zinc-900 text-white"
              : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
          }`}
        >
          {myOnly ? "My Programs" : "All Programs"}
        </button>

        {members.length > 1 && (
          <select
            value={filterPm}
            onChange={(e) => { setFilterPm(e.target.value); setMyOnly(false); }}
            className="rounded-md border border-zinc-300 px-2 py-1.5 text-xs text-zinc-700"
          >
            <option value="">All PMs</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.fullName ?? m.email}
              </option>
            ))}
          </select>
        )}

      </div>

      {loading ? (
        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : programs.length === 0 ? (
        <div className="mt-16 flex flex-col items-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-light">
            <svg className="h-8 w-8 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
          </div>
          <p className="mt-4 font-medium text-zinc-900">
            {myOnly || filterPm ? "No matching programs" : "No programs yet"}
          </p>
          <p className="mt-1 text-sm text-muted">
            {myOnly || filterPm ? "Try changing your filter" : "Create your first program to get started"}
          </p>
          {!myOnly && !filterPm && (
            <Link href="/onboarding" data-tour="new-program-btn" className="btn-primary mt-5">Create Program</Link>
          )}
        </div>
      ) : (
        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {programs.map((p) => (
            <Link
              key={p.id}
              href={`/programs/${p.id}/cockpit`}
              className="card card-hover group"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-accent-light">
                    <svg className="h-5 w-5 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-zinc-900 group-hover:text-accent-text">{p.name}</h3>
                    <p className="mt-0.5 text-sm text-muted">{p.cdmoName}</p>
                  </div>
                </div>
                <StatusBadge status={p.status} />
              </div>
              {(p.molecule || p.modality) && (
                <p className="mt-3 text-xs text-muted">
                  {[p.molecule, p.modality].filter(Boolean).join(" · ")}
                </p>
              )}

              {/* PM Badge */}
              {p.assignedPm && (
                <div className="mt-3 flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-zinc-200 text-[10px] font-semibold text-zinc-600">
                    {getInitials(p.assignedPm.fullName, p.assignedPm.email)}
                  </span>
                  <span className="text-xs text-zinc-500">
                    {p.assignedPm.fullName ?? p.assignedPm.email}
                  </span>
                </div>
              )}

              <div className="mt-4 flex gap-4 border-t border-card-border pt-3 text-xs text-muted">
                <span className="flex items-center gap-1">
                  <span className="font-semibold text-zinc-700">{p._count.baselines}</span> baselines
                </span>
                <span className="flex items-center gap-1">
                  <span className="font-semibold text-zinc-700">{p._count.changes}</span> changes
                </span>
                <span className="flex items-center gap-1">
                  <span className="font-semibold text-zinc-700">{p._count.invoices}</span> invoices
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
