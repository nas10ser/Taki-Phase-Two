-- ========================================================
-- TAKI Platform — Database Migration v8.10
-- ========================================================
-- Adds shop location coordinates to the users table
-- so that sellers can have a persistent location across devices.
-- ========================================================

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;
