-- ========================================================
-- TAKI Platform — Database Migration v8.9
-- ========================================================
-- This migration safely adds missing array columns to the 
-- users table for installations that were upgraded from 
-- older versions. 
--
-- This fixes the issue where user follows and notification 
-- keywords were silently discarded by the database and 
-- reset upon page refresh.
-- ========================================================

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS notif_keywords TEXT[] DEFAULT '{}';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS followed_merchants TEXT[] DEFAULT '{}';
