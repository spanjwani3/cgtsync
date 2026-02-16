"use client";

import { createContext, useContext, useState, useCallback } from "react";

interface CurrentProgram {
  id: string;
  name: string;
  molecule?: string | null;
}

interface ProgramContextValue {
  currentProgram: CurrentProgram | null;
  setCurrentProgram: (program: CurrentProgram | null) => void;
}

const ProgramContext = createContext<ProgramContextValue>({
  currentProgram: null,
  setCurrentProgram: () => {},
});

export function useProgramContext() {
  return useContext(ProgramContext);
}

export function ProgramProvider({ children }: { children: React.ReactNode }) {
  const [currentProgram, setCurrentProgramState] = useState<CurrentProgram | null>(null);

  const setCurrentProgram = useCallback((program: CurrentProgram | null) => {
    setCurrentProgramState(program);
  }, []);

  return (
    <ProgramContext.Provider value={{ currentProgram, setCurrentProgram }}>
      {children}
    </ProgramContext.Provider>
  );
}
