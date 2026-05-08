/**
 * Baseline reconciliation — compares the sum of extracted PRICING clauses
 * (value × quantity, excluding optional items) against the stated totals
 * extracted from the SOW. Drives the green/amber banner on the baseline review
 * UI and the confirm page.
 *
 * Pure functions, no I/O. Computed on read so edits to clauses always produce
 * a fresh reconciliation status.
 */

const MATCH_TOLERANCE_DOLLARS = 1;
const MINOR_DRIFT_FLOOR_DOLLARS = 100;
const MINOR_DRIFT_PCT = 0.005;

const UNDERFLOW_GUARD_FLOOR_DOLLARS = 1000;
const UNDERFLOW_GUARD_PCT = 0.02;

const GARBAGE_PRIMARY_FOOTPRINT_RATIO = 0.5;

const PRIMARY_LABEL_PATTERN = /after\s*discount|final|signed|grand\s*total/i;

export interface StatedTotal {
  label: string;
  value: number;
  scopeTier?: string | null;
  isPrimary?: boolean | null;
  excerpt?: string;
  page?: number | null;
  confidence?: number;
}

export interface ReconciliationClause {
  value: number | null;
  quantity: number;
  isOptional: boolean;
  scopeTier: string | null;
  type: string;
  unit?: string | null;
}

export type ReconciliationStatus = "MATCH" | "MINOR_DRIFT" | "MISMATCH";

export interface ReconciliationLine {
  label: string;
  scopeTier: string | null;
  statedValue: number;
  computedValue: number;
  delta: number;
  status: ReconciliationStatus;
  isPrimary: boolean;
  note?: string;
}

export interface ReconciliationResult {
  primary: ReconciliationLine | null;
  secondary: ReconciliationLine[];
  hasMismatch: boolean;
  hasSecondaryMismatch: boolean;
}

/**
 * Pick exactly one stated total as the primary reconciliation target.
 *
 * Preference order:
 *   1. An entry already flagged isPrimary by the LLM.
 *   2. An entry whose label matches "after discount", "final", "signed", or
 *      "grand total".
 *   3. The entry with the largest absolute value.
 *   4. The last entry.
 *
 * Returns the input array with isPrimary normalized so exactly one entry is
 * primary. Empty input returns empty.
 */
export function selectPrimaryStatedTotal(totals: StatedTotal[]): StatedTotal[] {
  if (totals.length === 0) return [];

  const explicitPrimaryIdx = totals.findIndex((t) => t.isPrimary === true);
  let primaryIdx = explicitPrimaryIdx;

  if (primaryIdx < 0) {
    primaryIdx = totals.findIndex((t) => PRIMARY_LABEL_PATTERN.test(t.label));
  }

  if (primaryIdx < 0) {
    let maxIdx = 0;
    let maxAbs = Math.abs(totals[0].value);
    for (let i = 1; i < totals.length; i++) {
      const a = Math.abs(totals[i].value);
      if (a > maxAbs) {
        maxAbs = a;
        maxIdx = i;
      }
    }
    primaryIdx = maxIdx;
  }

  return totals.map((t, i) => ({ ...t, isPrimary: i === primaryIdx }));
}

/**
 * Decide whether a PRICING clause's unit represents a dollar amount that
 * should contribute to a sum. We include the line if its unit is empty or
 * looks like a USD-denominated unit ("USD", "USD/run", "USD/month", "$/kg",
 * etc.). We skip non-monetary units (most importantly "%", which a markup
 * line carries with a face value like 15 — summing that as $15 silently
 * skews totals).
 */
function isMonetaryUnit(unit: string | null | undefined): boolean {
  if (unit == null) return true;
  const trimmed = unit.trim();
  if (trimmed === "") return true;
  if (trimmed.includes("$")) return true;
  if (/usd/i.test(trimmed)) return true;
  return false;
}

function sumPricing(
  clauses: ReconciliationClause[],
  scopeTier: string | null,
): number {
  let sum = 0;
  for (const c of clauses) {
    if (c.isOptional) continue;
    if (c.type !== "PRICING") continue;
    if (scopeTier !== null && c.scopeTier !== scopeTier) continue;
    if (c.value == null) continue;
    if (!isMonetaryUnit(c.unit ?? null)) continue;
    sum += c.value * (c.quantity ?? 1);
  }
  return sum;
}

