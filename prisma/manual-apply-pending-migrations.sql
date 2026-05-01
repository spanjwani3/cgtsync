-- ════════════════════════════════════════════════════════════════════
-- Manual application of 6 migrations that need to land in production
-- after PR #6 merged restored features from claude/fix-scope-analysis.
--
-- Vercel build does not run `prisma migrate deploy`, so these need to
-- be pasted into Supabase Dashboard → SQL Editor → New query → Run.
--
-- This file is **idempotent** — safe to run multiple times. Every
-- CREATE TABLE uses IF NOT EXISTS, every ADD COLUMN uses IF NOT EXISTS,
-- every CREATE TYPE is wrapped in a duplicate_object guard, every
-- CREATE POLICY is preceded by DROP POLICY IF EXISTS, every ADD
-- CONSTRAINT is wrapped in an existence check.
--
-- Migrations consolidated, in order of dependency:
--   1. 20260227_counter_support
--   2. 20260301_phase1_features
--   3. 20260302_phase2_email_infrastructure
--   4. 20260302_phase3_program_contacts
--   5. 20260318_enable_rls_all_tables
--   6. 20260403_add_scope_analysis_ingest_tables
-- ════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════
-- 1. counter_support
-- ════════════════════════════════════════════════════════════════════

ALTER TYPE "BaselineStatus" ADD VALUE IF NOT EXISTS 'COUNTERED';
ALTER TYPE "ChangeStatus" ADD VALUE IF NOT EXISTS 'COUNTERED';
ALTER TYPE "EventAction" ADD VALUE IF NOT EXISTS 'BASELINE_COUNTERED';
ALTER TYPE "EventAction" ADD VALUE IF NOT EXISTS 'CHANGE_COUNTERED';
ALTER TYPE "EventAction" ADD VALUE IF NOT EXISTS 'CLAUSE_DELETED';

ALTER TABLE "changes" ADD COLUMN IF NOT EXISTS "counterparty_note" TEXT;
ALTER TABLE "baselines" ADD COLUMN IF NOT EXISTS "counterparty_note" TEXT;


-- ════════════════════════════════════════════════════════════════════
-- 2. phase1_features
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE "evidences" ADD COLUMN IF NOT EXISTS "original_date" TIMESTAMP(3);
ALTER TABLE "evidences" ADD COLUMN IF NOT EXISTS "is_backloaded" BOOLEAN NOT NULL DEFAULT false;

DO $$ BEGIN
  CREATE TYPE "ImportTargetType" AS ENUM ('INVOICE', 'BASELINE', 'CONTRACT');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "import_mappings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "target_type" "ImportTargetType" NOT NULL,
    "column_map" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "import_mappings_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "import_mappings" ADD CONSTRAINT "import_mappings_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE "import_mappings" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "import_mappings_org_isolation" ON "import_mappings";
CREATE POLICY "import_mappings_org_isolation" ON "import_mappings"
    USING ("org_id" = current_setting('app.current_org_id', true)::uuid);

