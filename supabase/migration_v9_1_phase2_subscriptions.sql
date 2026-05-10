-- ============================================================
-- TAKI Platform — Phase 2.1 Subscription Engine (Server-Side)
-- ============================================================
-- This migration introduces:
--   1. subscription_plans (admin-editable plan catalogue)
--   2. merchant_subscriptions (one row per seller; trial/active/frozen)
--   3. subscription_payments (immutable invoice ledger)
--   4. platform_settings (hidden payment-gateway toggle, prices, trial length)
--   5. RPCs:
--        - start_trial_for_merchant(uuid)
--        - grant_subscription(merchant_ids[], type, duration_days, discount, reason)
--        - ensure_active_subscription(uuid) → bool
--        - update_branch_count_billing(uuid)
--        - mark_payment_paid(payment_id, gateway_ref)
--   6. Trigger: BEFORE INSERT on deals → block when subscription is frozen
--   7. Trigger: AFTER INSERT on users (seller) → auto-start 14d trial
--   8. RLS: sellers see their own; admin sees everything; payments are
--      immutable from clients (only RPC mutates).
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ====================== 1. PLATFORM SETTINGS ======================
-- Singleton config table — admin-only. The "hide payment gateway" master
-- switch lives here so a single SQL UPDATE flips the entire app to free.

CREATE TABLE IF NOT EXISTS platform_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    updated_by TEXT REFERENCES users(id),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO platform_settings (key, value, description) VALUES
    ('payment_gateway_enabled', 'false'::jsonb,
     'Master switch: when false, the entire payment UI is hidden and the platform behaves as fully free. Trials and grants still work. Set to true once a real gateway is provisioned.'),
    ('payment_gateway_provider', '"moyasar"'::jsonb,
     'Provider id: "moyasar" or "paytabs". Only consulted when payment_gateway_enabled = true.'),
    ('payment_publishable_key', '""'::jsonb,
     'Public key for the chosen gateway (safe to expose to the browser).'),
    ('basic_plan_price_sar', '99'::jsonb,
     'Default monthly price for the basic plan in SAR. Editable per-plan in subscription_plans.'),
    ('extra_branch_fee_sar', '25'::jsonb,
     'Default fee per additional branch beyond included. Editable per-plan.'),
    ('included_branches', '3'::jsonb,
     'How many branches the basic plan covers before extra fees kick in.'),
    ('trial_days', '14'::jsonb,
     'Length of the new-merchant free trial.'),
    ('trial_warning_days_before', '3'::jsonb,
     'Send the trial-ending warning notification this many days before trial_ends_at.')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "settings_select_all" ON platform_settings;
CREATE POLICY "settings_select_all" ON platform_settings FOR SELECT USING (true);
DROP POLICY IF EXISTS "settings_write_admin" ON platform_settings;
CREATE POLICY "settings_write_admin" ON platform_settings FOR ALL
    USING (auth.uid()::text IN (SELECT id FROM users WHERE user_type = 'admin'))
    WITH CHECK (auth.uid()::text IN (SELECT id FROM users WHERE user_type = 'admin'));

