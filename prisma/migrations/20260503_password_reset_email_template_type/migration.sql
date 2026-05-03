-- Add PASSWORD_RESET to EmailTemplateType for self-service password recovery emails
ALTER TYPE "EmailTemplateType" ADD VALUE IF NOT EXISTS 'PASSWORD_RESET';
