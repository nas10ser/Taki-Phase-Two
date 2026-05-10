-- ============================================================
-- TAKI Platform — Phase 2.3 Sponsorships, Pinned Stores, Ad Spaces
-- ============================================================
--   1. sponsorships: unified table for sponsored deals, native ads,
--      pinned stores, top-slider banners and inline banners.
--   2. pinned_stores: admin-curated unlimited list of stores that
--      always rank first for a city/mall.
--   3. RPC: increment_sponsorship_metric for click & impression tracking.
--   4. Atomic counters and RLS so only admins can write.
-- ============================================================

-- ====================== 1. SPONSORSHIPS ======================
CREATE TABLE IF NOT EXISTS sponsorships (
    id TEXT PRIMARY KEY DEFAULT 'spn_' || extract(epoch from now())::text || substr(md5(random()::text), 1, 6),
    merchant_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    deal_id TEXT REFERENCES deals(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN (
        'sponsored_deal',     -- deal injected every N cards
        'native_ad',          -- text/image card injected in feed
        'top_slider',         -- hero rotating banner
        'inline_banner',      -- horizontal banner inside scroll
        'verified_badge'      -- gold/verified badge on a store/deal
    )),
    target_audience TEXT CHECK (target_audience IN ('buyer','seller','all')),
    target_region TEXT,
    target_city TEXT,
    target_mall TEXT,
    badge_label_ar TEXT DEFAULT 'برعاية',
    badge_label_en TEXT DEFAULT 'Sponsored',
    title_ar TEXT,
    title_en TEXT,
    body_ar TEXT,
    body_en TEXT,
    image_url TEXT,
    action_url TEXT,
    cta_label_ar TEXT,
    cta_label_en TEXT,
    starts_at TIMESTAMPTZ DEFAULT NOW(),
    ends_at TIMESTAMPTZ,
    priority INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    impressions INTEGER NOT NULL DEFAULT 0,
    clicks INTEGER NOT NULL DEFAULT 0,
    insertion_interval INTEGER DEFAULT 4,    -- inject after every N regular items
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_spn_active ON sponsorships(is_active, type, starts_at);
CREATE INDEX IF NOT EXISTS idx_spn_merchant ON sponsorships(merchant_id);
CREATE INDEX IF NOT EXISTS idx_spn_deal ON sponsorships(deal_id);
CREATE INDEX IF NOT EXISTS idx_spn_priority ON sponsorships(priority DESC);

DROP TRIGGER IF EXISTS set_updated_at_spn ON sponsorships;
CREATE TRIGGER set_updated_at_spn BEFORE UPDATE ON sponsorships
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE sponsorships ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "spn_select_all" ON sponsorships;
CREATE POLICY "spn_select_all" ON sponsorships FOR SELECT USING (true);
DROP POLICY IF EXISTS "spn_admin_write" ON sponsorships;
CREATE POLICY "spn_admin_write" ON sponsorships FOR ALL
    USING (auth.uid()::text IN (SELECT id FROM users WHERE user_type = 'admin'))
    WITH CHECK (auth.uid()::text IN (SELECT id FROM users WHERE user_type = 'admin'));

-- ====================== 2. PINNED STORES ======================
-- Unlimited per (city, mall) — admin curates rank order.
CREATE TABLE IF NOT EXISTS pinned_stores (
    id TEXT PRIMARY KEY DEFAULT 'pin_' || extract(epoch from now())::text || substr(md5(random()::text), 1, 6),
    store_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_region TEXT,
    target_city TEXT,
    target_mall TEXT,
    rank INTEGER NOT NULL DEFAULT 0,         -- lower = higher in results
    starts_at TIMESTAMPTZ DEFAULT NOW(),
    ends_at TIMESTAMPTZ,
    contract_reference TEXT,
    notes TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pin_geo ON pinned_stores(target_city, target_mall);
CREATE INDEX IF NOT EXISTS idx_pin_active ON pinned_stores(is_active, rank);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pin_per_scope
    ON pinned_stores(store_id, COALESCE(target_city,''), COALESCE(target_mall,''));

DROP TRIGGER IF EXISTS set_updated_at_pin ON pinned_stores;
CREATE TRIGGER set_updated_at_pin BEFORE UPDATE ON pinned_stores
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE pinned_stores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pin_select_all" ON pinned_stores;
CREATE POLICY "pin_select_all" ON pinned_stores FOR SELECT USING (true);
DROP POLICY IF EXISTS "pin_admin_write" ON pinned_stores;
CREATE POLICY "pin_admin_write" ON pinned_stores FOR ALL
    USING (auth.uid()::text IN (SELECT id FROM users WHERE user_type = 'admin'))
    WITH CHECK (auth.uid()::text IN (SELECT id FROM users WHERE user_type = 'admin'));

-- ====================== 3. SPONSORSHIP METRICS RPC ======================
-- Atomic counter increment that even unauthenticated visitors can call
-- (anon read-only is fine; this RPC is rate-limited by the client and
-- by Supabase project settings).
CREATE OR REPLACE FUNCTION public.increment_sponsorship_metric(
    p_id TEXT,
    p_metric TEXT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF p_metric = 'impression' THEN
        UPDATE sponsorships SET impressions = impressions + 1 WHERE id = p_id;
    ELSIF p_metric = 'click' THEN
        UPDATE sponsorships SET clicks = clicks + 1 WHERE id = p_id;
    ELSE
        RAISE EXCEPTION 'Invalid metric: %', p_metric;
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_sponsorship_metric(TEXT, TEXT) TO authenticated, anon;

-- ====================== 4. PIN-FIRST RANKING HELPER ======================
-- Returns the list of pinned store IDs for a given scope, ordered by rank.
CREATE OR REPLACE FUNCTION public.get_pinned_store_ids(
    p_city TEXT DEFAULT NULL,
    p_mall TEXT DEFAULT NULL
)
RETURNS TEXT[]
LANGUAGE sql STABLE
AS $$
    SELECT COALESCE(ARRAY_AGG(store_id ORDER BY rank ASC), ARRAY[]::TEXT[])
      FROM pinned_stores
     WHERE is_active = TRUE
       AND (target_city IS NULL OR target_city = p_city OR p_city IS NULL)
       AND (target_mall IS NULL OR target_mall = p_mall OR p_mall IS NULL)
       AND (ends_at IS NULL OR ends_at > NOW());
$$;

GRANT EXECUTE ON FUNCTION public.get_pinned_store_ids(TEXT, TEXT) TO authenticated, anon;

-- ====================== 5. REALTIME ======================
ALTER TABLE sponsorships REPLICA IDENTITY FULL;
ALTER TABLE pinned_stores REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE sponsorships;
ALTER PUBLICATION supabase_realtime ADD TABLE pinned_stores;
