-- Phase 2: Email Infrastructure migration
-- Adds email_logs, org_email_configs, reminder_schedules tables
-- Adds due_date to invoices, email_log_id to magic_links
-- Adds new email-related enums and EventAction values

-- 1. New enum types
CREATE TYPE "EmailTemplateType" AS ENUM ('CONFIRMATION_REQUEST', 'PAYMENT_REMINDER', 'DISPUTE_DELIVERY', 'FOLLOW_UP_REMINDER', 'CUSTOM');
CREATE TYPE "EmailEntityType" AS ENUM ('BASELINE', 'CHANGE', 'INVOICE', 'DISPUTE');
CREATE TYPE "EmailStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'OPENED', 'BOUNCED', 'FAILED');

-- 2. New EventAction values for email tracking
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

-- 3. Add due_date column to invoices
ALTER TABLE "invoices" ADD COLUMN "due_date" TIMESTAMP(3);

-- 4. Add email_log_id column to magic_links
ALTER TABLE "magic_links" ADD COLUMN "email_log_id" UUID;

-- 5. Create email_logs table
CREATE TABLE "email_logs" (
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

CREATE INDEX "email_logs_program_id_created_at_idx" ON "email_logs"("program_id", "created_at");
CREATE INDEX "email_logs_entity_type_entity_id_idx" ON "email_logs"("entity_type", "entity_id");
CREATE INDEX "email_logs_resend_id_idx" ON "email_logs"("resend_id");

-- 6. Create org_email_configs table
CREATE TABLE "org_email_configs" (
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

CREATE UNIQUE INDEX "org_email_configs_org_id_key" ON "org_email_configs"("org_id");

-- 7. Create reminder_schedules table
CREATE TABLE "reminder_schedules" (
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

CREATE UNIQUE INDEX "reminder_schedules_invoice_id_key" ON "reminder_schedules"("invoice_id");
CREATE INDEX "reminder_schedules_next_send_at_is_active_idx" ON "reminder_schedules"("next_send_at", "is_active");

-- 8. Foreign key constraints
ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_program_id_fkey"
    FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_sender_user_id_fkey"
    FOREIGN KEY ("sender_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "org_email_configs" ADD CONSTRAINT "org_email_configs_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "reminder_schedules" ADD CONSTRAINT "reminder_schedules_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "reminder_schedules" ADD CONSTRAINT "reminder_schedules_program_id_fkey"
    FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "reminder_schedules" ADD CONSTRAINT "reminder_schedules_invoice_id_fkey"
    FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "magic_links" ADD CONSTRAINT "magic_links_email_log_id_fkey"
    FOREIGN KEY ("email_log_id") REFERENCES "email_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 9. Row Level Security
ALTER TABLE "email_logs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "email_logs_org_isolation" ON "email_logs"
    USING ("org_id" = current_setting('app.current_org_id', true)::uuid);

ALTER TABLE "org_email_configs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_email_configs_org_isolation" ON "org_email_configs"
    USING ("org_id" = current_setting('app.current_org_id', true)::uuid);

ALTER TABLE "reminder_schedules" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reminder_schedules_org_isolation" ON "reminder_schedules"
    USING ("org_id" = current_setting('app.current_org_id', true)::uuid);
