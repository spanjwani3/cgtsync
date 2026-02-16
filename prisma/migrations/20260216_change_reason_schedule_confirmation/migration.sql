-- CreateEnum ChangeReasonCode
CREATE TYPE "ChangeReasonCode" AS ENUM ('SPONSOR_REQUEST', 'VENDOR_ERROR', 'MATERIAL_DELAY', 'REGULATORY_REQUIREMENT', 'OTHER');

-- CreateEnum ConfirmationMode
CREATE TYPE "ConfirmationMode" AS ENUM ('BILATERAL', 'SHADOW');

-- Add new values to ExtractionTargetType
ALTER TYPE "ExtractionTargetType" ADD VALUE 'CHANGE_TRANSCRIPT';
ALTER TYPE "ExtractionTargetType" ADD VALUE 'CHANGE_EMAIL';

-- Add new columns to changes table
ALTER TABLE "changes" ADD COLUMN "reason_code" "ChangeReasonCode";
ALTER TABLE "changes" ADD COLUMN "schedule_impact_days" INTEGER;
ALTER TABLE "changes" ADD COLUMN "confirmation_mode" "ConfirmationMode";
