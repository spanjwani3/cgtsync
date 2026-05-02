-- Add WELCOME to EmailTemplateType for tenant onboarding welcome emails
ALTER TYPE "EmailTemplateType" ADD VALUE IF NOT EXISTS 'WELCOME';
