import type { Step } from "react-joyride";

/**
 * Single-stage onboarding tour. Fires once on first /programs visit and
 * gives the user the full mental model in five steps without requiring
 * any navigation. Center-modal steps describe the program loop conceptually
 * since the relevant DOM (cockpit, baseline) doesn't exist until the user
 * creates their first program.
 *
 * Versioned `tour_v1_*` so a future v2 fires fresh.
 */

const SHARED: Pick<Step, "disableBeacon" | "spotlightClicks" | "hideCloseButton"> = {
  disableBeacon: true,
  spotlightClicks: false,
  hideCloseButton: false,
};

export const tourSteps: Step[] = [
  {
    ...SHARED,
    target: "body",
    placement: "center",
    title: "Welcome to CGT Sync",
    content:
      "We're the change-control and reconciliation layer for your CDMO programs. SOWs in, baselines locked, every change documented, every invoice line-matched. Let's get you oriented in 60 seconds.",
  },
  {
    ...SHARED,
    target: '[data-tour="sidebar-overview"]',
    placement: "right",
    title: "This is your control panel",
    content:
      "Everything for your CDMO relationships lives here — programs, baselines, changes, invoices, audit trail.",
  },
  {
    ...SHARED,
    target: '[data-tour="new-program-btn"]',
    placement: "bottom",
    title: "Start with a program",
    content:
      "A program is one CDMO agreement. Click here to create your first one — you'll upload the SOW next.",
  },
  {
    ...SHARED,
    target: "body",
    placement: "center",
    title: "The loop, in four moves",
    content: `Once your program exists, the rhythm is simple:

  1. Upload your SOW — we extract scope, deliverables, and commercial terms automatically.
  2. Lock the baseline — that becomes your commercial source of truth.
  3. Log changes as they happen — we match each one to the baseline and estimate cost impact.
  4. Reconcile invoices — every line matched against baseline + approved changes; anything off gets flagged for dispute.`,
  },
  {
    ...SHARED,
    target: "body",
    placement: "center",
    title: "You're set",
    content:
      "Click “+ New Program” when you're ready. You can restart this tour anytime from the Help menu in the bottom-left of the sidebar.",
  },
];
