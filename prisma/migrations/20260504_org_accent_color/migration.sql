-- Phase A2: per-tenant accent color
-- Additive: no backfill needed; NULL means "use default brand color"
ALTER TABLE "organizations" ADD COLUMN "accent_color" TEXT;
