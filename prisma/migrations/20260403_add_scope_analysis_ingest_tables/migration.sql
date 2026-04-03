-- Add scope analysis, scope alerts, ingest addresses, and inbound emails tables.
-- These models were added to the Prisma schema but never migrated to the database.

-- =====================================================================
-- 0. Missing enum values
-- =====================================================================

-- EventAction
ALTER TYPE "EventAction" ADD VALUE IF NOT EXISTS 'REMINDER_SCHEDULE_DELETED';
ALTER TYPE "EventAction" ADD VALUE IF NOT EXISTS 'SCOPE_ANALYSIS_STARTED';
ALTER TYPE "EventAction" ADD VALUE IF NOT EXISTS 'SCOPE_ANALYSIS_COMPLETED';
ALTER TYPE "EventAction" ADD VALUE IF NOT EXISTS 'SCOPE_ALERT_CREATED';
ALTER TYPE "EventAction" ADD VALUE IF NOT EXISTS 'SCOPE_ALERT_RESOLVED';
ALTER TYPE "EventAction" ADD VALUE IF NOT EXISTS 'SCOPE_ALERT_CONVERTED';
ALTER TYPE "EventAction" ADD VALUE IF NOT EXISTS 'INGEST_EMAIL_RECEIVED';
ALTER TYPE "EventAction" ADD VALUE IF NOT EXISTS 'INGEST_EMAIL_PROCESSED';
ALTER TYPE "EventAction" ADD VALUE IF NOT EXISTS 'INGEST_EMAIL_FAILED';
ALTER TYPE "EventAction" ADD VALUE IF NOT EXISTS 'INGEST_ADDRESS_CREATED';
ALTER TYPE "EventAction" ADD VALUE IF NOT EXISTS 'INGEST_ADDRESS_DEACTIVATED';

-- ExtractionTargetType
ALTER TYPE "ExtractionTargetType" ADD VALUE IF NOT EXISTS 'SCOPE_ANALYSIS';

-- EmailTemplateType
ALTER TYPE "EmailTemplateType" ADD VALUE IF NOT EXISTS 'SCOPE_ALERT_NOTIFICATION';
ALTER TYPE "EmailTemplateType" ADD VALUE IF NOT EXISTS 'INGEST_CONFIRMATION';

-- =====================================================================
-- 1. scope_analyses
-- =====================================================================

CREATE TABLE IF NOT EXISTS "scope_analyses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "program_id" UUID NOT NULL,
    "evidence_id" UUID,
    "baseline_id" UUID NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'UPLOAD',
    "meeting_title" TEXT,
    "meeting_date" TIMESTAMP(3),
    "participants" JSONB DEFAULT '[]',
    "summary" TEXT,
    "alert_count" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "error_message" TEXT,
    "tokens_used" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scope_analyses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "scope_analyses_program_id_created_at_idx"
    ON "scope_analyses"("program_id", "created_at");

-- =====================================================================
-- 2. scope_alerts
-- =====================================================================

CREATE TABLE IF NOT EXISTS "scope_alerts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "program_id" UUID NOT NULL,
    "analysis_job_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "transcript_excerpt" TEXT NOT NULL,
    "matched_clause_id" UUID,
    "matched_change_id" UUID,
    "match_summary" TEXT,
    "confidence" TEXT NOT NULL DEFAULT 'MEDIUM',
    "recommended_action" TEXT NOT NULL,
    "severity" "ChangeSeverity" NOT NULL DEFAULT 'MEDIUM',
    "estimated_impact" DECIMAL(14, 2),
    "schedule_impact_days" INTEGER,
    "speaker" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolved_at" TIMESTAMP(3),
    "resolved_note" TEXT,
    "converted_change_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scope_alerts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "scope_alerts_program_id_status_idx"
    ON "scope_alerts"("program_id", "status");

CREATE INDEX IF NOT EXISTS "scope_alerts_analysis_job_id_idx"
    ON "scope_alerts"("analysis_job_id");

-- =====================================================================
-- 3. ingest_addresses
-- =====================================================================

CREATE TABLE IF NOT EXISTS "ingest_addresses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "program_id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "address" TEXT NOT NULL,
    "label" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ingest_addresses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ingest_addresses_address_key"
    ON "ingest_addresses"("address");

CREATE INDEX IF NOT EXISTS "ingest_addresses_address_idx"
    ON "ingest_addresses"("address");

-- =====================================================================
-- 4. inbound_emails
-- =====================================================================

