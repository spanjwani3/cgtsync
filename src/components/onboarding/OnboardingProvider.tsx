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
// Match any program subroute (cockpit, baseline, changes, invoices, etc.) —
// Stage 2 anchors on sidebar PROGRAM_NAV items which are visible everywhere
// inside a program, so the tour fires reliably regardless of which subroute
// the user lands on.
const PROGRAM_SUBROUTE_REGEX = /^\/programs\/[^/]+\/[^/]+\/?$/;

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
      PROGRAM_SUBROUTE_REGEX.test(pathname ?? "") &&
      shouldFireStage("program", state, now)
    ) {
      // Sidebar PROGRAM_NAV items render only after the page client component
      // calls `setCurrentProgram` post-fetch, which happens later than the
      // first paint. Poll for the anchor before launching so Joyride doesn't
      // hit `error:target_not_found` and auto-skip through the steps.
      let cancelled = false;
      const start = Date.now();
      const TIMEOUT_MS = 6000;
      const POLL_MS = 100;

      const tryLaunch = () => {
        if (cancelled) return;
        const anchor = document.querySelector('[data-tour="nav-baseline"]');
        if (anchor) {
          setActiveStage("program");
          return;
        }
        if (Date.now() - start > TIMEOUT_MS) {
          // Anchor never appeared (program load failed, user-not-on-a-program
          // page, etc.). Skip this stage silently rather than firing a broken
          // tour.
          return;
        }
        setTimeout(tryLaunch, POLL_MS);
      };

      // Small initial delay matches Stage 1; lets the provider mount and the
      // sidebar's first paint complete before we start polling.
      const initial = setTimeout(tryLaunch, 200);
      return () => {
        cancelled = true;
        clearTimeout(initial);
      };
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