/**
 * Total contracted value of a baseline: sum of (value × quantity) over all
 * non-optional, monetary-unit PRICING clauses. This is the headline number
 * shown to users — kept in this module so the baseline review, the confirm
 * page, the impact summary, and any future surface all agree on the math.
 */
export function computeContractedTotal(clauses: ReconciliationClause[]): number {
  return sumPricing(clauses, null);
}

function classifyDelta(delta: number, stated: number): ReconciliationStatus {
  const abs = Math.abs(delta);
  if (abs < MATCH_TOLERANCE_DOLLARS) return "MATCH";
  const driftThreshold = Math.max(
    MINOR_DRIFT_FLOOR_DOLLARS,
    Math.abs(stated) * MINOR_DRIFT_PCT,
  );
  if (abs < driftThreshold) return "MINOR_DRIFT";
  return "MISMATCH";
}

/**
 * Reconcile extracted clauses against stated totals from the SOW.
 *
 * - Primary line drives the banner (signed contract value).
 * - Secondary lines (sub-tier totals) reconcile independently and surface as
 *   a softer disclosure under the primary banner; they don't flip the
 *   headline color.
 * - Underflow guard: if the document contains more non-optional pricing than
 *   the primary stated value claims (beyond max($1000, 2%)), we force the
 *   primary into MISMATCH with a note. Only runs when primary is a grand
 *   total (scopeTier === null) — sub-tier primaries don't compare against
 *   document-wide spend.
 * - Garbage-primary guard: when the LLM didn't explicitly mark a primary, the
 *   auto-selected primary must cover at least 50% of the document's pricing
 *   footprint. Otherwise we return primary: null (no banner) rather than show
 *   a meaningless green check on a hallucinated total.
 */
export function reconcileBaseline(
  clauses: ReconciliationClause[],
  statedTotals: StatedTotal[] | null | undefined,
): ReconciliationResult {
  if (!statedTotals || statedTotals.length === 0) {
    return { primary: null, secondary: [], hasMismatch: false, hasSecondaryMismatch: false };
  }

  const hadExplicitPrimary = statedTotals.some((t) => t.isPrimary === true);
  const normalized = selectPrimaryStatedTotal(statedTotals);
  const primaryTotal = normalized.find((t) => t.isPrimary) ?? null;

  const totalPricingFootprint = sumPricing(clauses, null);

  if (
    primaryTotal &&
    !hadExplicitPrimary &&
    totalPricingFootprint > 0 &&
    Math.abs(primaryTotal.value) <
      totalPricingFootprint * GARBAGE_PRIMARY_FOOTPRINT_RATIO
  ) {
    return {
      primary: null,
      secondary: [],
      hasMismatch: false,
      hasSecondaryMismatch: false,
    };
  }

  const buildLine = (t: StatedTotal): ReconciliationLine => {
    const tier = t.scopeTier ?? null;
    const computed = sumPricing(clauses, tier);
    const delta = computed - t.value;
    return {
      label: t.label,
      scopeTier: tier,
      statedValue: t.value,
      computedValue: computed,
      delta,
      status: classifyDelta(delta, t.value),
      isPrimary: !!t.isPrimary,
    };
  };

  const primaryLine = primaryTotal ? buildLine(primaryTotal) : null;

  if (primaryLine && primaryLine.scopeTier === null) {
    const tolerance = Math.max(
      UNDERFLOW_GUARD_FLOOR_DOLLARS,
      Math.abs(primaryLine.statedValue) * UNDERFLOW_GUARD_PCT,
    );
    if (totalPricingFootprint > primaryLine.statedValue + tolerance) {
      primaryLine.status = "MISMATCH";
      primaryLine.computedValue = totalPricingFootprint;
      primaryLine.delta = totalPricingFootprint - primaryLine.statedValue;
      primaryLine.note =
        "More pricing extracted than signed total — possible over-marking of optional items.";
    }
  }

  const secondary = normalized.filter((t) => !t.isPrimary).map(buildLine);

  return {
    primary: primaryLine,
    secondary,
    hasMismatch: primaryLine?.status === "MISMATCH",
    hasSecondaryMismatch: secondary.some((s) => s.status === "MISMATCH"),
  };
}
