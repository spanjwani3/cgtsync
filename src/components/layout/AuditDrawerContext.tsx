"use client";

import { createContext, useContext, useState, useCallback } from "react";

interface AuditDrawerContextValue {
  isOpen: boolean;
  toggle: () => void;
  open: () => void;
  close: () => void;
}

const AuditDrawerContext = createContext<AuditDrawerContextValue>({
  isOpen: false,
  toggle: () => {},
  open: () => {},
  close: () => {},
});

export function useAuditDrawer() {
  return useContext(AuditDrawerContext);
}

export function AuditDrawerProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  return (
    <AuditDrawerContext.Provider value={{ isOpen, toggle, open, close }}>
      {children}
    </AuditDrawerContext.Provider>
  );
}