ALTER TABLE "programs" ADD COLUMN IF NOT EXISTS "assigned_pm_id" UUID;
DO $$ BEGIN
  ALTER TABLE "programs" ADD CONSTRAINT "programs_assigned_pm_id_fkey"
    FOREIGN KEY ("assigned_pm_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "logo_url" TEXT;

ALTER TYPE "EventAction" ADD VALUE IF NOT EXISTS 'EVIDENCE_BACKLOADED';
ALTER TYPE "EventAction" ADD VALUE IF NOT EXISTS 'BULK_IMPORT';


-- ════════════════════════════════════════════════════════════════════
-- 3. phase2_email_infrastructure
-- ════════════════════════════════════════════════════════════════════

DO $$ BEGIN CREATE TYPE "EmailTemplateType" AS ENUM ('CONFIRMATION_REQUEST', 'PAYMENT_REMINDER', 'DISPUTE_DELIVERY', 'FOLLOW_UP_REMINDER', 'CUSTOM');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "EmailEntityType" AS ENUM ('BASELINE', 'CHANGE', 'INVOICE', 'DISPUTE');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "EmailStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'OPENED', 'BOUNCED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TYPE "EventAction" ADD VALUE IF NOT EXISTS 'EMAIL_SENT';
ALTER TYPE "EventAction" ADD VALUE IF NOT EXISTS 'EMAIL_DELIVERED';
ALTER TYPE "EventAction" ADD VALUE IF NOT EXISTS 'EMAIL_OPENED';
ALTER TYPE "EventAction" ADD VALUE IF NOT EXISTS 'EMAIL_BOUNCED';
ALTER TYPE "EventAction" ADD VALUE IF NOT EXISTS 'EMAIL_FAILED';
ALTER TYPE "EventAction" ADD VALUE IF NOT EXISTS 'DISPUTE_PACK_SENT';
ALTER TYPE "EventAction" ADD VALUE IF NOT EXISTS 'PAYMENT_REMINDER_SENT';
ALTER TYPE "EventAction" ADD VALUE IF NOT EXISTS 'REMINDER_SCHEDULE_CREATED';
ALTER TYPE "EventAction" ADD VALUE IF NOT EXISTS 'REMINDER_SCHEDULE_PAUSED';
ALTER TYPE "EventAction" ADD VALUE IF NOT EXISTS 'REMINDER_SCHEDULE_RESUMED';

ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "due_date" TIMESTAMP(3);
ALTER TABLE "magic_links" ADD COLUMN IF NOT EXISTS "email_log_id" UUID;

CREATE TABLE IF NOT EXISTS "email_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "sender_user_id" UUID NOT NULL,
    "recipient_email" TEXT NOT NULL,
    "recipient_name" TEXT,
    "subject" TEXT NOT NULL,
    "template_type" "EmailTemplateType" NOT NULL,
    "entity_type" "EmailEntityType",
    "entity_id" UUID,
    "status" "EmailStatus" NOT NULL DEFAULT 'QUEUED',
    "resend_id" TEXT,
    "sent_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "opened_at" TIMESTAMP(3),
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "email_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "email_logs_program_id_created_at_idx" ON "email_logs"("program_id", "created_at");
CREATE INDEX IF NOT EXISTS "email_logs_entity_type_entity_id_idx" ON "email_logs"("entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "email_logs_resend_id_idx" ON "email_logs"("resend_id");

CREATE TABLE IF NOT EXISTS "org_email_configs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "sending_domain" TEXT,
    "domain_verified" BOOLEAN NOT NULL DEFAULT false,
    "default_reply_to" TEXT,
    "dkim_configured" BOOLEAN NOT NULL DEFAULT false,
    "spf_configured" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "org_email_configs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "org_email_configs_org_id_key" ON "org_email_configs"("org_id");

CREATE TABLE IF NOT EXISTS "reminder_schedules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "recipient_email" TEXT NOT NULL,
    "frequency_days" INTEGER NOT NULL DEFAULT 14,
    "start_offset_days" INTEGER NOT NULL DEFAULT -7,
    "escalation_tier" INTEGER NOT NULL DEFAULT 1,
    "reminder_count" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_sent_at" TIMESTAMP(3),
    "next_send_at" TIMESTAMP(3),
    "paused_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "reminder_schedules_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "reminder_schedules_invoice_id_key" ON "reminder_schedules"("invoice_id");
CREATE INDEX IF NOT EXISTS "reminder_schedules_next_send_at_is_active_idx" ON "reminder_schedules"("next_send_at", "is_active");

DO $$ BEGIN
  ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "org_email_configs" ADD CONSTRAINT "org_email_configs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "reminder_schedules" ADD CONSTRAINT "reminder_schedules_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "reminder_schedules" ADD CONSTRAINT "reminder_schedules_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "reminder_schedules" ADD CONSTRAINT "reminder_schedules_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "magic_links" ADD CONSTRAINT "magic_links_email_log_id_fkey" FOREIGN KEY ("email_log_id") REFERENCES "email_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE "email_logs" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "email_logs_org_isolation" ON "email_logs";
CREATE POLICY "email_logs_org_isolation" ON "email_logs"
    USING ("org_id" = current_setting('app.current_org_id', true)::uuid);

ALTER TABLE "org_email_configs" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_email_configs_org_isolation" ON "org_email_configs";
CREATE POLICY "org_email_configs_org_isolation" ON "org_email_configs"
    USING ("org_id" = current_setting('app.current_org_id', true)::uuid);

ALTER TABLE "reminder_schedules" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "reminder_schedules_org_isolation" ON "reminder_schedules";
CREATE POLICY "reminder_schedules_org_isolation" ON "reminder_schedules"
    USING ("org_id" = current_setting('app.current_org_id', true)::uuid);


-- ════════════════════════════════════════════════════════════════════
-- 4. phase3_program_contacts
-- ════════════════════════════════════════════════════════════════════

DO $$ BEGIN CREATE TYPE "ContactType" AS ENUM ('CLIENT', 'INTERNAL', 'OTHER');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "program_contacts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "program_id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "title" TEXT,
    "organization_name" TEXT,
    "contact_type" "ContactType" NOT NULL DEFAULT 'CLIENT',
    "phone" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "program_contacts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "program_contacts_program_id_contact_type_idx" ON "program_contacts"("program_id", "contact_type");

DO $$ BEGIN
  ALTER TABLE "program_contacts" ADD CONSTRAINT "program_contacts_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "program_contacts" ADD CONSTRAINT "program_contacts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE "program_contacts" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "program_contacts_org_isolation" ON "program_contacts";
CREATE POLICY "program_contacts_org_isolation" ON "program_contacts"
    USING ("org_id" = current_setting('app.current_org_id', true)::uuid);


-- ════════════════════════════════════════════════════════════════════
-- 5. enable_rls_all_tables
-- (Helper functions are CREATE OR REPLACE = idempotent.
--  Each policy is preceded by DROP POLICY IF EXISTS for safe re-runs.
--  auth.uid() is provided by Supabase — do NOT redefine it; the auth
--  schema is owned by supabase_auth_admin and blocks writes.)
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.is_org_member(p_org_id uuid) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM org_members
    WHERE org_id = p_org_id AND user_id = auth.uid()
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.has_org_role(p_org_id uuid, p_role "OrgRole") RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM org_members
    WHERE org_id = p_org_id AND user_id = auth.uid() AND role = p_role
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.is_org_writer(p_org_id uuid) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM org_members
    WHERE org_id = p_org_id AND user_id = auth.uid() AND role IN ('ADMIN', 'OPERATOR')
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.program_org_id(p_program_id uuid) RETURNS uuid AS $$
  SELECT org_id FROM programs WHERE id = p_program_id;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE baselines ENABLE ROW LEVEL SECURITY;
ALTER TABLE baseline_clauses ENABLE ROW LEVEL SECURITY;
ALTER TABLE changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidences ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE magic_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE _prisma_migrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_select_own" ON users;
CREATE POLICY "users_select_own" ON users FOR SELECT USING (id = auth.uid());
DROP POLICY IF EXISTS "users_update_own" ON users;
CREATE POLICY "users_update_own" ON users FOR UPDATE USING (id = auth.uid());
DROP POLICY IF EXISTS "users_insert_own" ON users;
CREATE POLICY "users_insert_own" ON users FOR INSERT WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "orgs_select_member" ON organizations;
CREATE POLICY "orgs_select_member" ON organizations FOR SELECT USING (public.is_org_member(id));
DROP POLICY IF EXISTS "orgs_insert_any_authed" ON organizations;
CREATE POLICY "orgs_insert_any_authed" ON organizations FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "orgs_update_admin" ON organizations;
CREATE POLICY "orgs_update_admin" ON organizations FOR UPDATE USING (public.has_org_role(id, 'ADMIN'));

DROP POLICY IF EXISTS "org_members_select_same_org" ON org_members;
CREATE POLICY "org_members_select_same_org" ON org_members FOR SELECT USING (public.is_org_member(org_id));
DROP POLICY IF EXISTS "org_members_insert_admin" ON org_members;
CREATE POLICY "org_members_insert_admin" ON org_members FOR INSERT WITH CHECK (public.has_org_role(org_id, 'ADMIN'));
DROP POLICY IF EXISTS "org_members_update_admin" ON org_members;
CREATE POLICY "org_members_update_admin" ON org_members FOR UPDATE USING (public.has_org_role(org_id, 'ADMIN'));
DROP POLICY IF EXISTS "org_members_delete_admin" ON org_members;
CREATE POLICY "org_members_delete_admin" ON org_members FOR DELETE USING (public.has_org_role(org_id, 'ADMIN'));

DROP POLICY IF EXISTS "programs_select_member" ON programs;
CREATE POLICY "programs_select_member" ON programs FOR SELECT USING (public.is_org_member(org_id));
DROP POLICY IF EXISTS "programs_insert_writer" ON programs;
CREATE POLICY "programs_insert_writer" ON programs FOR INSERT WITH CHECK (public.is_org_writer(org_id));
DROP POLICY IF EXISTS "programs_update_writer" ON programs;
CREATE POLICY "programs_update_writer" ON programs FOR UPDATE USING (public.is_org_writer(org_id));

DROP POLICY IF EXISTS "baselines_select" ON baselines;
CREATE POLICY "baselines_select" ON baselines FOR SELECT USING (public.is_org_member(public.program_org_id(program_id)));
DROP POLICY IF EXISTS "baselines_insert" ON baselines;
CREATE POLICY "baselines_insert" ON baselines FOR INSERT WITH CHECK (public.is_org_writer(public.program_org_id(program_id)));
DROP POLICY IF EXISTS "baselines_update" ON baselines;
CREATE POLICY "baselines_update" ON baselines FOR UPDATE USING (public.is_org_writer(public.program_org_id(program_id)));

DROP POLICY IF EXISTS "clauses_select" ON baseline_clauses;
CREATE POLICY "clauses_select" ON baseline_clauses FOR SELECT USING (
  public.is_org_member(public.program_org_id((SELECT program_id FROM baselines WHERE id = baseline_clauses.baseline_id)))
);
DROP POLICY IF EXISTS "clauses_insert" ON baseline_clauses;
CREATE POLICY "clauses_insert" ON baseline_clauses FOR INSERT WITH CHECK (
  public.is_org_writer(public.program_org_id((SELECT program_id FROM baselines WHERE id = baseline_clauses.baseline_id)))
);
DROP POLICY IF EXISTS "clauses_update" ON baseline_clauses;
CREATE POLICY "clauses_update" ON baseline_clauses FOR UPDATE USING (
  public.is_org_writer(public.program_org_id((SELECT program_id FROM baselines WHERE id = baseline_clauses.baseline_id)))
);

DROP POLICY IF EXISTS "changes_select" ON changes;
CREATE POLICY "changes_select" ON changes FOR SELECT USING (public.is_org_member(public.program_org_id(program_id)));
DROP POLICY IF EXISTS "changes_insert" ON changes;
CREATE POLICY "changes_insert" ON changes FOR INSERT WITH CHECK (public.is_org_writer(public.program_org_id(program_id)));
DROP POLICY IF EXISTS "changes_update" ON changes;
CREATE POLICY "changes_update" ON changes FOR UPDATE USING (public.is_org_writer(public.program_org_id(program_id)));

DROP POLICY IF EXISTS "invoices_select" ON invoices;
CREATE POLICY "invoices_select" ON invoices FOR SELECT USING (public.is_org_member(public.program_org_id(program_id)));
DROP POLICY IF EXISTS "invoices_insert" ON invoices;
CREATE POLICY "invoices_insert" ON invoices FOR INSERT WITH CHECK (public.is_org_writer(public.program_org_id(program_id)));
DROP POLICY IF EXISTS "invoices_update" ON invoices;
CREATE POLICY "invoices_update" ON invoices FOR UPDATE USING (public.is_org_writer(public.program_org_id(program_id)));

DROP POLICY IF EXISTS "line_items_select" ON invoice_line_items;
CREATE POLICY "line_items_select" ON invoice_line_items FOR SELECT USING (
  public.is_org_member(public.program_org_id((SELECT program_id FROM invoices WHERE id = invoice_line_items.invoice_id)))
);
DROP POLICY IF EXISTS "line_items_insert" ON invoice_line_items;
CREATE POLICY "line_items_insert" ON invoice_line_items FOR INSERT WITH CHECK (
  public.is_org_writer(public.program_org_id((SELECT program_id FROM invoices WHERE id = invoice_line_items.invoice_id)))
);
DROP POLICY IF EXISTS "line_items_update" ON invoice_line_items;
CREATE POLICY "line_items_update" ON invoice_line_items FOR UPDATE USING (
  public.is_org_writer(public.program_org_id((SELECT program_id FROM invoices WHERE id = invoice_line_items.invoice_id)))
);

DROP POLICY IF EXISTS "evidences_select" ON evidences;
CREATE POLICY "evidences_select" ON evidences FOR SELECT USING (public.is_org_member(public.program_org_id(program_id)));
DROP POLICY IF EXISTS "evidences_insert" ON evidences;
CREATE POLICY "evidences_insert" ON evidences FOR INSERT WITH CHECK (public.is_org_writer(public.program_org_id(program_id)));
DROP POLICY IF EXISTS "evidences_update" ON evidences;
CREATE POLICY "evidences_update" ON evidences FOR UPDATE USING (public.is_org_writer(public.program_org_id(program_id)));

DROP POLICY IF EXISTS "event_logs_select" ON event_logs;
CREATE POLICY "event_logs_select" ON event_logs FOR SELECT USING (
  program_id IS NULL OR public.is_org_member(public.program_org_id(program_id))
);
DROP POLICY IF EXISTS "event_logs_insert" ON event_logs;
CREATE POLICY "event_logs_insert" ON event_logs FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "magic_links_select_creator" ON magic_links;
CREATE POLICY "magic_links_select_creator" ON magic_links FOR SELECT USING (created_by_id = auth.uid());
DROP POLICY IF EXISTS "magic_links_insert_authed" ON magic_links;
CREATE POLICY "magic_links_insert_authed" ON magic_links FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "exports_select" ON exports;
CREATE POLICY "exports_select" ON exports FOR SELECT USING (public.is_org_member(public.program_org_id(program_id)));
DROP POLICY IF EXISTS "exports_insert" ON exports;
CREATE POLICY "exports_insert" ON exports FOR INSERT WITH CHECK (public.is_org_writer(public.program_org_id(program_id)));

CREATE OR REPLACE FUNCTION prevent_event_log_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'event_logs is append-only: updates and deletes are prohibited';
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'event_logs_no_update') THEN
    CREATE TRIGGER event_logs_no_update BEFORE UPDATE ON event_logs FOR EACH ROW EXECUTE FUNCTION prevent_event_log_mutation();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'event_logs_no_delete') THEN
    CREATE TRIGGER event_logs_no_delete BEFORE DELETE ON event_logs FOR EACH ROW EXECUTE FUNCTION prevent_event_log_mutation();
  END IF;
