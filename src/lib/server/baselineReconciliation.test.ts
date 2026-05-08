import { describe, expect, it } from "vitest";
import {
  reconcileBaseline,
  selectPrimaryStatedTotal,
  type ReconciliationClause,
  type StatedTotal,
} from "./baselineReconciliation";

function clause(
  overrides: Partial<ReconciliationClause> & { value: number; quantity?: number },
): ReconciliationClause {
  return {
    type: "PRICING",
    isOptional: false,
    scopeTier: null,
    quantity: overrides.quantity ?? 1,
    ...overrides,
  };
}

function total(
  label: string,
  value: number,
  extras: Partial<StatedTotal> = {},
): StatedTotal {
  return {
    label,
    value,
    excerpt: "stated total",
    page: 1,
    confidence: 0.95,
    ...extras,
  };
}

describe("selectPrimaryStatedTotal", () => {
  it("returns empty for empty input", () => {
    expect(selectPrimaryStatedTotal([])).toEqual([]);
  });

  it("preserves an explicit isPrimary marker", () => {
    const r = selectPrimaryStatedTotal([
      total("A", 100, { isPrimary: false }),
      total("B", 200, { isPrimary: true }),
      total("C", 5000, { isPrimary: false }),
    ]);
    expect(r.find((t) => t.isPrimary)?.label).toBe("B");
  });

  it("falls back to label match when no explicit primary", () => {
    const r = selectPrimaryStatedTotal([
      total("Total Estimated Tech Transfer Price", 2_484_200),
      total("Total Estimated Price after Discount", 2_820_000),
      total("Total Estimated Price", 3_105_600),
    ]);
    expect(r.find((t) => t.isPrimary)?.label).toBe(
      "Total Estimated Price after Discount",
    );
  });

  it("falls back to largest absolute value when no label matches", () => {
    const r = selectPrimaryStatedTotal([
      total("Phase 1", 100_000),
      total("Phase 2", 500_000),
      total("Phase 3", 250_000),
    ]);
    expect(r.find((t) => t.isPrimary)?.label).toBe("Phase 2");
  });
});

