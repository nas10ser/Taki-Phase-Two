-- ========================================================
-- TAKI Platform — Database Migration v8.14
-- ========================================================
-- Adds google_maps_link to the users table
-- so that sellers can persist their original location link.
-- ========================================================

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS google_maps_link TEXT;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS google_maps_link TEXT;