END $$;


-- ════════════════════════════════════════════════════════════════════
-- 6. add_scope_analysis_ingest_tables
-- ════════════════════════════════════════════════════════════════════

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
ALTER TYPE "ExtractionTargetType" ADD VALUE IF NOT EXISTS 'SCOPE_ANALYSIS';
ALTER TYPE "EmailTemplateType" ADD VALUE IF NOT EXISTS 'SCOPE_ALERT_NOTIFICATION';
ALTER TYPE "EmailTemplateType" ADD VALUE IF NOT EXISTS 'INGEST_CONFIRMATION';

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
CREATE INDEX IF NOT EXISTS "scope_analyses_program_id_created_at_idx" ON "scope_analyses"("program_id", "created_at");

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
CREATE INDEX IF NOT EXISTS "scope_alerts_program_id_status_idx" ON "scope_alerts"("program_id", "status");
CREATE INDEX IF NOT EXISTS "scope_alerts_analysis_job_id_idx" ON "scope_alerts"("analysis_job_id");

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
CREATE UNIQUE INDEX IF NOT EXISTS "ingest_addresses_address_key" ON "ingest_addresses"("address");
CREATE INDEX IF NOT EXISTS "ingest_addresses_address_idx" ON "ingest_addresses"("address");

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
CREATE INDEX IF NOT EXISTS "inbound_emails_program_id_status_idx" ON "inbound_emails"("program_id", "status");
CREATE INDEX IF NOT EXISTS "inbound_emails_ingest_address_id_created_at_idx" ON "inbound_emails"("ingest_address_id", "created_at");

