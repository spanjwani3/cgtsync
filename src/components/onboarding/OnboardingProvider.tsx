"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  overviewSteps,
  programSteps,
  type TourStage,
} from "@/lib/onboarding/tourSteps";

const Tour = dynamic(() => import("./Tour"), { ssr: false });

export interface OnboardingState {
  tour_v1_overview_completed_at?: string | null;
  tour_v1_overview_dismissed_at?: string | null;
  tour_v1_overview_remind_at?: string | null;
  tour_v1_program_completed_at?: string | null;
  tour_v1_program_dismissed_at?: string | null;
  tour_v1_program_remind_at?: string | null;
}

interface Props {
  initialState: OnboardingState;
  children: React.ReactNode;
}

const OVERVIEW_PATH_REGEX = /^\/programs\/?$/;
const COCKPIT_PATH_REGEX = /^\/programs\/[^/]+\/cockpit\/?$/;

function shouldFireStage(
  stage: TourStage,
  state: OnboardingState,
  now: number,
): boolean {
  const completed = state[`tour_v1_${stage}_completed_at`];
  const dismissed = state[`tour_v1_${stage}_dismissed_at`];
  const remind = state[`tour_v1_${stage}_remind_at`];

  if (completed) return false;
  if (dismissed) return false;
  if (remind) {
    const remindMs = Date.parse(remind);
    if (!Number.isNaN(remindMs) && remindMs > now) return false;
  }
  return true;
}

export default function OnboardingProvider({ initialState, children }: Props) {
  const pathname = usePathname();
  const [state, setState] = useState<OnboardingState>(initialState);
  const [activeStage, setActiveStage] = useState<TourStage | null>(null);

  // Decide whether either stage should fire for the current route.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const now = Date.now();

    if (
      OVERVIEW_PATH_REGEX.test(pathname ?? "") &&
      shouldFireStage("overview", state, now)
    ) {
      // Tiny delay so anchors mount before Joyride scans for them.
      const t = setTimeout(() => setActiveStage("overview"), 400);
      return () => clearTimeout(t);
    }

    if (
      COCKPIT_PATH_REGEX.test(pathname ?? "") &&
      shouldFireStage("program", state, now)
    ) {
      // Cockpit-side cards (Truth Status, Change Velocity, Invoice Health)
      // mount slightly later than the page itself — give them a beat before
      // Joyride scans for the anchors.
      const t = setTimeout(() => setActiveStage("program"), 700);
      return () => clearTimeout(t);
    }

    setActiveStage(null);
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

  const onFinished = (stage: TourStage) => {
    setActiveStage(null);
    void persist(
      `tour_v1_${stage}_completed_at` as keyof OnboardingState,
      new Date().toISOString(),
    );
  };

  const onSkipped = (stage: TourStage) => {
    setActiveStage(null);
    void persist(
      `tour_v1_${stage}_dismissed_at` as keyof OnboardingState,
      new Date().toISOString(),
    );
  };

  const steps = useMemo(() => {
    if (activeStage === "overview") return overviewSteps;
    if (activeStage === "program") return programSteps;
    return [];
  }, [activeStage]);

  return (
    <>
      {children}
      {activeStage && (
        <Tour
          steps={steps}
          run={true}
          resetKey={activeStage}
          onFinished={() => onFinished(activeStage)}
          onSkipped={() => onSkipped(activeStage)}
        />
      )}
    </>
  );
}
