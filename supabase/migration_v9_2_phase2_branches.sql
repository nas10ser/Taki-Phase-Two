-- ============================================================
-- TAKI Platform — Phase 2.2 Multi-Branch Support
-- ============================================================
-- Sellers can register multiple physical locations (branches).
-- Pricing rule: included_branches (default 3) free, anything
-- beyond is billed per-branch via the existing subscription.
-- ============================================================

CREATE TABLE IF NOT EXISTS store_branches (
    id TEXT PRIMARY KEY DEFAULT 'br_' || extract(epoch from now())::text || substr(md5(random()::text), 1, 6),
    merchant_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name_ar TEXT NOT NULL,
    name_en TEXT,
    region_id TEXT,
    city_id TEXT,
    location_id TEXT,            -- mall/market id
    address TEXT,
    map_lat DOUBLE PRECISION,
    map_lng DOUBLE PRECISION,
    google_maps_link TEXT,
    phone TEXT,
    is_primary BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_branch_merchant ON store_branches(merchant_id);
CREATE INDEX IF NOT EXISTS idx_branch_city ON store_branches(city_id);
CREATE INDEX IF NOT EXISTS idx_branch_location ON store_branches(location_id);

DROP TRIGGER IF EXISTS set_updated_at_branches ON store_branches;
CREATE TRIGGER set_updated_at_branches BEFORE UPDATE ON store_branches
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Keep merchant_subscriptions.branches_count in sync after each insert/delete.
CREATE OR REPLACE FUNCTION public.sync_branch_count()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_merchant TEXT;
    v_count INTEGER;
BEGIN
    v_merchant := COALESCE(NEW.merchant_id, OLD.merchant_id);
    SELECT COUNT(*) INTO v_count FROM store_branches
     WHERE merchant_id = v_merchant AND is_active = TRUE;
    UPDATE merchant_subscriptions
       SET branches_count = GREATEST(1, v_count), updated_at = NOW()
     WHERE merchant_id = v_merchant;
    RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS tr_sync_branch_count ON store_branches;
CREATE TRIGGER tr_sync_branch_count
    AFTER INSERT OR UPDATE OR DELETE ON store_branches
    FOR EACH ROW EXECUTE FUNCTION public.sync_branch_count();

ALTER TABLE store_branches ENABLE ROW LEVEL SECURITY;

-- Anyone can read branches (used by buyers to see store locations).
DROP POLICY IF EXISTS "branches_select_all" ON store_branches;
CREATE POLICY "branches_select_all" ON store_branches FOR SELECT USING (true);

-- Sellers manage only their own branches.
DROP POLICY IF EXISTS "branches_insert_own" ON store_branches;
CREATE POLICY "branches_insert_own" ON store_branches FOR INSERT
    WITH CHECK (auth.uid()::text = merchant_id);
DROP POLICY IF EXISTS "branches_update_own" ON store_branches;
CREATE POLICY "branches_update_own" ON store_branches FOR UPDATE
    USING (auth.uid()::text = merchant_id) WITH CHECK (auth.uid()::text = merchant_id);
DROP POLICY IF EXISTS "branches_delete_own" ON store_branches;
CREATE POLICY "branches_delete_own" ON store_branches FOR DELETE
    USING (auth.uid()::text = merchant_id);

-- Admin override.
DROP POLICY IF EXISTS "branches_admin_all" ON store_branches;
CREATE POLICY "branches_admin_all" ON store_branches FOR ALL
    USING (auth.uid()::text IN (SELECT id FROM users WHERE user_type = 'admin'))
    WITH CHECK (auth.uid()::text IN (SELECT id FROM users WHERE user_type = 'admin'));

-- Realtime
ALTER TABLE store_branches REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE store_branches;
