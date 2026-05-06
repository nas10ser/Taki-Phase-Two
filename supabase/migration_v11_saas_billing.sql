-- Migration v11: SaaS Billing & Global Settings
-- Implements the Subscription gating and payment gateway toggle.

-- 1. Create a global settings table
CREATE TABLE IF NOT EXISTS global_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on global_settings
ALTER TABLE global_settings ENABLE ROW LEVEL SECURITY;

-- Everyone can read global settings
DROP POLICY IF EXISTS "settings_select_all" ON global_settings;
CREATE POLICY "settings_select_all" ON global_settings FOR SELECT USING (true);

-- Only admin can update global settings
DROP POLICY IF EXISTS "settings_update_admin" ON global_settings;
CREATE POLICY "settings_update_admin" ON global_settings FOR UPDATE USING (
    auth.uid()::text IN (SELECT id FROM users WHERE user_type = 'admin')
) WITH CHECK (
    auth.uid()::text IN (SELECT id FROM users WHERE user_type = 'admin')
);

DROP POLICY IF EXISTS "settings_insert_admin" ON global_settings;
CREATE POLICY "settings_insert_admin" ON global_settings FOR INSERT WITH CHECK (
    auth.uid()::text IN (SELECT id FROM users WHERE user_type = 'admin')
);

-- Insert the default payment gateway state (hidden/disabled initially for early launch)
INSERT INTO global_settings (key, value) VALUES ('is_payment_gateway_enabled', 'false') ON CONFLICT DO NOTHING;

-- 2. Function to check if a seller can add deals based on subscription
CREATE OR REPLACE FUNCTION can_seller_add_deal(seller_id TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    global_payment_enabled TEXT;
    sub_expires TIMESTAMPTZ;
BEGIN
    SELECT value INTO global_payment_enabled FROM global_settings WHERE key = 'is_payment_gateway_enabled';
    
    -- If gateway is hidden/disabled globally, everything is free/allowed
    IF global_payment_enabled = 'false' THEN 
        RETURN TRUE; 
    END IF;

    -- Otherwise, check the store_profile expiry
    SELECT subscription_expires_at INTO sub_expires FROM store_profiles WHERE store_id = seller_id;
    
    -- If no expiry is set or it's in the past, they cannot add deals
    IF sub_expires IS NULL OR sub_expires < NOW() THEN 
        RETURN FALSE; 
    END IF;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Update the RLS policy for Deals INSERT to enforce the subscription check
DROP POLICY IF EXISTS "deals_insert_seller" ON deals;
CREATE POLICY "deals_insert_seller" ON deals FOR INSERT 
WITH CHECK (
    auth.uid()::text = store_id AND 
    can_seller_add_deal(auth.uid()::text)
);
