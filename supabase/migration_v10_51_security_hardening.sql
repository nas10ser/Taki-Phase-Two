-- ════════════════════════════════════════════════════════════════════
-- TAKI v10.51 — Security hardening
--
-- Applied directly via the Supabase MCP migration tool. Tracked here for
-- repo provenance and re-applicability on fresh environments.
--
-- Context: Supabase advisor flagged 143 issues (May 2026) — 1 ERROR
-- (RLS disabled on sa_cities_geo) and 142 WARN. This migration resolves
-- the 1 ERROR, 16 mutable-search_path WARNs, 2 always-true-RLS WARNs,
-- 1 public-bucket-listing WARN, and the 6 cron-only SECURITY DEFINER
-- functions that were callable by any authenticated user.
-- Result after migration: 0 ERRORs, 32 WARNs cleared (143 → 111
-- remaining are intentional client-facing RPCs that already enforce
-- is_admin internally + 1 Dashboard-only auth setting).
-- ════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────
-- Part 1: RLS + policies + storage
-- ─────────────────────────────────────────────────────────────────────

-- 1.1 sa_cities_geo (Saudi-cities geo lookup powering find_nearest_sa_city)
-- Previously had RLS disabled — anon could delete every row.
ALTER TABLE public.sa_cities_geo ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sa_cities_geo_read_all ON public.sa_cities_geo;
CREATE POLICY sa_cities_geo_read_all
ON public.sa_cities_geo FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS sa_cities_geo_admin_write ON public.sa_cities_geo;
CREATE POLICY sa_cities_geo_admin_write
ON public.sa_cities_geo FOR ALL TO authenticated
USING (public.is_admin((auth.uid())::text))
WITH CHECK (public.is_admin((auth.uid())::text));


-- 1.2 booking_messages — drop the unrestricted UPDATE policy.
-- The recipient was allowed to UPDATE with WITH CHECK = true, meaning
-- they could rewrite sender_role / content / barcode of any message
-- whose conversation they were a party to. The mark_booking_messages_read
-- RPC is SECURITY DEFINER and bypasses RLS, so removing the policy does
-- not break the read-receipt feature.
DROP POLICY IF EXISTS booking_messages_update_recipient ON public.booking_messages;


-- 1.3 store_analytics_events — drop unrestricted INSERT.
-- All writes funnel through SECURITY DEFINER RPCs
-- (record_analytics_events, increment_deal_view, increment_deal_click)
-- so direct INSERT from any role is never needed.
DROP POLICY IF EXISTS an_insert_anyone ON public.store_analytics_events;


-- 1.4 storage 'deals' bucket — auth-only upload, image MIME, 10 MB cap.
-- Previously: anon could upload arbitrary files, and the broad SELECT
-- policy enabled listing every file in the bucket.
DROP POLICY IF EXISTS "Allow anyone to upload images" ON storage.objects;
DROP POLICY IF EXISTS "Allow public to see images" ON storage.objects;

CREATE POLICY "Authenticated users upload deal images"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
    bucket_id = 'deals'
    AND (LOWER(name) LIKE '%.jpg'
         OR LOWER(name) LIKE '%.jpeg'
         OR LOWER(name) LIKE '%.png'
         OR LOWER(name) LIKE '%.webp'
         OR LOWER(name) LIKE '%.gif')
);

CREATE POLICY "Authenticated users replace own deal images"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'deals' AND owner = auth.uid())
WITH CHECK (bucket_id = 'deals' AND owner = auth.uid());

CREATE POLICY "Authenticated users delete own deal images"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'deals' AND owner = auth.uid());

-- Bucket itself is flagged public=true, so getPublicUrl(...) keeps working
-- for direct CDN reads — but the listing endpoint now requires auth,
-- preventing enumeration. Add a hard MIME + size cap on the bucket.
UPDATE storage.buckets
SET file_size_limit = 10485760,
    allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp','image/gif']
WHERE id = 'deals';


-- ─────────────────────────────────────────────────────────────────────
-- Part 2: Pin search_path on 16 functions
-- ─────────────────────────────────────────────────────────────────────

ALTER FUNCTION public.adjust_deal_quantity() SET search_path = 'public';
ALTER FUNCTION public.broadcast_campaign(p_campaign_id text) SET search_path = 'public';
ALTER FUNCTION public.compute_subscription_price(p_plan_id text, p_branches integer, p_discount_percent numeric) SET search_path = 'public';
ALTER FUNCTION public.delete_user_account() SET search_path = 'public';
ALTER FUNCTION public.find_nearest_sa_city(p_lat double precision, p_lng double precision) SET search_path = 'public';
ALTER FUNCTION public.get_pinned_store_ids(p_city text, p_mall text) SET search_path = 'public';
ALTER FUNCTION public.guard_booking_status() SET search_path = 'public';
ALTER FUNCTION public.handle_booking_message_notification() SET search_path = 'public';
ALTER FUNCTION public.handle_deleted_user() SET search_path = 'public';
ALTER FUNCTION public.handle_follow_notification() SET search_path = 'public';
ALTER FUNCTION public.handle_new_user() SET search_path = 'public';
ALTER FUNCTION public.handle_notification_push() SET search_path = 'public';
ALTER FUNCTION public.is_admin(uid text) SET search_path = 'public';
ALTER FUNCTION public.send_trial_ending_notifications() SET search_path = 'public';
ALTER FUNCTION public.taki_haversine_km(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision) SET search_path = 'public';
ALTER FUNCTION public.update_updated_at() SET search_path = 'public';


-- ─────────────────────────────────────────────────────────────────────
-- Part 3: Lock down cron-only SECURITY DEFINER functions
-- ─────────────────────────────────────────────────────────────────────
-- These six are intended for the scheduler — never called from the
-- client — and they lack an internal admin role check. Any authenticated
-- user could call them via /rpc/... and mass-mutate data
-- (mass-delete accounts, force-expire trials, wipe analytics, etc.).
-- The seven admin_* / grant_subscription_bulk / broadcast_campaign
-- functions are NOT revoked because the client (admin dashboard) calls
-- them and they each enforce `user_type = 'admin'` internally.
REVOKE EXECUTE ON FUNCTION public.purge_expired_accounts()                    FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.expire_trials()                             FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_old_activity()                      FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prune_analytics_events(p_keep_days integer) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.send_trial_ending_notifications()           FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.send_trial_warnings()                       FROM anon, authenticated, PUBLIC;


-- ─────────────────────────────────────────────────────────────────────
-- Dashboard-only: enable Leaked Password Protection.
-- This setting cannot be changed via SQL — toggle it in:
--   Supabase Dashboard → Authentication → Settings → "Password Security"
--   → "Check passwords against HaveIBeenPwned database"
-- ─────────────────────────────────────────────────────────────────────
