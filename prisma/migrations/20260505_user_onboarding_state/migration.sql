-- Phase A3: per-user onboarding tour state
-- Additive: defaults to empty object; no backfill needed.
ALTER TABLE "users"
  ADD COLUMN "onboarding_state" JSONB NOT NULL DEFAULT '{}'::jsonb;
