-- Rename extraction EventAction values (idempotent: skips if already renamed)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'EXTRACTION_STARTED' AND enumtypid = '"EventAction"'::regtype) THEN
    ALTER TYPE "EventAction" RENAME VALUE 'EXTRACTION_STARTED' TO 'EXTRACTION_JOB_CREATED';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'EXTRACTION_COMPLETED' AND enumtypid = '"EventAction"'::regtype) THEN
    ALTER TYPE "EventAction" RENAME VALUE 'EXTRACTION_COMPLETED' TO 'EXTRACTION_JOB_SUCCEEDED';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'EXTRACTION_FAILED' AND enumtypid = '"EventAction"'::regtype) THEN
    ALTER TYPE "EventAction" RENAME VALUE 'EXTRACTION_FAILED' TO 'EXTRACTION_JOB_FAILED';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'EXTRACTION_APPLIED' AND enumtypid = '"EventAction"'::regtype) THEN
    ALTER TYPE "EventAction" RENAME VALUE 'EXTRACTION_APPLIED' TO 'EXTRACTION_JOB_APPLIED';
  END IF;
END $$;
