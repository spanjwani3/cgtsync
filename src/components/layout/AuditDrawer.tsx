"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuditDrawer } from "./AuditDrawerContext";
import { useProgramContext } from "./ProgramContext";
import AuditEventRow, { type AuditEntry } from "@/components/audit/AuditEventRow";

export default function AuditDrawer() {
  const { isOpen, close } = useAuditDrawer();
  const { currentProgram } = useProgramContext();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const limit = 30;

  const fetchEntries = useCallback(async (newOffset: number) => {
    if (!currentProgram) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/gateway/audit?programId=${currentProgram.id}&limit=${limit}&offset=${newOffset}`);
      if (res.ok) {
        const data = await res.json();
        setEntries(newOffset === 0 ? data.entries : (prev: AuditEntry[]) => [...prev, ...data.entries]);
        setTotal(data.total);
        setOffset(newOffset);
      }
    } catch {
      // silently fail — audit is supplementary
    }
    setLoading(false);
  }, [currentProgram]);

  // Reload when drawer opens or program changes
  useEffect(() => {
    if (isOpen && currentProgram) {
      setEntries([]);
      setOffset(0);
      fetchEntries(0);
    }
  }, [isOpen, currentProgram, fetchEntries]);

  return (
    <>
      {/* Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/20 transition-opacity"
          onClick={close}
        />
      )}

      {/* Drawer */}
      <div
        className={`fixed inset-y-0 right-0 z-50 flex w-96 flex-col bg-white shadow-2xl transition-transform duration-300 ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex h-14 items-center justify-between border-b border-zinc-200 px-5">
          <div className="flex items-center gap-2">
            <svg className="h-4 w-4 text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <line x1="10" y1="9" x2="8" y2="9" />
            </svg>
            <h2 className="text-sm font-semibold text-zinc-900">Audit Log</h2>
            {total > 0 && (
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500">{total}</span>
            )}
          </div>
          <button
            onClick={close}
            className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {!currentProgram ? (
            <div className="flex flex-col items-center justify-center py-20 text-sm text-zinc-400">
              <svg className="mb-2 h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
              Select a program to view audit log
            </div>
          ) : entries.length === 0 && !loading ? (
            <div className="flex flex-col items-center justify-center py-20 text-sm text-zinc-400">
              <svg className="mb-2 h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="20 6 9 17 4 12" /></svg>
              No audit events yet
            </div>
          ) : (
            <div className="divide-y divide-zinc-100">
              {entries.map((entry) => (
                <AuditEventRow key={entry.id} entry={entry} />
              ))}
            </div>
          )}

          {/* Load more */}
          {entries.length < total && (
            <div className="px-5 py-3">
              <button
                onClick={() => fetchEntries(offset + limit)}
                disabled={loading}
                className="w-full rounded-lg border border-zinc-200 py-2 text-xs font-medium text-zinc-500 hover:bg-zinc-50 disabled:opacity-50"
              >
                {loading ? "Loading..." : `Load more (${total - entries.length} remaining)`}
              </button>
            </div>
          )}

          {loading && entries.length === 0 && (
            <div className="flex items-center justify-center py-12">
              <svg className="h-5 w-5 animate-spin text-zinc-400" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-zinc-200 px-5 py-3">
          <p className="text-[10px] text-zinc-400">
            Immutable event log · All actions recorded with IP and timestamp
          </p>
        </div>
      </div>
    </>
  );
}
