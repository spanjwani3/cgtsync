"use client";

import { useCallback } from "react";
import Joyride, { CallBackProps, STATUS, type Step } from "react-joyride";
import type { TourStage } from "@/lib/onboarding/tourSteps";

interface Props {
  steps: Step[];
  stage: TourStage;
  run: boolean;
  onFinished: () => void;
  onSkipped: () => void;
}

/**
 * Thin wrapper around react-joyride. Branded with CGT Sync blue.
 *
 * Imported via `next/dynamic({ ssr: false })` from OnboardingProvider —
 * react-joyride touches `window` on mount so SSR would crash.
 */
export default function Tour({ steps, stage, run, onFinished, onSkipped }: Props) {
  const handleCallback = useCallback(
    (data: CallBackProps) => {
      const { status } = data;
      if (status === STATUS.FINISHED) {
        onFinished();
      } else if (status === STATUS.SKIPPED) {
        onSkipped();
      }
    },
    [onFinished, onSkipped],
  );

  return (
    <Joyride
      key={stage}
      steps={steps}
      run={run}
      continuous
      showProgress
      showSkipButton
      scrollToFirstStep
      disableScrollParentFix
      callback={handleCallback}
      locale={{
        back: "Back",
        close: "Close",
        last: "Got it",
        next: "Next",
        skip: "Skip tour",
      }}
      styles={{
        options: {
          primaryColor: "#2563eb",
          textColor: "#1a2332",
          backgroundColor: "#ffffff",
          arrowColor: "#ffffff",
          overlayColor: "rgba(26, 35, 50, 0.55)",
          zIndex: 10000,
        },
        tooltip: {
          borderRadius: 12,
          padding: 20,
          boxShadow: "0 10px 30px rgba(0, 0, 0, 0.18)",
        },
        tooltipTitle: {
          fontSize: 16,
          fontWeight: 700,
          color: "#1a2332",
          marginBottom: 6,
        },
        tooltipContent: {
          fontSize: 14,
          color: "#475569",
          padding: 0,
          lineHeight: 1.5,
        },
        buttonNext: {
          backgroundColor: "#2563eb",
          borderRadius: 6,
          fontSize: 13,
          padding: "8px 14px",
        },
        buttonBack: {
          color: "#475569",
          fontSize: 13,
          marginRight: 8,
        },
        buttonSkip: {
          color: "#94a3b8",
          fontSize: 12,
        },
      }}
    />
  );
}
