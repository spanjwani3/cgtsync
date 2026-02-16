"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { useProgramContext } from "./ProgramContext";

/**
 * Auto-fetch program and sync to sidebar context.
 * If programOverride is provided, uses that directly.
 * Otherwise, fetches from API using programId from URL params.
 */
export function useSyncProgram(programOverride?: { id: string; name: string; molecule?: string | null } | null) {
  const { programId } = useParams<{ programId: string }>();
  const { currentProgram, setCurrentProgram } = useProgramContext();

  useEffect(() => {
    if (programOverride) {
      setCurrentProgram(programOverride);
      return;
    }

    if (!programId) return;
    if (currentProgram?.id === programId) return;

    let cancelled = false;
    fetch(`/api/programs/${programId}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (cancelled || !data) return;
        const p = data.program ?? data;
        setCurrentProgram({ id: p.id, name: p.name, molecule: p.molecule ?? null });
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [programId, programOverride?.id]); // eslint-disable-line react-hooks/exhaustive-deps
}
