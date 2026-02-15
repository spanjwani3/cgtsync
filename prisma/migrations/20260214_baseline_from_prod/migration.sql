-- Baseline: snapshot of the 13-table production schema created via `prisma db push`.
-- This migration is marked as "already applied" on prod so Prisma knows
-- the schema already exists. On a fresh DB it creates everything from scratch.

-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('ADMIN', 'OPERATOR', 'READ_ONLY');

-- CreateEnum
CREATE TYPE "ProgramStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "BaselineStatus" AS ENUM ('DRAFT', 'RELEASED', 'CONFIRMED', 'LOCKED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "ClauseType" AS ENUM ('PRICING', 'TIMELINE', 'SCOPE', 'QUALITY', 'REGULATORY', 'PAYMENT_TERMS', 'IP', 'OTHER');

-- CreateEnum
CREATE TYPE "ChangeStatus" AS ENUM ('DRAFT', 'RELEASED', 'CONFIRMED', 'LOGGED');

-- CreateEnum
CREATE TYPE "ChangeSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('UPLOADED', 'MAPPED', 'FLAGGED', 'APPROVED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "LineItemFlag" AS ENUM ('NONE', 'RATE_MISMATCH', 'SCOPE_CREEP', 'UNAPPROVED_CHANGE', 'DUPLICATE', 'MISSING_BASELINE', 'OTHER');

-- CreateEnum
CREATE TYPE "EvidenceType" AS ENUM ('INVOICE', 'SOW_MSA', 'EMAIL_APPROVAL', 'TRANSCRIPT', 'CHANGE_ORDER', 'DISPUTE_PACKET', 'EXPORT_PACK', 'OTHER');

-- CreateEnum
CREATE TYPE "EventAction" AS ENUM ('USER_LOGIN', 'USER_LOGOUT', 'PROGRAM_CREATED', 'PROGRAM_UPDATED', 'PROGRAM_ARCHIVED', 'BASELINE_CREATED', 'BASELINE_RELEASED', 'BASELINE_CONFIRMED', 'BASELINE_LOCKED', 'BASELINE_SUPERSEDED', 'CLAUSE_CREATED', 'CLAUSE_UPDATED', 'CHANGE_DRAFTED', 'CHANGE_RELEASED', 'CHANGE_CONFIRMED', 'CHANGE_AUTO_LOGGED', 'INVOICE_UPLOADED', 'INVOICE_MAPPED', 'INVOICE_FLAGGED', 'INVOICE_APPROVED', 'INVOICE_DISPUTED', 'LINE_ITEM_FLAGGED', 'EVIDENCE_UPLOADED', 'EVIDENCE_FINALIZED', 'MAGIC_LINK_CREATED', 'MAGIC_LINK_VIEWED', 'MAGIC_LINK_CONFIRMED', 'MAGIC_LINK_EXPIRED', 'EXPORT_GENERATED', 'RETENTION_DELETE_EXECUTED');

-- CreateEnum
CREATE TYPE "MagicLinkScope" AS ENUM ('BASELINE_CONFIRM', 'CHANGE_CONFIRM');

