import type { Step } from "react-joyride";

/**
 * Two-stage onboarding tour, versioned `tour_v1_*`.
 *
 *   overviewSteps  → fires on /programs (4 steps): outcome-led welcome →
 *                    workspace orientation → how the loop works (formatted
 *                    list) → spotlight + New Program.
 *
 *   programSteps   → fires on any /programs/:id/* subroute (4 steps).
 *                    Anchored on sidebar PROGRAM_NAV items so the spotlights
 *                    work from cockpit, baseline, changes — anywhere — and
 *                    don't depend on data-fetched cards mounting first.
 *
 * Step `content` is JSX so we can ship real <ol>/<p> formatting instead of
 * Joyride flattening a multi-line template literal into one paragraph.
 */

const SHARED = {
  disableBeacon: true,
  spotlightClicks: false,
  hideCloseButton: false,
} as const;

export const overviewSteps: Step[] = [
  // 1. Welcome — outcome-led, governance framing
  {
    ...SHARED,
    target: "body",
    placement: "center",
    title: "Welcome to CGT Sync",
    content: (
      <div className="space-y-2.5">
        <p>
          The <strong>governance layer</strong> for outsourced Cell &amp; Gene
          Therapy programs.
        </p>
        <p>
          We align SOW scope, execution decisions, and invoices into{" "}
          <em>one auditable record</em> — so scope variance is caught before
          approvals, disputes drop, and your teams stay in lockstep.
        </p>
        <p className="text-sm text-zinc-500">
          Let&apos;s get you set up in 60 seconds.
        </p>
      </div>
    ),
  },

  // 2. Workspace — re-framed (was "control panel" — wrong frame at zero state)
  {
    ...SHARED,
    target: '[data-tour="sidebar-overview"]',
    placement: "right",
    title: "Your workspace lives here",
    content: (
      <p>
        All your CDMO programs and the audit trail across them. We&apos;ll add
        per-program navigation here once you create your first one.
      </p>
    ),
  },

  // 3. How CGT Sync works — proper ordered list, scannable
  {
    ...SHARED,
    target: "body",
    placement: "center",
    title: "How CGT Sync works",
    content: (
      <div className="space-y-3">
        <p>Inside each program, the rhythm is simple:</p>
        <ol className="ml-4 list-decimal space-y-2 text-sm">
          <li>
            <strong>Upload your SOW</strong> — we extract scope, deliverables,
            and commercial terms automatically.
          </li>
          <li>
            <strong>Lock the baseline</strong> — your commercial source of
            truth.
          </li>
          <li>
            <strong>Log changes as they happen</strong> — auto-matched to the
            baseline, with cost &amp; timeline impact estimated.
          </li>
          <li>
            <strong>Reconcile invoices</strong> — every line matched against
            baseline and approved changes; mismatches flagged for dispute.
          </li>
        </ol>
        <p className="text-sm text-zinc-500">
          I&apos;ll walk you through each step inside your first program.
        </p>
      </div>
    ),
  },

  // 4. Spotlight + New Program — natural transition to Stage 2
  {
    ...SHARED,
    target: '[data-tour="new-program-btn"]',
    placement: "bottom",
    title: "Start here",
    content: (
      <p>
        Click <strong>+ New Program</strong> to create your first one. I&apos;ll
        pick the tour back up the moment you&apos;re inside.
      </p>
    ),
  },
];

export const programSteps: Step[] = [
  {
    ...SHARED,
    target: '[data-tour="nav-baseline"]',
    placement: "right",
    title: "Step 1 — Upload your SOW & lock the baseline",
    content: (
      <p>
        Click <strong>Baseline Truth</strong>. Drop your SOW — we extract scope,
        pricing, and commercial terms in seconds. Review and lock it; that
        becomes your commercial source of truth.
      </p>
    ),
  },
  {
    ...SHARED,
    target: '[data-tour="nav-changes"]',
    placement: "right",
    title: "Step 2 — Log changes as they happen",
    content: (
      <p>
        When the CDMO sends a scope change (email, call, doc), log it under{" "}
        <strong>Changes</strong>. We auto-match to your baseline and estimate
        cost + timeline impact.
      </p>
    ),
  },
  {
    ...SHARED,
    target: '[data-tour="nav-invoices"]',
    placement: "right",
    title: "Step 3 — Reconcile invoices",
    content: (
      <p>
        Upload incoming invoices under <strong>Invoices</strong>. We line-match
        every charge against your baseline and approved changes — anything off
        is flagged with the supporting evidence packaged for dispute.
      </p>
    ),
  },
  {
    ...SHARED,
    target: "body",
    placement: "center",
    title: "That's the loop",
    content: (
      <div className="space-y-2.5">
        <p>
          <strong>SOW → baseline → changes → invoices.</strong>
        </p>
        <p>
          Run it cleanly each cycle and you catch surprises <em>before</em>{" "}
          they become disputes. The audit trail builds itself.
        </p>
        <p className="text-sm text-zinc-500">
          Restart this tour anytime from <strong>Restart Tour</strong> at the
          bottom of the sidebar.
        </p>
      </div>
    ),
  },
];

export type TourStage = "overview" | "program";

export function stepsForStage(stage: TourStage): Step[] {
  return stage === "overview" ? overviewSteps : programSteps;
}
