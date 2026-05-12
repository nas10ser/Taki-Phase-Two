-- ============================================================================
-- v10.41 — Let the deal-publish trigger fan notifications to followers
-- ============================================================================
--
-- Symptom seller saw, with a fully-valid 4-image deal:
--     ⚠️ تم الحفظ محلياً لكن المزامنة مع السيرفر فشلت...
--     (new row violates row-level security policy for table "notifications")
--
-- Root cause: `handle_deal_smart_notifications` (AFTER INSERT trigger on
-- deals) inserts notification rows on behalf of every follower /
-- smart-alert subscriber whose criteria match the new deal. The RLS
-- policy on notifications is `notifs_insert_self`, requiring
-- `user_id = auth.uid()`. The trigger runs as the SELLER, so any
-- INSERT with `user_id = <follower-id>` violates the policy. Postgres
-- aborts the trigger, which aborts the deals INSERT, which makes the
-- client think the save failed and surface the error toast.
--
-- Fix: redeclare the trigger function as SECURITY DEFINER + pin
-- search_path. It now runs with the function-owner's (postgres)
-- privileges and bypasses RLS for the fan-out INSERTs. Same logical
-- behavior; no new attack surface because the trigger only fires on
-- a successful INSERT to deals, which is gated by
-- `deals_insert_seller` (auth.uid() = store_id).
--
-- Applied via Supabase MCP on 2026-05-12.

ALTER FUNCTION public.handle_deal_smart_notifications() SECURITY DEFINER;
ALTER FUNCTION public.handle_deal_smart_notifications() SET search_path = public;
