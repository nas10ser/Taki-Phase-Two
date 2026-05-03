-- ========================================================
-- TAKI Migration v7.4 — Cleanup phantom accounts + 10-min
-- verification timeout
-- ========================================================
-- Run this in the Supabase SQL Editor.
--
-- Background:
--   The previous version of authService.checkEmailExists()
--   called supabase.auth.signUp() as a "fallback existence
--   check". For NEW emails this side-effect actually CREATED
--   a real auth user with a random password. The result: any
--   buyer who typed their email during login got a phantom
--   auth row with the wrong password, and every subsequent
--   real login attempt failed with "Invalid login
--   credentials".
--
-- This migration does three things:
--   1. Deletes existing phantom auth rows (unconfirmed,
--      no metadata, never reached public.users).
--   2. Installs cancel_unverified_signup(text) so the client
--      can drop unconfirmed rows when the 10-min verify
--      timeout fires.
--   3. Installs an optional pg_cron job to sweep stale
--      unconfirmed rows every minute (best-effort cleanup).
-- ========================================================

-- ---------- 1. One-time phantom cleanup ----------
-- A "phantom" row is an auth.users record that:
--   - was never confirmed (email_confirmed_at IS NULL)
--   - has no real user_metadata (no user_type / name / phone)
--   - has no matching row in public.users
DELETE FROM auth.users a
WHERE a.email_confirmed_at IS NULL
  AND (
        a.raw_user_meta_data IS NULL
     OR a.raw_user_meta_data = '{}'::jsonb
     OR NOT (a.raw_user_meta_data ? 'user_type')
  )
  AND NOT EXISTS (
        SELECT 1 FROM public.users p WHERE p.id = a.id::text
  );

-- ---------- 2. cancel_unverified_signup() RPC ----------
-- Called by the client when the 10-minute verification
-- window closes. SECURITY DEFINER lets the anon role drop
-- the row without granting general delete on auth.users.
-- Safety: only deletes if email is still unconfirmed AND
-- the row is older than 10 minutes (so a slow verify can't
-- be raced by a malicious caller).
CREATE OR REPLACE FUNCTION public.cancel_unverified_signup(target_email TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    DELETE FROM auth.users
     WHERE email = target_email
       AND email_confirmed_at IS NULL
       AND created_at < NOW() - INTERVAL '10 minutes';
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_unverified_signup(TEXT) TO anon, authenticated;

-- ---------- 3. Optional periodic sweep ----------
-- Requires the pg_cron extension (Supabase: Database →
-- Extensions → enable pg_cron). Safe to skip if you only
-- want client-driven cleanup.
--
-- Uncomment the block below after enabling pg_cron:
--
-- SELECT cron.schedule(
--     'taki_sweep_unverified',
--     '* * * * *',  -- every minute
--     $$DELETE FROM auth.users
--        WHERE email_confirmed_at IS NULL
--          AND created_at < NOW() - INTERVAL '10 minutes'
--          AND (raw_user_meta_data IS NULL
--               OR raw_user_meta_data = '{}'::jsonb
--               OR NOT (raw_user_meta_data ? 'user_type'))$$
-- );

-- ---------- Verification ----------
-- After running, this should return 0:
--   SELECT count(*) FROM auth.users
--    WHERE email_confirmed_at IS NULL
--      AND (raw_user_meta_data IS NULL
--           OR raw_user_meta_data = '{}'::jsonb
--           OR NOT (raw_user_meta_data ? 'user_type'));
