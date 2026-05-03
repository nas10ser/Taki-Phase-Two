-- ========================================================
-- TAKI Migration v7.3 — Add missing columns to live DB
-- ========================================================
-- Run this in the Supabase SQL Editor to bring the live
-- database in sync with the application code (v7.2+).
--
-- The app was failing on deal/profile saves because the
-- live `deals`, `users`, and `bookings` tables were missing
-- columns that the repositories try to write.
--
-- Safe to run multiple times: every statement uses
-- `ADD COLUMN IF NOT EXISTS`.
-- ========================================================

-- ========== deals table — 10 missing columns ==========
ALTER TABLE deals
    ADD COLUMN IF NOT EXISTS gender              TEXT DEFAULT 'all',
    ADD COLUMN IF NOT EXISTS size                TEXT,
    ADD COLUMN IF NOT EXISTS location_id         TEXT,
    ADD COLUMN IF NOT EXISTS map_lat             DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS map_lng             DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS reliability_score   INTEGER DEFAULT 100,
    ADD COLUMN IF NOT EXISTS expires_in_minutes  INTEGER DEFAULT 525600,
    ADD COLUMN IF NOT EXISTS is_unlimited        BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS initial_quantity    INTEGER,
    ADD COLUMN IF NOT EXISTS prep_time           TEXT;

-- Helpful index for location-based queries
CREATE INDEX IF NOT EXISTS idx_deals_location ON deals(location_id);

-- ========== users table — 3 missing columns ==========
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS address             TEXT,
    ADD COLUMN IF NOT EXISTS notif_keywords      TEXT[] DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS followed_merchants  TEXT[] DEFAULT '{}';

-- ========== bookings table — 3 missing columns ==========
ALTER TABLE bookings
    ADD COLUMN IF NOT EXISTS prep_time           TEXT,
    ADD COLUMN IF NOT EXISTS notes               TEXT,
    ADD COLUMN IF NOT EXISTS completed_at        TIMESTAMPTZ;

-- ========== Verification ==========
-- After running, you should see all 16 rows below:
-- SELECT table_name, column_name FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND (
--        (table_name = 'deals'    AND column_name IN ('gender','size','location_id','map_lat','map_lng','reliability_score','expires_in_minutes','is_unlimited','initial_quantity','prep_time'))
--     OR (table_name = 'users'    AND column_name IN ('address','notif_keywords','followed_merchants'))
--     OR (table_name = 'bookings' AND column_name IN ('prep_time','notes','completed_at'))
--   )
-- ORDER BY table_name, column_name;