DO $$ BEGIN ALTER TABLE "scope_analyses" ADD CONSTRAINT "scope_analyses_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "scope_analyses" ADD CONSTRAINT "scope_analyses_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "evidences"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "scope_analyses" ADD CONSTRAINT "scope_analyses_baseline_id_fkey" FOREIGN KEY ("baseline_id") REFERENCES "baselines"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "scope_alerts" ADD CONSTRAINT "scope_alerts_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "scope_alerts" ADD CONSTRAINT "scope_alerts_analysis_job_id_fkey" FOREIGN KEY ("analysis_job_id") REFERENCES "scope_analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "scope_alerts" ADD CONSTRAINT "scope_alerts_matched_clause_id_fkey" FOREIGN KEY ("matched_clause_id") REFERENCES "baseline_clauses"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "scope_alerts" ADD CONSTRAINT "scope_alerts_converted_change_id_fkey" FOREIGN KEY ("converted_change_id") REFERENCES "changes"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "ingest_addresses" ADD CONSTRAINT "ingest_addresses_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "ingest_addresses" ADD CONSTRAINT "ingest_addresses_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "ingest_addresses" ADD CONSTRAINT "ingest_addresses_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_ingest_address_id_fkey" FOREIGN KEY ("ingest_address_id") REFERENCES "ingest_addresses"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "evidences"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE "scope_analyses" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "scope_analyses_select" ON "scope_analyses";
CREATE POLICY "scope_analyses_select" ON "scope_analyses" FOR SELECT USING (public.is_org_member(public.program_org_id(program_id)));
DROP POLICY IF EXISTS "scope_analyses_insert" ON "scope_analyses";
CREATE POLICY "scope_analyses_insert" ON "scope_analyses" FOR INSERT WITH CHECK (public.is_org_writer(public.program_org_id(program_id)));
DROP POLICY IF EXISTS "scope_analyses_update" ON "scope_analyses";
CREATE POLICY "scope_analyses_update" ON "scope_analyses" FOR UPDATE USING (public.is_org_writer(public.program_org_id(program_id)));

