import type { Step } from "react-joyride";

/**
 * Phase A3 onboarding tour content. Versioned `tour_v1_*` so future
 * iterations don't contaminate completion metrics for current users.
 *
 * Two stages:
 *  - overviewSteps  → fires on first /programs visit
 *  - programSteps   → fires on first /programs/:id/cockpit visit (after
 *                     overview is completed/dismissed AND a program exists)
 */

const SHARED: Pick<
  Step,
  "disableBeacon" | "spotlightClicks" | "hideCloseButton"
> = {
  disableBeacon: true,
  spotlightClicks: false,
  hideCloseButton: false,
};

export const overviewSteps: Step[] = [
  {
    ...SHARED,
    target: "body",
    placement: "center",
    title: "Welcome to CGT Sync",
    content:
      "Let's get you oriented in 60 seconds. CGT Sync is the change-control and reconciliation layer for your CDMO programs — SOWs in, baselines locked, every change documented, every invoice line-matched.",
  },
  {
    ...SHARED,
    target: '[data-tour="sidebar-overview"]',
    placement: "right",
    title: "This is your control panel",
    content:
      "Programs, baselines, changes, invoices — every artifact for your CDMO relationships lives here.",
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
    target: '[data-tour="sidebar-program-nav"]',
    placement: "right",
    title: "Then the loop runs",
    content:
      "Once a program exists, you'll have Changes, Invoices, and Audit views right here in the sidebar. We'll walk you through them when you open your first program.",
  },
  {
    ...SHARED,
    target: "body",
    placement: "center",
    title: "You're set",
    content:
      "That's the orientation. Create your first program when you're ready — and you can restart this tour anytime from the Help menu in the bottom-left.",
  },
];

export const programSteps: Step[] = [
  {
    ...SHARED,
    target: '[data-tour="sow-upload"]',
    placement: "bottom",
    title: "Step 1: Upload your SOW",
    content:
      "Drop your SOW here. We'll extract baseline scope, deliverables, pricing, and commercial terms automatically — no manual entry.",
  },
  {
    ...SHARED,
    target: '[data-tour="baseline-status"]',
    placement: "bottom",
    title: "Step 2: Lock the baseline",
    content:
      "Once you've reviewed the extracted clauses, lock the baseline. This becomes your commercial source of truth — every future change is measured against it.",
  },
  {
    ...SHARED,
    target: '[data-tour="changes-panel"]',
    placement: "left",
    title: "Step 3: Log changes as they happen",
    content:
      "When the CDMO emails you a scope change or you discuss one on a call, log it here. We'll match it to your baseline and estimate cost impact.",
  },
  {
    ...SHARED,
    target: '[data-tour="invoices-panel"]',
    placement: "left",
    title: "Step 4: Reconcile incoming invoices",
    content:
      "Upload invoices here. We'll line-match each charge to your baseline and approved changes — anything that doesn't line up gets flagged for dispute.",
  },
];

export type TourStage = "overview" | "program";

export function stepsForStage(stage: TourStage): Step[] {
  return stage === "overview" ? overviewSteps : programSteps;
}
