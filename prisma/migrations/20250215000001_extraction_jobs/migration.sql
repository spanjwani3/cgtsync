-- CreateEnum
CREATE TYPE "ExtractionJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ExtractionTargetType" AS ENUM ('BASELINE', 'INVOICE', 'CHANGE_ORDER');

-- AlterEnum (add extraction events)
ALTER TYPE "EventAction" ADD VALUE 'EXTRACTION_STARTED';
ALTER TYPE "EventAction" ADD VALUE 'EXTRACTION_COMPLETED';
ALTER TYPE "EventAction" ADD VALUE 'EXTRACTION_FAILED';
ALTER TYPE "EventAction" ADD VALUE 'EXTRACTION_APPLIED';

-- CreateTable
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

-- CreateIndex
CREATE INDEX "extraction_jobs_evidence_id_idx" ON "extraction_jobs"("evidence_id");

-- CreateIndex
CREATE INDEX "extraction_jobs_program_id_status_idx" ON "extraction_jobs"("program_id", "status");

-- CreateIndex
CREATE INDEX "extraction_jobs_program_id_created_at_idx" ON "extraction_jobs"("program_id", "created_at");

-- AddForeignKey
ALTER TABLE "extraction_jobs" ADD CONSTRAINT "extraction_jobs_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "evidences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_jobs" ADD CONSTRAINT "extraction_jobs_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Enable RLS
ALTER TABLE "extraction_jobs" ENABLE ROW LEVEL SECURITY;
