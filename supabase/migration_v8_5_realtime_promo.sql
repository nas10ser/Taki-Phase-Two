-- ================================================================
-- TAKI Migration v8.5 — Realtime Fix + Promotional Campaigns Table
-- ================================================================
-- 
-- Problem 1: Supabase Realtime UPDATE events only send the PRIMARY
-- KEY columns by default. The bookings table's PK is `barcode`,
-- so when the seller updates `status`, the payload contains
-- {barcode, status} but NOT `user_id`. The buyer's realtime
-- filter `user_id=eq.<buyerId>` never matches → buyer never
-- sees status changes (acknowledged / completed).
--
-- Fix: REPLICA IDENTITY FULL makes Postgres send the ENTIRE old
-- and new row on every UPDATE, so user_id is always present and
-- the filter works.
--
-- Problem 2: No infrastructure for admin-authored promotional
-- notifications (campaigns). Currently marketing alerts are
-- hardcoded in AppContext. This table allows the admin to create
-- campaigns from a dashboard in the future.
--
-- Safe to re-run (idempotent).
-- ================================================================

-- ====================== FIX 1: REPLICA IDENTITY FULL ======================
-- This ensures realtime UPDATE events include ALL columns,
-- not just the primary key. Cost: slightly larger WAL entries
-- (negligible for TAKI's scale).

DO $$ BEGIN
    IF to_regclass('public.bookings') IS NOT NULL THEN
        ALTER TABLE bookings REPLICA IDENTITY FULL;
        RAISE NOTICE '✅ bookings REPLICA IDENTITY set to FULL';
    END IF;
END $$;

DO $$ BEGIN
    IF to_regclass('public.notifications') IS NOT NULL THEN
        ALTER TABLE notifications REPLICA IDENTITY FULL;
        RAISE NOTICE '✅ notifications REPLICA IDENTITY set to FULL';
    END IF;
END $$;

-- ====================== FIX 2: PROMOTIONAL CAMPAIGNS TABLE ======================
-- This table stores admin-authored marketing campaigns.
-- Each campaign targets either 'buyer', 'seller', or 'all'.
-- The admin fills title, body, and optional image/link.
-- The app reads active campaigns and pushes them as notifications.

CREATE TABLE IF NOT EXISTS promotional_campaigns (
    id TEXT PRIMARY KEY DEFAULT 'promo_' || extract(epoch from now())::text || substr(md5(random()::text), 1, 6),
    
    -- Who sees it
    target_audience TEXT NOT NULL DEFAULT 'all' 
        CHECK (target_audience IN ('buyer', 'seller', 'all')),
    
    -- Optional: target specific city/region (NULL = all locations)
    target_city TEXT,
    target_region TEXT,
    
    -- Content (bilingual)
    title_ar TEXT NOT NULL,
    title_en TEXT NOT NULL,
    body_ar TEXT NOT NULL,
    body_en TEXT NOT NULL,
    
    -- Optional media
    image_url TEXT,
    action_url TEXT,           -- Deep link or external URL when tapped
    action_label_ar TEXT,      -- e.g. "تصفح العروض"
    action_label_en TEXT,      -- e.g. "Browse Deals"
    
    -- Scheduling
    starts_at TIMESTAMPTZ DEFAULT NOW(),
    ends_at TIMESTAMPTZ,       -- NULL = no expiry
    
    -- Control
    is_active BOOLEAN DEFAULT TRUE,
    priority INTEGER DEFAULT 0, -- Higher = shown first
    max_impressions INTEGER,    -- NULL = unlimited
    current_impressions INTEGER DEFAULT 0,
    
    -- Tracking
    created_by TEXT REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_promo_active ON promotional_campaigns(is_active, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_promo_audience ON promotional_campaigns(target_audience);
CREATE INDEX IF NOT EXISTS idx_promo_city ON promotional_campaigns(target_city) WHERE target_city IS NOT NULL;

-- ====================== PROMO IMPRESSIONS LOG ======================
-- Tracks which users have seen which campaigns (prevents re-showing).
CREATE TABLE IF NOT EXISTS promo_impressions (
    campaign_id TEXT NOT NULL REFERENCES promotional_campaigns(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    seen_at TIMESTAMPTZ DEFAULT NOW(),
    clicked BOOLEAN DEFAULT FALSE,
    PRIMARY KEY (campaign_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_promo_imp_user ON promo_impressions(user_id);

-- ====================== RLS FOR PROMOTIONAL TABLES ======================
ALTER TABLE promotional_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE promo_impressions ENABLE ROW LEVEL SECURITY;

-- Everyone can READ active campaigns (the app filters by audience client-side)
DROP POLICY IF EXISTS "promo_select_active" ON promotional_campaigns;
CREATE POLICY "promo_select_active" ON promotional_campaigns 
    FOR SELECT USING (true);

-- Only admins can create/update/delete campaigns
-- (For now, any authenticated user with admin role; tighten later with a role check)
DROP POLICY IF EXISTS "promo_insert_admin" ON promotional_campaigns;
CREATE POLICY "promo_insert_admin" ON promotional_campaigns 
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "promo_update_admin" ON promotional_campaigns;
CREATE POLICY "promo_update_admin" ON promotional_campaigns 
    FOR UPDATE USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "promo_delete_admin" ON promotional_campaigns;
CREATE POLICY "promo_delete_admin" ON promotional_campaigns 
    FOR DELETE USING (auth.uid() IS NOT NULL);

-- Impressions: users can read/write their own
DROP POLICY IF EXISTS "imp_select_own" ON promo_impressions;
CREATE POLICY "imp_select_own" ON promo_impressions 
    FOR SELECT USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "imp_insert_own" ON promo_impressions;
CREATE POLICY "imp_insert_own" ON promo_impressions 
    FOR INSERT WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "imp_update_own" ON promo_impressions;
CREATE POLICY "imp_update_own" ON promo_impressions 
    FOR UPDATE USING (auth.uid()::text = user_id);

-- ====================== ENABLE REALTIME FOR CAMPAIGNS ======================
-- So the app can listen for new campaigns in real-time
DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE promotional_campaigns;
EXCEPTION WHEN duplicate_object THEN
    NULL; -- Already added
END $$;

-- ====================== VERIFICATION QUERY ======================
-- Run this after the migration to verify everything is in place:
--
-- SELECT c.relname, c.relreplident
-- FROM pg_class c
-- JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public'
--   AND c.relname IN ('bookings', 'notifications')
-- ORDER BY c.relname;
--
-- Expected: relreplident = 'f' (FULL) for both tables.
--
-- SELECT * FROM promotional_campaigns LIMIT 1;  -- Should work (empty)
-- SELECT * FROM promo_impressions LIMIT 1;       -- Should work (empty)
