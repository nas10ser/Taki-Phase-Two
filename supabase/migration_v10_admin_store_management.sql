-- Migration v10: Admin Store Management and Subscriptions
-- Adds columns to store_profiles for managing subscriptions, grants, and pinning.

ALTER TABLE store_profiles
ADD COLUMN IF NOT EXISTS subscription_plan TEXT DEFAULT 'trial',
ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '14 days',
ADD COLUMN IF NOT EXISTS discount_percentage INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS max_branches INTEGER DEFAULT 3;

-- Allow admin to update any store_profile
DROP POLICY IF EXISTS "store_profiles_update_admin" ON store_profiles;
CREATE POLICY "store_profiles_update_admin" ON store_profiles
FOR UPDATE USING (
    auth.uid()::text IN (SELECT id FROM users WHERE user_type = 'admin')
) WITH CHECK (
    auth.uid()::text IN (SELECT id FROM users WHERE user_type = 'admin')
);

-- Allow admin to read all store_profiles (already true via "store_profiles_select_all" USING (true))

-- To allow admin to read all users (important for the dashboard)
DROP POLICY IF EXISTS "users_select_admin" ON users;
CREATE POLICY "users_select_admin" ON users
FOR SELECT USING (
    auth.uid()::text IN (SELECT id FROM users WHERE user_type = 'admin')
);