-- ====================== 2. SUBSCRIPTION PLANS ======================
CREATE TABLE IF NOT EXISTS subscription_plans (
    id TEXT PRIMARY KEY DEFAULT 'plan_' || extract(epoch from now())::text || substr(md5(random()::text), 1, 5),
    code TEXT UNIQUE NOT NULL,
    name_ar TEXT NOT NULL,
    name_en TEXT NOT NULL,
    description_ar TEXT,
    description_en TEXT,
    price_monthly NUMERIC NOT NULL DEFAULT 0,
    price_yearly NUMERIC,
    included_branches INTEGER NOT NULL DEFAULT 3,
    extra_branch_fee NUMERIC NOT NULL DEFAULT 25,
    max_deals_per_month INTEGER,
    features_ar JSONB DEFAULT '[]'::jsonb,
    features_en JSONB DEFAULT '[]'::jsonb,
    is_active BOOLEAN DEFAULT TRUE,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO subscription_plans (code, name_ar, name_en, description_ar, description_en, price_monthly, included_branches, extra_branch_fee, features_ar, features_en, sort_order)
VALUES
    ('basic', 'الباقة الأساسية', 'Basic Package',
     'اشتراك شهري ثابت بدون عمولة على الحجوزات، يغطي حتى 3 فروع.',
     'Flat monthly subscription with zero commission per booking. Includes up to 3 branches.',
     99, 3, 25,
     '["✅ بدون عمولة على الحجوزات","✅ حتى 3 مواقع/فروع","✅ عروض غير محدودة","✅ تحليلات متجرك بالتفصيل","✅ الدعم الفني"]'::jsonb,
     '["✅ Zero booking commission","✅ Up to 3 locations / branches","✅ Unlimited deals","✅ Full store analytics","✅ Technical support"]'::jsonb,
     10)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE subscription_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "plans_select_all" ON subscription_plans;
CREATE POLICY "plans_select_all" ON subscription_plans FOR SELECT USING (true);
DROP POLICY IF EXISTS "plans_write_admin" ON subscription_plans;
CREATE POLICY "plans_write_admin" ON subscription_plans FOR ALL
    USING (auth.uid()::text IN (SELECT id FROM users WHERE user_type = 'admin'))
    WITH CHECK (auth.uid()::text IN (SELECT id FROM users WHERE user_type = 'admin'));

-- ====================== 3. MERCHANT SUBSCRIPTIONS ======================
CREATE TABLE IF NOT EXISTS merchant_subscriptions (
    id TEXT PRIMARY KEY DEFAULT 'sub_' || extract(epoch from now())::text || substr(md5(random()::text), 1, 6),
    merchant_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    plan_id TEXT REFERENCES subscription_plans(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'trial'
        CHECK (status IN ('trial','active','past_due','frozen','cancelled','gifted')),
    trial_starts_at TIMESTAMPTZ,
    trial_ends_at TIMESTAMPTZ,
    current_period_start TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    discount_percent NUMERIC DEFAULT 0 CHECK (discount_percent >= 0 AND discount_percent <= 100),
    granted_by_admin TEXT REFERENCES users(id) ON DELETE SET NULL,
    grant_reason TEXT,
    grant_expires_at TIMESTAMPTZ,
    branches_count INTEGER NOT NULL DEFAULT 1,
    last_renewed_at TIMESTAMPTZ,
    last_warning_sent_at TIMESTAMPTZ,
    cancel_at_period_end BOOLEAN DEFAULT FALSE,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subs_merchant ON merchant_subscriptions(merchant_id);
CREATE INDEX IF NOT EXISTS idx_subs_status ON merchant_subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subs_trial_end ON merchant_subscriptions(trial_ends_at)
    WHERE status = 'trial';
CREATE INDEX IF NOT EXISTS idx_subs_period_end ON merchant_subscriptions(current_period_end)
    WHERE status IN ('active','past_due','gifted');

ALTER TABLE merchant_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "subs_select_self_or_admin" ON merchant_subscriptions;
CREATE POLICY "subs_select_self_or_admin" ON merchant_subscriptions FOR SELECT USING (
    auth.uid()::text = merchant_id
    OR auth.uid()::text IN (SELECT id FROM users WHERE user_type = 'admin')
);
-- Sellers cannot mutate their own subscription directly — only via RPCs.
-- Admins have full control through the same RPCs (which check the role).
DROP POLICY IF EXISTS "subs_admin_write" ON merchant_subscriptions;
CREATE POLICY "subs_admin_write" ON merchant_subscriptions FOR ALL
    USING (auth.uid()::text IN (SELECT id FROM users WHERE user_type = 'admin'))
    WITH CHECK (auth.uid()::text IN (SELECT id FROM users WHERE user_type = 'admin'));

-- Auto-touch updated_at
DROP TRIGGER IF EXISTS set_updated_at_subs ON merchant_subscriptions;
CREATE TRIGGER set_updated_at_subs BEFORE UPDATE ON merchant_subscriptions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ====================== 4. SUBSCRIPTION PAYMENTS (LEDGER) ======================
CREATE TABLE IF NOT EXISTS subscription_payments (
    id TEXT PRIMARY KEY DEFAULT 'pay_' || extract(epoch from now())::text || substr(md5(random()::text), 1, 6),
    subscription_id TEXT REFERENCES merchant_subscriptions(id) ON DELETE SET NULL,
    merchant_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    plan_id TEXT REFERENCES subscription_plans(id) ON DELETE SET NULL,
    amount NUMERIC NOT NULL,
    currency TEXT NOT NULL DEFAULT 'SAR',
    status TEXT NOT NULL CHECK (status IN ('pending','paid','failed','refunded','gifted')),
    payment_method TEXT,
    gateway_provider TEXT,        -- 'paytabs' | 'moyasar' | 'admin_grant'
    gateway_reference TEXT,
    branches_count INTEGER,
    period_start TIMESTAMPTZ,
    period_end TIMESTAMPTZ,
    discount_percent NUMERIC DEFAULT 0,
    metadata JSONB DEFAULT '{}'::jsonb,
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pay_merchant ON subscription_payments(merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pay_status ON subscription_payments(status);
CREATE INDEX IF NOT EXISTS idx_pay_gateway_ref ON subscription_payments(gateway_reference)
    WHERE gateway_reference IS NOT NULL;

ALTER TABLE subscription_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pay_select_self_or_admin" ON subscription_payments;
CREATE POLICY "pay_select_self_or_admin" ON subscription_payments FOR SELECT USING (
    auth.uid()::text = merchant_id
    OR auth.uid()::text IN (SELECT id FROM users WHERE user_type = 'admin')
);
-- Payments are immutable from the client — only the SECURITY DEFINER RPC
-- (or admin) can write.
DROP POLICY IF EXISTS "pay_admin_write" ON subscription_payments;
CREATE POLICY "pay_admin_write" ON subscription_payments FOR ALL
    USING (auth.uid()::text IN (SELECT id FROM users WHERE user_type = 'admin'))
    WITH CHECK (auth.uid()::text IN (SELECT id FROM users WHERE user_type = 'admin'));

-- ====================== 5. RPCs ======================

-- Reads a setting value with a fallback (avoids exceptions in callers).
CREATE OR REPLACE FUNCTION public.get_setting(p_key TEXT, p_default JSONB DEFAULT NULL)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT COALESCE((SELECT value FROM platform_settings WHERE key = p_key), p_default);
$$;

-- Compute the price for a given plan + branch count (after discount).
CREATE OR REPLACE FUNCTION public.compute_subscription_price(
    p_plan_id TEXT,
    p_branches INTEGER,
    p_discount_percent NUMERIC DEFAULT 0
)
RETURNS NUMERIC
LANGUAGE plpgsql STABLE
AS $$
DECLARE
    v_plan RECORD;
    v_extra_branches INTEGER;
    v_total NUMERIC;
BEGIN
    SELECT * INTO v_plan FROM subscription_plans WHERE id = p_plan_id LIMIT 1;
    IF v_plan IS NULL THEN
        RETURN 0;
    END IF;

    v_extra_branches := GREATEST(0, COALESCE(p_branches, 1) - COALESCE(v_plan.included_branches, 3));
    v_total := COALESCE(v_plan.price_monthly, 0) + (v_extra_branches * COALESCE(v_plan.extra_branch_fee, 0));

    IF p_discount_percent IS NOT NULL AND p_discount_percent > 0 THEN
        v_total := v_total * (1 - p_discount_percent / 100.0);
    END IF;

    RETURN ROUND(v_total::numeric, 2);
END;
$$;

-- Returns TRUE when a merchant can publish/edit deals (trial, active, gifted).
CREATE OR REPLACE FUNCTION public.ensure_active_subscription(p_merchant_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_status TEXT;
    v_period_end TIMESTAMPTZ;
    v_trial_end TIMESTAMPTZ;
BEGIN
    SELECT status, current_period_end, trial_ends_at
      INTO v_status, v_period_end, v_trial_end
      FROM merchant_subscriptions
     WHERE merchant_id = p_merchant_id;

    IF v_status IS NULL THEN
        RETURN FALSE;
    END IF;

    IF v_status = 'trial' AND v_trial_end IS NOT NULL AND v_trial_end > NOW() THEN
        RETURN TRUE;
    END IF;

    IF v_status IN ('active','gifted') AND
       (v_period_end IS NULL OR v_period_end > NOW()) THEN
        RETURN TRUE;
    END IF;

    RETURN FALSE;
END;
$$;

-- Auto-create a trial row when a new seller signs up.
CREATE OR REPLACE FUNCTION public.start_trial_for_merchant(p_merchant_id TEXT)
RETURNS merchant_subscriptions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_trial_days INTEGER;
    v_basic_plan_id TEXT;
    v_existing merchant_subscriptions;
    v_new merchant_subscriptions;
BEGIN
    SELECT * INTO v_existing FROM merchant_subscriptions WHERE merchant_id = p_merchant_id;
    IF v_existing IS NOT NULL THEN
        RETURN v_existing;
    END IF;

    v_trial_days := COALESCE((get_setting('trial_days', '14'::jsonb))::int, 14);
    SELECT id INTO v_basic_plan_id FROM subscription_plans WHERE code = 'basic' LIMIT 1;

    INSERT INTO merchant_subscriptions (
        merchant_id, plan_id, status,
        trial_starts_at, trial_ends_at, branches_count
    )
    VALUES (
        p_merchant_id, v_basic_plan_id, 'trial',
        NOW(), NOW() + (v_trial_days || ' days')::interval, 1
    )
    RETURNING * INTO v_new;

    RETURN v_new;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_trial_for_merchant(TEXT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.ensure_active_subscription(TEXT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.compute_subscription_price(TEXT, INTEGER, NUMERIC) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_setting(TEXT, JSONB) TO authenticated, anon;

-- Admin-only: bulk grant subscription to N merchants.
-- p_grant_type: 'free' (gifted) | 'discount' (active with discount_percent)
-- p_duration_days: how long the grant lasts
-- p_discount_percent: 0..100 (only meaningful for 'discount')
CREATE OR REPLACE FUNCTION public.grant_subscription_bulk(
    p_merchant_ids TEXT[],
    p_grant_type TEXT,
    p_duration_days INTEGER,
    p_discount_percent NUMERIC DEFAULT 0,
    p_reason TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_caller_role TEXT;
    v_basic_plan_id TEXT;
    v_count INTEGER := 0;
    v_merchant TEXT;
    v_status TEXT;
    v_now TIMESTAMPTZ := NOW();
    v_period_end TIMESTAMPTZ;
BEGIN
    SELECT user_type INTO v_caller_role FROM users WHERE id = auth.uid()::text;
    IF v_caller_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Only admins can grant subscriptions';
    END IF;

    IF p_grant_type NOT IN ('free','discount') THEN
        RAISE EXCEPTION 'Invalid grant type: %', p_grant_type;
    END IF;

    IF p_duration_days IS NULL OR p_duration_days <= 0 THEN
        RAISE EXCEPTION 'Duration must be > 0 days';
    END IF;

    SELECT id INTO v_basic_plan_id FROM subscription_plans WHERE code = 'basic' LIMIT 1;
    v_period_end := v_now + (p_duration_days || ' days')::interval;
    v_status := CASE WHEN p_grant_type = 'free' THEN 'gifted' ELSE 'active' END;

    FOREACH v_merchant IN ARRAY p_merchant_ids LOOP
        -- Ensure a row exists, then update it.
        INSERT INTO merchant_subscriptions (merchant_id, plan_id, status, branches_count)
        VALUES (v_merchant, v_basic_plan_id, v_status, 1)
        ON CONFLICT (merchant_id) DO NOTHING;

        UPDATE merchant_subscriptions
        SET status = v_status,
            plan_id = COALESCE(plan_id, v_basic_plan_id),
            current_period_start = v_now,
            current_period_end = v_period_end,
            grant_expires_at = v_period_end,
            granted_by_admin = auth.uid()::text,
            grant_reason = p_reason,
            discount_percent = CASE WHEN p_grant_type = 'discount' THEN p_discount_percent ELSE 0 END,
            last_renewed_at = v_now,
            updated_at = v_now
        WHERE merchant_id = v_merchant;

        -- Ledger entry: 0 SAR for free, discounted price for discount.
        INSERT INTO subscription_payments (
            subscription_id, merchant_id, plan_id, amount, currency,
            status, payment_method, gateway_provider,
            period_start, period_end, branches_count, discount_percent, metadata
        )
        SELECT s.id, v_merchant, s.plan_id,
               CASE WHEN p_grant_type = 'free' THEN 0
                    ELSE compute_subscription_price(s.plan_id, s.branches_count, p_discount_percent) END,
               'SAR',
               CASE WHEN p_grant_type = 'free' THEN 'gifted' ELSE 'paid' END,
               'admin_grant', 'admin_grant',
               v_now, v_period_end, s.branches_count,
               COALESCE(p_discount_percent, 0),
               jsonb_build_object('reason', p_reason, 'granted_by', auth.uid()::text)
          FROM merchant_subscriptions s WHERE s.merchant_id = v_merchant;

        -- Notification to the merchant.
        INSERT INTO notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data)
        VALUES (v_merchant,
            CASE WHEN p_grant_type = 'free' THEN '🎁 تم تفعيل اشتراك مجاني!'
                 ELSE '🎉 تم تفعيل خصم خاص على اشتراكك!' END,
            CASE WHEN p_grant_type = 'free' THEN '🎁 Free subscription activated!'
                 ELSE '🎉 Special discount activated on your subscription!' END,
            CASE WHEN p_grant_type = 'free'
                 THEN 'منحتك إدارة TAKI اشتراكاً مجانياً لمدة ' || p_duration_days || ' يوماً. ابدأ بنشر عروضك الآن! 💚'
                 ELSE 'حصلت على خصم ' || p_discount_percent || '% على الاشتراك لمدة ' || p_duration_days || ' يوماً.' END,
            CASE WHEN p_grant_type = 'free'
                 THEN 'TAKI granted you a free subscription for ' || p_duration_days || ' days. Start posting your deals now! 💚'
                 ELSE 'You received a ' || p_discount_percent || '% discount on the subscription for ' || p_duration_days || ' days.' END,
            'system',
            jsonb_build_object('grant_type', p_grant_type, 'duration_days', p_duration_days,
                               'discount_percent', p_discount_percent, 'reason', p_reason));

        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.grant_subscription_bulk(TEXT[], TEXT, INTEGER, NUMERIC, TEXT) TO authenticated;

-- Admin-only: cancel a grant or downgrade a merchant back to trial/frozen.
CREATE OR REPLACE FUNCTION public.revoke_subscription(p_merchant_id TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_caller_role TEXT;
BEGIN
    SELECT user_type INTO v_caller_role FROM users WHERE id = auth.uid()::text;
    IF v_caller_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Only admins can revoke subscriptions';
    END IF;

    UPDATE merchant_subscriptions
    SET status = 'frozen',
        current_period_end = NOW(),
        grant_expires_at = NOW(),
        updated_at = NOW()
    WHERE merchant_id = p_merchant_id;

    INSERT INTO notifications (user_id, title_ar, title_en, body_ar, body_en, type)
    VALUES (p_merchant_id,
        '⚠️ تم تعليق اشتراكك', '⚠️ Your subscription was suspended',
        'تم تعليق اشتراكك من قِبل الإدارة. تواصل معنا لتفعيله مجدداً.',
        'Your subscription was suspended by admin. Contact us to reactivate.',
        'system');
END;
$$;

GRANT EXECUTE ON FUNCTION public.revoke_subscription(TEXT) TO authenticated;

-- Cron-callable: freeze trials whose trial_ends_at < now.
-- Called from Edge Function or pg_cron; idempotent.
CREATE OR REPLACE FUNCTION public.expire_trials()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    WITH expired AS (
        UPDATE merchant_subscriptions
        SET status = 'frozen', updated_at = NOW()
        WHERE status = 'trial' AND trial_ends_at < NOW()
        RETURNING merchant_id
    )
    INSERT INTO notifications (user_id, title_ar, title_en, body_ar, body_en, type)
    SELECT merchant_id,
        '⏰ انتهت فترتك التجريبية', '⏰ Your free trial ended',
        'انتهت الـ 14 يوماً المجانية. اشترك الآن لاستئناف نشر العروض الجديدة. عروضك الحالية تبقى مرئية للزبائن.',
        'Your 14-day free trial ended. Subscribe now to resume publishing new deals. Your existing deals remain visible.',
        'system'
    FROM expired
    RETURNING 1
    INTO v_count;
    RETURN COALESCE(v_count, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.expire_trials() TO authenticated;

-- Cron-callable: send a "trial ending soon" notification once per merchant.
CREATE OR REPLACE FUNCTION public.send_trial_warnings()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_warning_days INTEGER;
    v_count INTEGER := 0;
    r RECORD;
    v_views INTEGER;
    v_bookings INTEGER;
BEGIN
    v_warning_days := COALESCE((get_setting('trial_warning_days_before', '3'::jsonb))::int, 3);

    FOR r IN
        SELECT s.merchant_id, s.id AS sub_id, s.trial_ends_at
          FROM merchant_subscriptions s
         WHERE s.status = 'trial'
           AND s.trial_ends_at IS NOT NULL
           AND s.trial_ends_at > NOW()
           AND s.trial_ends_at <= NOW() + (v_warning_days || ' days')::interval
           AND s.last_warning_sent_at IS NULL
    LOOP
        -- Personalised stats for the warning notification.
        SELECT
            COALESCE((SELECT COUNT(*) FROM store_analytics_events
                       WHERE store_id = r.merchant_id
                         AND event_type IN ('deal_view','page_view')
                         AND created_at >= (SELECT trial_starts_at FROM merchant_subscriptions WHERE id = r.sub_id)
                     ),0),
            COALESCE((SELECT COUNT(*) FROM bookings
                       WHERE store_id = r.merchant_id
                         AND created_at >= (SELECT trial_starts_at FROM merchant_subscriptions WHERE id = r.sub_id)
                     ),0)
        INTO v_views, v_bookings;

        INSERT INTO notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data)
        VALUES (r.merchant_id,
            '🔥 لا تخسر زخم متجرك!', '🔥 Don''t lose your store''s momentum!',
            'حقّقت عروضك ' || v_views || ' مشاهدة و ' || v_bookings ||
              ' عملية حجز خلال الفترة المجانية. تنتهي تجربتك خلال أيام — اشترك الآن لتستمر بالنمو 🚀',
            'Your deals scored ' || v_views || ' views and ' || v_bookings ||
              ' bookings during the trial. It ends in a few days — subscribe now to keep growing 🚀',
            'marketing',
            jsonb_build_object('cta_url','/seller?tab=subscription','views',v_views,'bookings',v_bookings));

        UPDATE merchant_subscriptions SET last_warning_sent_at = NOW() WHERE id = r.sub_id;
        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.send_trial_warnings() TO authenticated;

-- Mark a payment as paid (called by webhook handler after gateway confirms).
CREATE OR REPLACE FUNCTION public.confirm_subscription_payment(
    p_payment_id TEXT,
    p_gateway_reference TEXT
)
RETURNS merchant_subscriptions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_payment subscription_payments;
    v_sub merchant_subscriptions;
    v_caller_role TEXT;
BEGIN
    SELECT user_type INTO v_caller_role FROM users WHERE id = auth.uid()::text;
    IF v_caller_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Only admins can confirm payments';
    END IF;

    SELECT * INTO v_payment FROM subscription_payments WHERE id = p_payment_id;
    IF v_payment IS NULL THEN
        RAISE EXCEPTION 'Payment not found';
    END IF;

    UPDATE subscription_payments
    SET status = 'paid', gateway_reference = p_gateway_reference, paid_at = NOW()
    WHERE id = p_payment_id;

    UPDATE merchant_subscriptions
    SET status = 'active',
        current_period_start = COALESCE(v_payment.period_start, NOW()),
        current_period_end = COALESCE(v_payment.period_end, NOW() + interval '30 days'),
        last_renewed_at = NOW(),
        updated_at = NOW()
    WHERE id = v_payment.subscription_id
    RETURNING * INTO v_sub;

    INSERT INTO notifications (user_id, title_ar, title_en, body_ar, body_en, type)
    VALUES (v_payment.merchant_id,
        '✅ تم تجديد اشتراكك', '✅ Subscription renewed',
        'استلمنا دفعتك بنجاح. اشتراكك ساري حتى ' ||
            to_char(COALESCE(v_payment.period_end, NOW() + interval '30 days'), 'YYYY-MM-DD'),
        'We received your payment. Your subscription is active until ' ||
            to_char(COALESCE(v_payment.period_end, NOW() + interval '30 days'), 'YYYY-MM-DD'),
        'system');

    RETURN v_sub;
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_subscription_payment(TEXT, TEXT) TO authenticated;

-- ====================== 6. ENFORCE SUBSCRIPTION ON DEAL INSERT ======================
-- Sellers without an active sub cannot publish new deals. Admins bypass.

CREATE OR REPLACE FUNCTION public.guard_deal_publish()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_caller TEXT;
    v_role TEXT;
    v_active BOOLEAN;
BEGIN
    v_caller := auth.uid()::text;
    SELECT user_type INTO v_role FROM users WHERE id = v_caller;

    -- Admins bypass for support purposes.
    IF v_role = 'admin' THEN
        RETURN NEW;
    END IF;

    -- Existing rows being updated to a *non-active* status are always allowed.
    -- (Pause / expire / delete must work even after trial expiry.)
    IF TG_OP = 'UPDATE' AND NEW.status IN ('expired','deleted','paused') THEN
        RETURN NEW;
    END IF;

    -- Only block INSERTs and re-activations from frozen sellers.
    IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.status <> 'active' AND NEW.status = 'active') THEN
        v_active := ensure_active_subscription(NEW.store_id);
        IF NOT v_active THEN
            RAISE EXCEPTION 'SUBSCRIPTION_REQUIRED: Merchant subscription is not active. Renew to publish new deals.'
                USING ERRCODE = 'P0001';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_guard_deal_publish ON public.deals;
CREATE TRIGGER tr_guard_deal_publish
    BEFORE INSERT OR UPDATE OF status ON public.deals
    FOR EACH ROW EXECUTE FUNCTION public.guard_deal_publish();

-- ====================== 7. AUTO-START TRIAL ON NEW SELLER ======================
CREATE OR REPLACE FUNCTION public.auto_start_seller_trial()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF NEW.user_type = 'seller' THEN
        BEGIN
            PERFORM start_trial_for_merchant(NEW.id);
        EXCEPTION WHEN OTHERS THEN
            -- Don't block user creation if trial start fails.
            NULL;
        END;
    END IF;

    -- Also handle role-change buyer→seller: start trial then.
    IF TG_OP = 'UPDATE' AND OLD.user_type IS DISTINCT FROM NEW.user_type
       AND NEW.user_type = 'seller' THEN
        BEGIN
            PERFORM start_trial_for_merchant(NEW.id);
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_auto_start_trial ON public.users;
CREATE TRIGGER tr_auto_start_trial
    AFTER INSERT OR UPDATE OF user_type ON public.users
    FOR EACH ROW EXECUTE FUNCTION public.auto_start_seller_trial();

-- ====================== 8. BACKFILL EXISTING SELLERS ======================
-- Give every existing seller a trial that's already started counting.
INSERT INTO merchant_subscriptions (merchant_id, plan_id, status, trial_starts_at, trial_ends_at, branches_count)
SELECT u.id,
       (SELECT id FROM subscription_plans WHERE code='basic' LIMIT 1),
       'trial',
       u.created_at,
       u.created_at + (COALESCE((get_setting('trial_days','14'::jsonb))::int, 14) || ' days')::interval,
       1
FROM users u
WHERE u.user_type = 'seller'
  AND NOT EXISTS (SELECT 1 FROM merchant_subscriptions s WHERE s.merchant_id = u.id);

-- ====================== 9. REALTIME ======================
ALTER TABLE merchant_subscriptions REPLICA IDENTITY FULL;
ALTER TABLE subscription_payments REPLICA IDENTITY FULL;
ALTER TABLE platform_settings REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE merchant_subscriptions;
ALTER PUBLICATION supabase_realtime ADD TABLE subscription_payments;
ALTER PUBLICATION supabase_realtime ADD TABLE platform_settings;
