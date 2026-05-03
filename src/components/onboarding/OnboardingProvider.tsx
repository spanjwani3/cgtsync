"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { tourSteps } from "@/lib/onboarding/tourSteps";

const Tour = dynamic(() => import("./Tour"), { ssr: false });

export interface OnboardingState {
  tour_v1_completed_at?: string | null;
  tour_v1_dismissed_at?: string | null;
  tour_v1_remind_at?: string | null;
}

interface Props {
  initialState: OnboardingState;
  children: React.ReactNode;
}

const TOUR_PATH_REGEX = /^\/programs\/?$/;

function shouldFire(state: OnboardingState, now: number): boolean {
  if (state.tour_v1_completed_at) return false;
  if (state.tour_v1_dismissed_at) return false;
  if (state.tour_v1_remind_at) {
    const remindMs = Date.parse(state.tour_v1_remind_at);
    if (!Number.isNaN(remindMs) && remindMs > now) return false;
  }
  return true;
}

export default function OnboardingProvider({ initialState, children }: Props) {
  const pathname = usePathname();
  const [state, setState] = useState<OnboardingState>(initialState);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (
      TOUR_PATH_REGEX.test(pathname ?? "") &&
      shouldFire(state, Date.now())
    ) {
      // Tiny delay so anchors mount before Joyride scans for them.
      const t = setTimeout(() => setRunning(true), 400);
      return () => clearTimeout(t);
    }
    setRunning(false);
  }, [pathname, state]);

  const persist = async (key: keyof OnboardingState, value: string | null) => {
    setState((prev) => ({ ...prev, [key]: value }));
    try {
      await fetch("/api/onboarding/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      });
    } catch {
      // Best-effort. Local state still suppresses re-fire this session.
    }
  };

  const onFinished = () => {
    setRunning(false);
    void persist("tour_v1_completed_at", new Date().toISOString());
  };

  const onSkipped = () => {
    setRunning(false);
    void persist("tour_v1_dismissed_at", new Date().toISOString());
  };

  return (
    <>
      {children}
      {running && (
        <Tour
          steps={tourSteps}
          run={true}
          onFinished={onFinished}
          onSkipped={onSkipped}
        />
      )}
    </>
  );
}
