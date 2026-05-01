-- Migrate existing IngestAddress rows from ingest.cgtsync.ai (DNS not
-- configured) to inbox.cgtsync.ai (Postmark routes here, MX configured).
-- Idempotent — only updates rows that match the old domain.
--
-- Run after deploy of the email-ingestion unification (PR that adds
-- IngestAddress lookup to the Postmark webhook).

UPDATE ingest_addresses
SET address = REPLACE(address, '@ingest.cgtsync.ai', '@inbox.cgtsync.ai'),
    updated_at = now()
WHERE address LIKE '%@ingest.cgtsync.ai';

-- Verify the result. Should show all current addresses on @inbox.cgtsync.ai.
SELECT id, program_id, address, is_active, created_at
FROM ingest_addresses
ORDER BY created_at DESC;
