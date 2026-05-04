import type { Step } from "react-joyride";

/**
 * Two-stage onboarding tour, versioned `tour_v1_*`.
 *
 *   overviewSteps  → fires on /programs (4 steps).
 *   programSteps   → fires on any /programs/:id/* subroute (5 steps).
 *
 * Stage 2 anchors on sidebar PROGRAM_NAV items. The provider polls for
 * the first anchor before launching, so the tour waits for ProgramContext
 * to populate.
 */

const SHARED = {
  disableBeacon: true,
  spotlightClicks: false,
  hideCloseButton: false,
} as const;

export const overviewSteps: Step[] = [
  // 1. Welcome — outcome-led, plain language
  {
    ...SHARED,
    target: "body",
    placement: "center",
    title: "Welcome to CGT Sync",
    content: (
      <div className="space-y-2.5">
        <p>
          CGT Sync keeps your outsourced Cell &amp; Gene Therapy programs on
          track — no invoice surprises, no scope creep, no disputes you
          didn&apos;t see coming.
        </p>
        <p>
          We line up your SOW, change orders, and invoices in one place, so
          anything that doesn&apos;t match gets flagged{" "}
          <em>before</em> it lands on a bill.
        </p>
        <p className="text-sm text-zinc-500">
          About 60 seconds to get oriented.
        </p>
      </div>
    ),
  },

  // 2. Workspace
  {
    ...SHARED,
    target: '[data-tour="sidebar-overview"]',
    placement: "right",
    title: "Your workspace lives here",
    content: (
      <p>
        Every CDMO program you run lives here, plus the audit trail across
        all of them. Create your first program and its menu drops in below.
      </p>
    ),
  },

  // 3. How CGT Sync works — scannable list
  {
    ...SHARED,
    target: "body",
    placement: "center",
    title: "How CGT Sync works",
    content: (
      <div className="space-y-3">
        <p>Inside each program, four moves:</p>
        <ol className="ml-4 list-decimal space-y-2 text-sm">
          <li>
            <strong>Upload your SOW</strong> — we pull out the scope,
            deliverables, and pricing for you.
          </li>
          <li>
            <strong>Lock the baseline</strong> — that&apos;s your source of
            truth for the whole program.
          </li>
          <li>
            <strong>Log changes as they come up</strong> — we match each one to
            the baseline and estimate the cost and time hit.
          </li>
          <li>
            <strong>Check incoming invoices</strong> — every line gets compared
            to the baseline and approved changes. Anything off is flagged.
          </li>
        </ol>
        <p className="text-sm text-zinc-500">
          I&apos;ll walk you through each move inside your first program.
        </p>
      </div>
    ),
  },

  // 4. Spotlight + New Program
  {
    ...SHARED,
    target: '[data-tour="new-program-btn"]',
    placement: "bottom",
    title: "Start here",
    content: (
      <p>
        Click <strong>+ New Program</strong> to create your first one.
        I&apos;ll pick the tour back up the moment you&apos;re inside.
      </p>
    ),
  },
];

export const programSteps: Step[] = [
  // 1. Baseline
  {
    ...SHARED,
    target: '[data-tour="nav-baseline"]',
    placement: "right",
    title: "Step 1 — Upload your SOW & lock the baseline",
    content: (
      <p>
        Click <strong>Baseline Truth</strong>. Drop your SOW in — we&apos;ll
        pull out the scope, deliverables, and pricing in seconds. Review what
        we found, then lock it. That&apos;s your source of truth from here on
        out.
      </p>
    ),
  },

  // 2. Changes
  {
    ...SHARED,
    target: '[data-tour="nav-changes"]',
    placement: "right",
    title: "Step 2 — Log changes as they happen",
    content: (
      <p>
        Anytime the CDMO asks for a scope change — by email, on a call, in a
        doc — log it under <strong>Change Events</strong>. We match it to your
        baseline and estimate the cost and timeline hit.
      </p>
    ),
  },

  // 3. Invoices / Reconciliation
  {
    ...SHARED,
    target: '[data-tour="nav-invoices"]',
    placement: "right",
    title: "Step 3 — Reconcile invoices",
    content: (
      <p>
        Drop incoming invoices into <strong>Reconciliation</strong>. We
        compare every line to your baseline and approved changes. Anything
        that doesn&apos;t match gets flagged, with the evidence packaged up
        to send back.
      </p>
    ),
  },

  // 4. Scope Monitor — system feature, not a user step
  {
    ...SHARED,
    target: '[data-tour="nav-scope"]',
    placement: "right",
    title: "Scope Monitor — running in the background",
    content: (
      <p>
        Once your data&apos;s flowing, we spot the patterns for you: charges
        creeping up cycle to cycle, change orders piling up around one
        milestone, spend pulling past your SOW. You catch it{" "}
        <em>before</em> it shows up on a bill.
      </p>
    ),
  },

  // 5. Closing — loop summary + sidebar map
  {
    ...SHARED,
    target: "body",
    placement: "center",
    title: "That's the loop",
    content: (
      <div className="space-y-3">
        <p>
          <strong>SOW → baseline → changes → invoices.</strong>
        </p>
        <p>
          Run this loop each cycle and you catch surprises before they become
          disputes.
        </p>
        <div className="space-y-1.5 text-sm">
          <p className="font-semibold">Also in your sidebar:</p>
          <ul className="ml-4 list-disc space-y-1 text-zinc-600">
            <li>
              <strong>Evidence Log</strong> — every doc and email, attached to
              the right line.
            </li>
            <li>
              <strong>Audit Log</strong> — who did what, when.
            </li>
            <li>
              <strong>Export Center</strong> — dispute kits, status reports,
              audit-ready exports.
            </li>
          </ul>
        </div>
        <p className="text-sm text-zinc-500">
          Restart anytime from <strong>Restart Tour</strong> at the bottom of
          the sidebar.
        </p>
      </div>
    ),
  },
];

export type TourStage = "overview" | "program";

export function stepsForStage(stage: TourStage): Step[] {
  return stage === "overview" ? overviewSteps : programSteps;
}
