-- CreateEnum
CREATE TYPE "TermType" AS ENUM (
  'RESERVATION_FEE',
  'COMMITMENT_DATE',
  'PAYMENT_MILESTONE',
  'CANCELLATION_WINDOW',
  'PENALTY_RULE',
  'MATERIAL_ORDER_TRIGGER'
);

-- Add TERMS to ExtractionTargetType
ALTER TYPE "ExtractionTargetType" ADD VALUE 'TERMS';

-- Add Commitment Term EventAction values
ALTER TYPE "EventAction" ADD VALUE 'TERM_CREATED';
ALTER TYPE "EventAction" ADD VALUE 'TERM_UPDATED';
ALTER TYPE "EventAction" ADD VALUE 'TERM_IMPORTED';

-- CreateTable
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

-- CreateIndex
CREATE INDEX "commitment_terms_program_id_deadline_at_idx" ON "commitment_terms"("program_id", "deadline_at");

-- CreateIndex
CREATE INDEX "commitment_terms_program_id_term_type_idx" ON "commitment_terms"("program_id", "term_type");

-- AddForeignKey
ALTER TABLE "commitment_terms" ADD CONSTRAINT "commitment_terms_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commitment_terms" ADD CONSTRAINT "commitment_terms_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "evidences"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commitment_terms" ADD CONSTRAINT "commitment_terms_baseline_id_fkey" FOREIGN KEY ("baseline_id") REFERENCES "baselines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Enable RLS
ALTER TABLE "commitment_terms" ENABLE ROW LEVEL SECURITY;
