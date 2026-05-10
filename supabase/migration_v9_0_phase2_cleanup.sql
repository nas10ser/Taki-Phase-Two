-- ============================================================
-- TAKI Platform — Phase 2 Cleanup (run BEFORE v9_1..v9_4)
-- ============================================================
-- Purpose: remove the lightweight Phase-2 prototype installed by
-- migrations v10..v14 so it doesn't fight the richer schema in
-- v9_1..v9_4. Idempotent: safe to run even if some objects don't
-- exist.
--
-- What this drops:
--   • tr_new_seller_trial (v12) — duplicates v9_1's tr_auto_start_trial
--   • can_seller_add_deal() (v11) — v9_1 uses tr_guard_deal_publish instead
--   • The "deals_insert_seller" RLS policy is restored to the simple
--     auth.uid()=store_id check; the new BEFORE-INSERT trigger gates
--     publishing centrally based on merchant_subscriptions.
--
-- What this KEEPS untouched:
--   • global_settings table (you may continue to use it freely; the
--     new platform_settings table holds JSONB values used by Phase 2)
--   • store_profiles.subscription_plan / expires_at columns (kept for
--     backwards compatibility — Phase 2 reads from merchant_subscriptions)
--   • deals.views / deals.clicks — coexist fine with the event-stream
--   • banners table is NOT created here. Skip v14 entirely; the
--     unified sponsorships table (v9_3) covers banners + sliders +
--     sponsored deals + native ads in one model.
-- ============================================================

-- 1. Drop the duplicate trial trigger from v12.
DROP TRIGGER IF EXISTS tr_new_seller_trial ON public.users;
DROP FUNCTION IF EXISTS public.handle_new_seller_trial();

-- 2. Replace the insert RLS that depends on can_seller_add_deal
--    with the original simple "owner-only" rule. The new
--    tr_guard_deal_publish trigger (created by v9_1) does the
--    real subscription gating so the policy can stay simple.
DROP POLICY IF EXISTS "deals_insert_seller" ON public.deals;
CREATE POLICY "deals_insert_seller" ON public.deals FOR INSERT
    WITH CHECK (auth.uid()::text = store_id);

-- 3. Now it is safe to drop the helper function from v11.
DROP FUNCTION IF EXISTS public.can_seller_add_deal(TEXT);

-- 4. Optional: backfill merchant_subscriptions from the legacy
--    store_profiles trial so existing trials continue counting from
--    the same start date. This INSERT is also a no-op when v9_1
--    has already filled the row.
--    SAFE: ON CONFLICT DO NOTHING — runs only when nothing is there.
DO $cleanup$
BEGIN
    -- Only attempt the backfill if v9_1 has already run.
    IF to_regclass('public.merchant_subscriptions') IS NOT NULL
       AND to_regclass('public.subscription_plans') IS NOT NULL
       AND to_regclass('public.store_profiles') IS NOT NULL THEN
        EXECUTE $sql$
            INSERT INTO public.merchant_subscriptions
                (merchant_id, plan_id, status, trial_starts_at, trial_ends_at, branches_count)
            SELECT sp.store_id,
                   (SELECT id FROM public.subscription_plans WHERE code='basic' LIMIT 1),
                   CASE WHEN sp.subscription_expires_at > NOW() THEN 'trial' ELSE 'frozen' END,
                   sp.subscription_expires_at - INTERVAL '14 days',
                   sp.subscription_expires_at,
                   1
            FROM public.store_profiles sp
            JOIN public.users u ON u.id = sp.store_id
            WHERE u.user_type = 'seller'
              AND sp.subscription_expires_at IS NOT NULL
            ON CONFLICT (merchant_id) DO NOTHING;
        $sql$;
    END IF;
END
$cleanup$;