-- CreateEnum
CREATE TYPE "ExportType" AS ENUM ('BASELINE_PACK', 'CHANGE_LEDGER_PACK', 'INVOICE_REVIEW_PACK', 'DISPUTE_PACKET', 'WEEKLY_GOVERNANCE_PACK');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "full_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "OrgRole" NOT NULL DEFAULT 'OPERATOR',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "programs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "cdmo_name" TEXT NOT NULL,
    "molecule" TEXT,
    "modality" TEXT,
    "description" TEXT,
    "status" "ProgramStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "retention_days" INTEGER,
    "activated_at" TIMESTAMP(3),
    "change_threshold" DECIMAL(14,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "baselines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "program_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "title" TEXT NOT NULL,
    "status" "BaselineStatus" NOT NULL DEFAULT 'DRAFT',
    "source_file_id" UUID,
    "released_at" TIMESTAMP(3),
    "confirmed_at" TIMESTAMP(3),
    "locked_at" TIMESTAMP(3),
    "superseded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "baselines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "baseline_clauses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "baseline_id" UUID NOT NULL,
    "clause_ref" TEXT,
    "type" "ClauseType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "value" DECIMAL(14,2),
    "unit" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "baseline_clauses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "changes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "program_id" UUID NOT NULL,
    "baseline_id" UUID,
    "sequence_num" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "severity" "ChangeSeverity" NOT NULL DEFAULT 'MEDIUM',
    "status" "ChangeStatus" NOT NULL DEFAULT 'DRAFT',
    "estimated_impact" DECIMAL(14,2),
    "evidence_file_id" UUID,
    "released_at" TIMESTAMP(3),
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "program_id" UUID NOT NULL,
    "invoice_number" TEXT,
    "vendor_name" TEXT,
    "invoice_date" TIMESTAMP(3),
    "total_amount" DECIMAL(14,2),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "InvoiceStatus" NOT NULL DEFAULT 'UPLOADED',
    "evidence_file_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_line_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "invoice_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(14,4),
    "unit_price" DECIMAL(14,2),
    "amount" DECIMAL(14,2) NOT NULL,
    "clause_id" UUID,
    "change_id" UUID,
    "flag" "LineItemFlag" NOT NULL DEFAULT 'NONE',
    "flag_note" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "program_id" UUID NOT NULL,
    "type" "EvidenceType" NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "mime_type" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "sha256_hash" TEXT NOT NULL,
    "metadata" JSONB DEFAULT '{}',
    "finalized" BOOLEAN NOT NULL DEFAULT false,
    "finalized_at" TIMESTAMP(3),
    "retain_until" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "evidences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "program_id" UUID,
    "user_id" UUID,
    "action" "EventAction" NOT NULL,
    "entity_type" TEXT,
    "entity_id" UUID,
    "metadata" JSONB DEFAULT '{}',
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "magic_links" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "token" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "scope" "MagicLinkScope" NOT NULL,
    "entity_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,
    "single_use" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "viewed_at" TIMESTAMP(3),
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "magic_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "program_id" UUID NOT NULL,
    "type" "ExportType" NOT NULL,
    "file_name" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "sha256_hash" TEXT NOT NULL,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "org_members_org_id_user_id_key" ON "org_members"("org_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "baselines_program_id_version_key" ON "baselines"("program_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "changes_program_id_sequence_num_key" ON "changes"("program_id", "sequence_num");

-- CreateIndex
CREATE INDEX "event_logs_program_id_created_at_idx" ON "event_logs"("program_id", "created_at");

-- CreateIndex
CREATE INDEX "event_logs_entity_type_entity_id_idx" ON "event_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "magic_links_token_key" ON "magic_links"("token");

-- CreateIndex
CREATE INDEX "magic_links_token_idx" ON "magic_links"("token");

-- AddForeignKey
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programs" ADD CONSTRAINT "programs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "baselines" ADD CONSTRAINT "baselines_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "baselines" ADD CONSTRAINT "baselines_source_file_id_fkey" FOREIGN KEY ("source_file_id") REFERENCES "evidences"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "baseline_clauses" ADD CONSTRAINT "baseline_clauses_baseline_id_fkey" FOREIGN KEY ("baseline_id") REFERENCES "baselines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "changes" ADD CONSTRAINT "changes_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "changes" ADD CONSTRAINT "changes_baseline_id_fkey" FOREIGN KEY ("baseline_id") REFERENCES "baselines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "changes" ADD CONSTRAINT "changes_evidence_file_id_fkey" FOREIGN KEY ("evidence_file_id") REFERENCES "evidences"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_evidence_file_id_fkey" FOREIGN KEY ("evidence_file_id") REFERENCES "evidences"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_clause_id_fkey" FOREIGN KEY ("clause_id") REFERENCES "baseline_clauses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_change_id_fkey" FOREIGN KEY ("change_id") REFERENCES "changes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidences" ADD CONSTRAINT "evidences_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_logs" ADD CONSTRAINT "event_logs_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_logs" ADD CONSTRAINT "event_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "magic_links" ADD CONSTRAINT "magic_links_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exports" ADD CONSTRAINT "exports_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
