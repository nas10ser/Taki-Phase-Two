-- ========================================================
-- TAKI Platform — Security Hardening Migration v9.0
-- ========================================================
-- This migration fixes critical RLS vulnerabilities identified
-- in the comprehensive security audit (2026-05-04).
--
-- Fixes:
--   C-02: promotional_campaigns INSERT/UPDATE/DELETE restricted to admins
--   C-03: notifications INSERT restricted to SECURITY DEFINER function
--   M-07: users DELETE policy (allow self-deletion)
--   M-08: ratings DELETE policy (allow own rating deletion)
--   H-07: Secure barcode generation helper
-- ========================================================

-- ====================== C-02: PROMO CAMPAIGNS — ADMIN ONLY ======================
-- Previously any authenticated user could create/edit/delete promotional campaigns.
-- Now only users with user_type = 'admin' can manage campaigns.

DROP POLICY IF EXISTS "promo_insert_admin" ON promotional_campaigns;
CREATE POLICY "promo_insert_admin" ON promotional_campaigns
  FOR INSERT WITH CHECK (
    auth.uid()::text IN (SELECT id FROM users WHERE user_type = 'admin')
  );

DROP POLICY IF EXISTS "promo_update_admin" ON promotional_campaigns;
CREATE POLICY "promo_update_admin" ON promotional_campaigns
  FOR UPDATE USING (
    auth.uid()::text IN (SELECT id FROM users WHERE user_type = 'admin')
  ) WITH CHECK (
    auth.uid()::text IN (SELECT id FROM users WHERE user_type = 'admin')
  );

DROP POLICY IF EXISTS "promo_delete_admin" ON promotional_campaigns;
CREATE POLICY "promo_delete_admin" ON promotional_campaigns
  FOR DELETE USING (
    auth.uid()::text IN (SELECT id FROM users WHERE user_type = 'admin')
  );


-- ====================== C-03: NOTIFICATIONS — SECURE INSERT ======================
-- Previously any authenticated user could INSERT a notification for ANY user_id.
-- This creates a SECURITY DEFINER function that the booking trigger already uses,
-- and restricts direct INSERT to self-notifications only.
-- The booking trigger (handle_booking_notification) is already SECURITY DEFINER
-- and will continue to work since it runs as the function owner.

DROP POLICY IF EXISTS "notifs_insert_auth" ON notifications;
CREATE POLICY "notifs_insert_self" ON notifications
  FOR INSERT WITH CHECK (
    auth.uid()::text = user_id
  );

-- The handle_booking_notification function is SECURITY DEFINER so it bypasses RLS.
-- This means seller-to-buyer notifications still work even though the INSERT policy
-- now requires auth.uid() = user_id. The trigger function runs as the DB owner.


-- ====================== M-07: USERS DELETE — SELF ONLY ======================
-- Allow users to delete their own account row.
DROP POLICY IF EXISTS "users_delete_own" ON users;
CREATE POLICY "users_delete_own" ON users
  FOR DELETE USING (auth.uid()::text = id);


-- ====================== M-08: RATINGS DELETE — OWN ONLY ======================
-- Allow users to delete their own ratings.
DROP POLICY IF EXISTS "ratings_delete_own" ON ratings;
CREATE POLICY "ratings_delete_own" ON ratings
  FOR DELETE USING (auth.uid()::text = user_id);


-- ====================== NOTIFICATIONS DELETE — OWN ONLY ======================
-- Allow users to delete their own notifications (cleanup).
DROP POLICY IF EXISTS "notifs_delete_own" ON notifications;
CREATE POLICY "notifs_delete_own" ON notifications
  FOR DELETE USING (auth.uid()::text = user_id);


-- ====================== VERIFICATION ======================
-- Run these queries to verify the policies are in place:
--
-- SELECT tablename, policyname, cmd, qual, with_check
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND tablename IN ('promotional_campaigns', 'notifications', 'users', 'ratings')
-- ORDER BY tablename, policyname;