ALTER TABLE "scope_alerts" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "scope_alerts_select" ON "scope_alerts";
CREATE POLICY "scope_alerts_select" ON "scope_alerts" FOR SELECT USING (public.is_org_member(public.program_org_id(program_id)));
DROP POLICY IF EXISTS "scope_alerts_insert" ON "scope_alerts";
CREATE POLICY "scope_alerts_insert" ON "scope_alerts" FOR INSERT WITH CHECK (public.is_org_writer(public.program_org_id(program_id)));
DROP POLICY IF EXISTS "scope_alerts_update" ON "scope_alerts";
CREATE POLICY "scope_alerts_update" ON "scope_alerts" FOR UPDATE USING (public.is_org_writer(public.program_org_id(program_id)));

ALTER TABLE "ingest_addresses" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ingest_addresses_select" ON "ingest_addresses";
CREATE POLICY "ingest_addresses_select" ON "ingest_addresses" FOR SELECT USING (public.is_org_member(org_id));
DROP POLICY IF EXISTS "ingest_addresses_insert" ON "ingest_addresses";
CREATE POLICY "ingest_addresses_insert" ON "ingest_addresses" FOR INSERT WITH CHECK (public.is_org_writer(org_id));
DROP POLICY IF EXISTS "ingest_addresses_update" ON "ingest_addresses";
CREATE POLICY "ingest_addresses_update" ON "ingest_addresses" FOR UPDATE USING (public.is_org_writer(org_id));

ALTER TABLE "inbound_emails" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "inbound_emails_select" ON "inbound_emails";
CREATE POLICY "inbound_emails_select" ON "inbound_emails" FOR SELECT USING (public.is_org_member(public.program_org_id(program_id)));
DROP POLICY IF EXISTS "inbound_emails_insert" ON "inbound_emails";
CREATE POLICY "inbound_emails_insert" ON "inbound_emails" FOR INSERT WITH CHECK (public.is_org_writer(public.program_org_id(program_id)));
DROP POLICY IF EXISTS "inbound_emails_update" ON "inbound_emails";
CREATE POLICY "inbound_emails_update" ON "inbound_emails" FOR UPDATE USING (public.is_org_writer(public.program_org_id(program_id)));

-- ════════════════════════════════════════════════════════════════════
-- Done. /admin/health should now show all tables present.
-- ════════════════════════════════════════════════════════════════════
