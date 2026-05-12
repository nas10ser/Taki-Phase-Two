-- ============================================================================
-- v10.38 — Fix infinite recursion in users RLS policies (CRITICAL)
-- ============================================================================
--
-- Symptom: every saveProfile / updateProfile call from the app silently
-- failed. Sellers could fill out the Add Deal form, hit Save, watch the
-- spinner spin, and see no error — the deal was never persisted to DB.
-- Same for "Save as Permanent Shop Location". The form looked broken.
--
-- Root cause: two RLS policies on `public.users` checked admin status
-- with an inline subquery that re-queried `users`:
--
--     EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid()::text
--                                     AND u.user_type = 'admin')
--
-- That subquery itself triggers the same SELECT policy on users, which
-- re-runs the subquery, forever. PostgREST surfaces it as
--     "infinite recursion detected in policy for relation 'users'"
--
-- The recursion broke:
--   1. Direct upserts on users  → updateProfile / saveProfile
--   2. INSERTs on deals — because the smart-notifications trigger does
--      `SELECT id, smart_alerts, followed_merchants FROM users` to fan
--      notifications out to followers, which re-triggers users RLS.
--
-- Fix: use the existing `is_admin()` SECURITY DEFINER function instead
-- of the inline subquery. SECURITY DEFINER bypasses RLS, so no
-- recursion. Same logical behavior.
--
-- Applied via Supabase MCP on 2026-05-12. This file is the source of
-- truth checked into the repo.

DROP POLICY IF EXISTS users_select_all ON public.users;
CREATE POLICY users_select_all ON public.users
    FOR SELECT
    USING (
        (deleted_at IS NULL)
        OR ((auth.uid())::text = id)
        OR is_admin()
    );

DROP POLICY IF EXISTS users_update_admin ON public.users;
CREATE POLICY users_update_admin ON public.users
    FOR UPDATE
    USING (is_admin() OR ((auth.uid())::text = id))
    WITH CHECK (is_admin() OR ((auth.uid())::text = id));