CREATE TABLE IF NOT EXISTS "inbound_emails" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ingest_address_id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "from_email" TEXT NOT NULL,
    "from_name" TEXT,
    "subject" TEXT,
    "text_body" TEXT,
    "detected_type" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "evidence_id" UUID,
    "extraction_job_id" UUID,
    "error_message" TEXT,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inbound_emails_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "inbound_emails_program_id_status_idx"
    ON "inbound_emails"("program_id", "status");

CREATE INDEX IF NOT EXISTS "inbound_emails_ingest_address_id_created_at_idx"
    ON "inbound_emails"("ingest_address_id", "created_at");

-- =====================================================================
-- 5. Foreign key constraints
-- =====================================================================

-- scope_analyses
ALTER TABLE "scope_analyses" ADD CONSTRAINT "scope_analyses_program_id_fkey"
    FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "scope_analyses" ADD CONSTRAINT "scope_analyses_evidence_id_fkey"
    FOREIGN KEY ("evidence_id") REFERENCES "evidences"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "scope_analyses" ADD CONSTRAINT "scope_analyses_baseline_id_fkey"
    FOREIGN KEY ("baseline_id") REFERENCES "baselines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- scope_alerts
ALTER TABLE "scope_alerts" ADD CONSTRAINT "scope_alerts_program_id_fkey"
    FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "scope_alerts" ADD CONSTRAINT "scope_alerts_analysis_job_id_fkey"
    FOREIGN KEY ("analysis_job_id") REFERENCES "scope_analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "scope_alerts" ADD CONSTRAINT "scope_alerts_matched_clause_id_fkey"
    FOREIGN KEY ("matched_clause_id") REFERENCES "baseline_clauses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "scope_alerts" ADD CONSTRAINT "scope_alerts_converted_change_id_fkey"
    FOREIGN KEY ("converted_change_id") REFERENCES "changes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ingest_addresses
ALTER TABLE "ingest_addresses" ADD CONSTRAINT "ingest_addresses_program_id_fkey"
    FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ingest_addresses" ADD CONSTRAINT "ingest_addresses_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ingest_addresses" ADD CONSTRAINT "ingest_addresses_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- inbound_emails
ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_ingest_address_id_fkey"
    FOREIGN KEY ("ingest_address_id") REFERENCES "ingest_addresses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_program_id_fkey"
    FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_evidence_id_fkey"
    FOREIGN KEY ("evidence_id") REFERENCES "evidences"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =====================================================================
-- 6. Row Level Security
-- =====================================================================

ALTER TABLE "scope_analyses" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "scope_analyses_select" ON "scope_analyses"
    FOR SELECT USING (public.is_org_member(public.program_org_id(program_id)));
CREATE POLICY "scope_analyses_insert" ON "scope_analyses"
    FOR INSERT WITH CHECK (public.is_org_writer(public.program_org_id(program_id)));
CREATE POLICY "scope_analyses_update" ON "scope_analyses"
    FOR UPDATE USING (public.is_org_writer(public.program_org_id(program_id)));

ALTER TABLE "scope_alerts" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "scope_alerts_select" ON "scope_alerts"
    FOR SELECT USING (public.is_org_member(public.program_org_id(program_id)));
CREATE POLICY "scope_alerts_insert" ON "scope_alerts"
    FOR INSERT WITH CHECK (public.is_org_writer(public.program_org_id(program_id)));
CREATE POLICY "scope_alerts_update" ON "scope_alerts"
    FOR UPDATE USING (public.is_org_writer(public.program_org_id(program_id)));

ALTER TABLE "ingest_addresses" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ingest_addresses_select" ON "ingest_addresses"
    FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY "ingest_addresses_insert" ON "ingest_addresses"
    FOR INSERT WITH CHECK (public.is_org_writer(org_id));
CREATE POLICY "ingest_addresses_update" ON "ingest_addresses"
    FOR UPDATE USING (public.is_org_writer(org_id));

ALTER TABLE "inbound_emails" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "inbound_emails_select" ON "inbound_emails"
    FOR SELECT USING (public.is_org_member(public.program_org_id(program_id)));
CREATE POLICY "inbound_emails_insert" ON "inbound_emails"
    FOR INSERT WITH CHECK (public.is_org_writer(public.program_org_id(program_id)));
CREATE POLICY "inbound_emails_update" ON "inbound_emails"
    FOR UPDATE USING (public.is_org_writer(public.program_org_id(program_id)));
