-- Additive migration: creates extraction_jobs + commitment_terms tables and
-- the enums / EventAction values they depend on.
-- Runs against a prod DB that already has the 13-table baseline.

-- ============================================================
-- New enums
-- ============================================================

CREATE TYPE "ExtractionJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

CREATE TYPE "ExtractionTargetType" AS ENUM ('BASELINE', 'INVOICE', 'CHANGE_ORDER', 'TERMS');

CREATE TYPE "TermType" AS ENUM (
  'RESERVATION_FEE',
  'COMMITMENT_DATE',
  'PAYMENT_MILESTONE',
  'CANCELLATION_WINDOW',
  'PENALTY_RULE',
  'MATERIAL_ORDER_TRIGGER'
);

-- ============================================================
-- Extend EventAction enum (using final names directly)
-- ============================================================

ALTER TYPE "EventAction" ADD VALUE 'EXTRACTION_JOB_CREATED';
ALTER TYPE "EventAction" ADD VALUE 'EXTRACTION_JOB_SUCCEEDED';
ALTER TYPE "EventAction" ADD VALUE 'EXTRACTION_JOB_FAILED';
ALTER TYPE "EventAction" ADD VALUE 'EXTRACTION_JOB_APPLIED';
ALTER TYPE "EventAction" ADD VALUE 'TERM_CREATED';
ALTER TYPE "EventAction" ADD VALUE 'TERM_UPDATED';
ALTER TYPE "EventAction" ADD VALUE 'TERM_IMPORTED';

-- ============================================================
-- extraction_jobs table
-- ============================================================

CREATE TABLE "extraction_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "evidence_id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "target_type" "ExtractionTargetType" NOT NULL,
    "status" "ExtractionJobStatus" NOT NULL DEFAULT 'PENDING',
    "extracted_data" JSONB,
    "error_message" TEXT,
    "confidence" DECIMAL(3,2),
    "processing_time_ms" INTEGER,
    "tokens_used" INTEGER,
    "model_used" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "extraction_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "extraction_jobs_evidence_id_idx" ON "extraction_jobs"("evidence_id");
CREATE INDEX "extraction_jobs_program_id_status_idx" ON "extraction_jobs"("program_id", "status");
CREATE INDEX "extraction_jobs_program_id_created_at_idx" ON "extraction_jobs"("program_id", "created_at");

ALTER TABLE "extraction_jobs" ADD CONSTRAINT "extraction_jobs_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "evidences"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "extraction_jobs" ADD CONSTRAINT "extraction_jobs_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "extraction_jobs" ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- commitment_terms table
-- ============================================================

CREATE TABLE "commitment_terms" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "program_id" UUID NOT NULL,
    "evidence_id" UUID,
    "baseline_id" UUID,
    "term_type" "TermType" NOT NULL,
    "label" TEXT NOT NULL,
    "date_or_offset" TEXT,
    "deadline_at" TIMESTAMP(3),
    "cost_or_percent" TEXT,
    "conditions" TEXT,
    "excerpt" TEXT,
    "page" INTEGER,
    "confidence" DECIMAL(3,2),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commitment_terms_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "commitment_terms_program_id_deadline_at_idx" ON "commitment_terms"("program_id", "deadline_at");
CREATE INDEX "commitment_terms_program_id_term_type_idx" ON "commitment_terms"("program_id", "term_type");

ALTER TABLE "commitment_terms" ADD CONSTRAINT "commitment_terms_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "commitment_terms" ADD CONSTRAINT "commitment_terms_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "evidences"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "commitment_terms" ADD CONSTRAINT "commitment_terms_baseline_id_fkey" FOREIGN KEY ("baseline_id") REFERENCES "baselines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "commitment_terms" ENABLE ROW LEVEL SECURITY;
