-- ================================================================
-- TAKI Migration v8.12 — Deal Soft Delete + Status Constraint Fix
-- ================================================================
--
-- Goal: Allow soft-deleting deals (status = 'deleted') so that
-- deals with existing bookings can be removed without violating
-- foreign key constraints.
--
-- Safe to re-run (idempotent).
-- ================================================================

-- Drop the existing CHECK constraint and recreate with 'deleted' option
ALTER TABLE public.deals DROP CONSTRAINT IF EXISTS deals_status_check;
ALTER TABLE public.deals ADD CONSTRAINT deals_status_check
    CHECK (status IN ('active', 'expired', 'deleted'));

DO $$
BEGIN
    RAISE NOTICE '✅ Deal soft-delete status enabled (active, expired, deleted)';
END $$;
