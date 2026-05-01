-- Add COUNTERED status to baseline and change enums
ALTER TYPE "BaselineStatus" ADD VALUE IF NOT EXISTS 'COUNTERED';
ALTER TYPE "ChangeStatus" ADD VALUE IF NOT EXISTS 'COUNTERED';

-- Add missing EventAction values for counter flow and clause deletion
ALTER TYPE "EventAction" ADD VALUE IF NOT EXISTS 'BASELINE_COUNTERED';
ALTER TYPE "EventAction" ADD VALUE IF NOT EXISTS 'CHANGE_COUNTERED';
ALTER TYPE "EventAction" ADD VALUE IF NOT EXISTS 'CLAUSE_DELETED';

-- Add counterparty_note column to changes and baselines
ALTER TABLE "changes" ADD COLUMN IF NOT EXISTS "counterparty_note" TEXT;
ALTER TABLE "baselines" ADD COLUMN IF NOT EXISTS "counterparty_note" TEXT;