describe("reconcileBaseline", () => {
  it("returns null primary when statedTotals is missing", () => {
    const r = reconcileBaseline([clause({ value: 100 })], null);
    expect(r.primary).toBeNull();
    expect(r.hasMismatch).toBe(false);
  });

  it("returns null primary when statedTotals is empty", () => {
    const r = reconcileBaseline([clause({ value: 100 })], []);
    expect(r.primary).toBeNull();
  });

  it("matches a single qty=1 clause against a single primary stated total", () => {
    const r = reconcileBaseline(
      [clause({ value: 285_000 })],
      [total("Total", 285_000, { isPrimary: true })],
    );
    expect(r.primary?.status).toBe("MATCH");
    expect(r.primary?.computedValue).toBe(285_000);
    expect(r.secondary).toEqual([]);
  });

  it("applies quantity 2 to engineering run unit price", () => {
    const r = reconcileBaseline(
      [clause({ value: 169_100, quantity: 2 })],
      [total("Total", 338_200, { isPrimary: true })],
    );
    expect(r.primary?.status).toBe("MATCH");
    expect(r.primary?.computedValue).toBe(338_200);
  });

  it("excludes optional clauses from the sum", () => {
    const r = reconcileBaseline(
      [
        clause({ value: 100_000 }),
        clause({ value: 50_000, isOptional: true }),
      ],
      [total("Total", 100_000, { isPrimary: true })],
    );
    expect(r.primary?.status).toBe("MATCH");
    expect(r.primary?.computedValue).toBe(100_000);
  });

  it("includes negative-value discount clauses in the sum", () => {
    const r = reconcileBaseline(
      [
        clause({ value: 3_020_000 }),
        clause({ value: -200_000 }), // executive discount
      ],
      [total("After Discount", 2_820_000, { isPrimary: true })],
    );
    expect(r.primary?.status).toBe("MATCH");
    expect(r.primary?.computedValue).toBe(2_820_000);
  });

  it("reconciles a primary plus two scope-tier secondaries independently", () => {
    const r = reconcileBaseline(
      [
        clause({ value: 1_000_000, scopeTier: "Tech Transfer" }),
        clause({ value: 500_000, scopeTier: "Tech Transfer" }),
        clause({ value: 800_000, scopeTier: "GMP Manufacturing" }),
      ],
      [
        total("Tech Transfer", 1_500_000, { scopeTier: "Tech Transfer" }),
        total("GMP Manufacturing", 800_000, { scopeTier: "GMP Manufacturing" }),
        total("Grand Total", 2_300_000, { isPrimary: true }),
      ],
    );
    expect(r.primary?.label).toBe("Grand Total");
    expect(r.primary?.status).toBe("MATCH");
    expect(r.secondary).toHaveLength(2);
    expect(r.secondary.every((s) => s.status === "MATCH")).toBe(true);
  });

  it("greens the headline even when a secondary mismatches", () => {
    const r = reconcileBaseline(
      [
        clause({ value: 1_000_000, scopeTier: "Tech Transfer" }),
        clause({ value: 800_000, scopeTier: "GMP Manufacturing" }),
      ],
      [
        // Stated tier total is wrong by $100k — clear mismatch — but the
        // grand total still matches, so the headline must stay green.
        total("Tech Transfer", 900_000, { scopeTier: "Tech Transfer" }),
        total("Grand Total", 1_800_000, { isPrimary: true }),
      ],
    );
    expect(r.hasMismatch).toBe(false);
    expect(r.hasSecondaryMismatch).toBe(true);
    expect(r.primary?.status).toBe("MATCH");
  });

  it("fires the underflow guard when document-wide pricing exceeds the primary by > max($1000, 2%)", () => {
    const r = reconcileBaseline(
      [
        // Primary "Total" is supposed to be 100k, but the document contains
        // 200k of pricing — likely because some line was wrongly marked as
        // contributing or because optional flags are missing.
        clause({ value: 100_000 }),
        clause({ value: 100_000 }),
      ],
      [total("Total", 100_000, { isPrimary: true })],
    );
    expect(r.primary?.status).toBe("MISMATCH");
    expect(r.primary?.note).toMatch(/over-marking of optional/i);
    expect(r.primary?.computedValue).toBe(200_000);
  });

  it("does not fire the underflow guard when primary has a scopeTier", () => {
    const r = reconcileBaseline(
      [
        clause({ value: 100_000, scopeTier: "Phase 1" }),
        clause({ value: 200_000, scopeTier: "Phase 2" }),
      ],
      [total("Phase 1", 100_000, { scopeTier: "Phase 1", isPrimary: true })],
    );
    // Even though doc-wide spend ($300k) > primary ($100k), this is not a
    // grand-total reconciliation, so the guard must stay off.
    expect(r.primary?.status).toBe("MATCH");
  });

  it("respects the $1000 floor on the underflow guard", () => {
    // Small SOW: stated $50k, computed $50,500. The underflow guard's
    // tolerance on a $50k stated value is max($1000, 2% × $50k) = $1000, so a
    // $500 over-shoot does NOT fire the guard. The note must be absent. The
    // standalone drift classifier may still flag it (max($100, 0.5% × $50k)
    // = $250 threshold, so $500 falls into MISMATCH), but that's the regular
    // delta path — not the underflow-guard path we're testing here.
    const r = reconcileBaseline(
      [clause({ value: 50_500 })],
      [total("Total", 50_000, { isPrimary: true })],
    );
    expect(r.primary?.note).toBeUndefined();
  });

  it("auto-selects the after-discount label as primary when none is flagged", () => {
    const r = reconcileBaseline(
      [
        clause({ value: 3_020_000 }),
        clause({ value: -200_000 }),
      ],
      [
        total("Total Estimated Price", 3_020_000),
        total("Total Estimated Price after Discount", 2_820_000),
      ],
    );
    expect(r.primary?.label).toBe("Total Estimated Price after Discount");
    expect(r.primary?.status).toBe("MATCH");
  });

  it("applies the garbage-primary guard when auto-selected primary covers <50% of pricing footprint", () => {
    // Auto-selection picks the largest stated total. If that's still tiny
    // relative to extracted pricing, the LLM probably hallucinated.
    const r = reconcileBaseline(
      [
        clause({ value: 1_000_000 }),
        clause({ value: 1_000_000 }),
      ],
      [
        total("Deposit", 50_000),
        total("Reservation", 25_000),
      ],
    );
    expect(r.primary).toBeNull();
    expect(r.hasMismatch).toBe(false);
  });

  it("honors an explicit isPrimary even on a small total (skips garbage guard)", () => {
    const r = reconcileBaseline(
      [
        clause({ value: 1_000_000 }),
        clause({ value: 1_000_000 }),
      ],
      [
        total("First Milestone Payment", 50_000, { isPrimary: true }),
      ],
    );
    expect(r.primary).not.toBeNull();
    expect(r.primary?.label).toBe("First Milestone Payment");
  });

  it("classifies $0.50 delta as MATCH (within $1 tolerance)", () => {
    const r = reconcileBaseline(
      [clause({ value: 100_000.5 })],
      [total("Total", 100_000, { isPrimary: true })],
    );
    expect(r.primary?.status).toBe("MATCH");
  });

  it("classifies $200 delta on $300k stated as MINOR_DRIFT", () => {
    const r = reconcileBaseline(
      [clause({ value: 300_200 })],
      [total("Total", 300_000, { isPrimary: true })],
    );
    expect(r.primary?.status).toBe("MINOR_DRIFT");
  });

  it("classifies $50,000 delta as MISMATCH", () => {
    const r = reconcileBaseline(
      [clause({ value: 250_000 })],
      [total("Total", 300_000, { isPrimary: true })],
    );
    expect(r.primary?.status).toBe("MISMATCH");
  });

  it("simulates the Ernexa SOW end-to-end", () => {
    // 5.2 DS Engineering Run: $169,100/run × 2 runs       = $338,200
    // 5.3 DP Engineering Run: $82,300/run  × 2 runs       = $164,600
    // 5.2 Suite Fees:         $231,700/run × 2 runs       = $463,400
    // 5.3 Suite Fees:         $123,300/run × 2 runs       = $246,600
    // PM Monthly Fee (TT):    $7,500/mo    × 9 months     = $67,500
    // —— Tech Transfer subtotal:                            $1,280,300 (illustrative;
    //                                                       the SOW's actual TT subtotal
    //                                                       includes more line items
    //                                                       totaling $2,484,200)
    // For this test we use simplified numbers that hit the $2,820,000 after-discount
    // primary while still exercising quantity > 1 and a negative discount line.
    const clauses: ReconciliationClause[] = [
      { value: 169_100, quantity: 2, type: "PRICING", isOptional: false, scopeTier: "Tech Transfer" },
      { value: 82_300, quantity: 2, type: "PRICING", isOptional: false, scopeTier: "Tech Transfer" },
      { value: 231_700, quantity: 2, type: "PRICING", isOptional: false, scopeTier: "Tech Transfer" },
      { value: 123_300, quantity: 2, type: "PRICING", isOptional: false, scopeTier: "Tech Transfer" },
      { value: 7_500, quantity: 11, type: "PRICING", isOptional: false, scopeTier: null },
      // GMP runs (single quantity each)
      { value: 350_000, quantity: 1, type: "PRICING", isOptional: false, scopeTier: "GMP Manufacturing" },
      { value: 350_000, quantity: 1, type: "PRICING", isOptional: false, scopeTier: "GMP Manufacturing" },
      // Stand-in "filler" scope items so that the totals line up; in the real
      // SOW these are additional Tech Transfer items.
      { value: 1_024_700, quantity: 1, type: "PRICING", isOptional: false, scopeTier: "Tech Transfer" },
      // Discount
      { value: -200_000, quantity: 1, type: "PRICING", isOptional: false, scopeTier: null },
      // Optional items — should be excluded
      { value: 75_000, quantity: 1, type: "PRICING", isOptional: true, scopeTier: null },
      { value: 200_000, quantity: 1, type: "PRICING", isOptional: true, scopeTier: null },
    ];

    const statedTotals: StatedTotal[] = [
      total("Total Estimated Tech Transfer Price", 2_484_200, { scopeTier: "Tech Transfer" }),
      total("Total Estimated Price", 3_020_000),
      total("Total Estimated Price after Discount", 2_820_000, { isPrimary: true }),
    ];

    const r = reconcileBaseline(clauses, statedTotals);
    expect(r.primary?.label).toBe("Total Estimated Price after Discount");
    expect(r.primary?.computedValue).toBe(2_820_000);
    expect(r.primary?.status).toBe("MATCH");
    expect(r.hasMismatch).toBe(false);
  });
});
