-- Migration v13: Analytics Tracking (Views & Clicks)
-- Adds performance tracking columns to the deals table and an RPC for atomic increments.

-- 1. Add tracking columns
ALTER TABLE deals 
ADD COLUMN IF NOT EXISTS views INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS clicks INTEGER DEFAULT 0;

-- 2. Create RPC for atomic view increment
-- This avoids race conditions when multiple users view the same deal simultaneously.
CREATE OR REPLACE FUNCTION increment_deal_view(target_deal_id UUID)
RETURNS void AS $$
BEGIN
    UPDATE deals
    SET views = views + 1
    WHERE id = target_deal_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Create RPC for atomic click increment (e.g. for contact/directions)
CREATE OR REPLACE FUNCTION increment_deal_click(target_deal_id UUID)
RETURNS void AS $$
BEGIN
    UPDATE deals
    SET clicks = clicks + 1
    WHERE id = target_deal_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
