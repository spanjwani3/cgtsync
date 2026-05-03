import type { Step } from "react-joyride";

/**
 * Two-stage onboarding tour, versioned `tour_v1_*`.
 *
 *  - overviewSteps  → fires on /programs (5 steps): welcome → sidebar →
 *                     +New Program → preview the loop → "click + New
 *                     Program to start" (final step spotlights the button
 *                     so the user is naturally guided to act).
 *
 *  - programSteps   → fires on /programs/:id/cockpit (4 steps): SOW
 *                     upload framing → lock baseline → log changes →
 *                     reconcile invoices. All anchors live on the
 *                     cockpit page so Joyride finds every target.
 *
 * The "dummy-proof" property comes from: the final overview step nudges
 * the user to click +New Program → that creates a program → redirects
 * to /cockpit → program tour auto-fires. They never have to think about
 * "now go look at a program" — the natural flow does it for them.
 */

const SHARED: Pick<Step, "disableBeacon" | "spotlightClicks" | "hideCloseButton"> = {
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
    target: '[data-tour="sidebar-program-nav"]',
    placement: "right",
    title: "Program-level navigation appears here",
    content:
      "When you have a program selected, you'll see Cockpit, Baseline, Changes, Invoices, and the audit trail right here in the sidebar.",
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
  4. Reconcile invoices — every line matched against baseline + approved changes; anything off gets flagged for dispute.

I'll walk you through each one inside your first program.`,
  },
  {
    ...SHARED,
    target: '[data-tour="new-program-btn"]',
    placement: "bottom",
    title: "Start here",
    content:
      "Click “+ New Program” to create your first one. I'll pick the tour back up the moment you're inside.",
  },
];

export const programSteps: Step[] = [
  {
    ...SHARED,
    target: '[data-tour="baseline-status"]',
    placement: "bottom",
    title: "Step 1 — Upload your SOW",
    content:
      "Click this Truth Status card to open the baseline view. Drop your SOW or work order in there — we'll extract scope, deliverables, pricing, and commercial terms automatically.",
  },
  {
    ...SHARED,
    target: '[data-tour="baseline-status"]',
    placement: "bottom",
    title: "Step 2 — Lock the baseline",
    content:
      "Once you've reviewed the extracted clauses, lock the baseline from this card. That becomes your commercial source of truth — every future change is measured against it.",
  },
  {
    ...SHARED,
    target: '[data-tour="changes-panel"]',
    placement: "left",
    title: "Step 3 — Log changes as they happen",
    content:
      "When the CDMO emails you a scope change or you discuss one on a call, log it here. We'll match it to your baseline and estimate cost & timeline impact.",
  },
  {
    ...SHARED,
    target: '[data-tour="invoices-panel"]',
    placement: "left",
    title: "Step 4 — Reconcile invoices",
    content:
      "Upload incoming invoices here. We line-match each charge against your baseline and approved changes — anything that doesn't add up gets flagged for dispute, with the supporting evidence packaged automatically.",
  },
];

export type TourStage = "overview" | "program";

export function stepsForStage(stage: TourStage): Step[] {
  return stage === "overview" ? overviewSteps : programSteps;
}
