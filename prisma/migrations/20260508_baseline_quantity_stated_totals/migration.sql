-- Add per-clause quantity, optional flag, and scope tier so the extractor can
-- attach footnote-derived multipliers to line items. Add stated_totals JSON on
-- baselines so we can reconcile the computed sum against the SOW's contractual
-- numbers.
--
-- All columns are additive with safe defaults; no backfill required. quantity
-- defaults to 1 (matches today's implicit behavior on existing rows).

ALTER TABLE "baseline_clauses"
  ADD COLUMN "quantity"    numeric(14, 4) NOT NULL DEFAULT 1,
  ADD COLUMN "is_optional" boolean        NOT NULL DEFAULT false,
  ADD COLUMN "scope_tier"  text;

ALTER TABLE "baselines"
  ADD COLUMN "stated_totals" jsonb;
