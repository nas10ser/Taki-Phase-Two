-- ================================================================
-- TAKI Migration v9.7 — Admin Pro Dashboard (2026-grade)
-- ================================================================
-- هذا الترقية تضيف لمنصة TAKI:
--   1) جداول التتبع اللحظي (sessions + activity log)
--   2) أعمدة اشتراك متقدمة (مبلغ شهري، تاريخ البداية، ملاحظات أدمن)
--   3) RPC للإحصائيات اللحظية (active users, bookings/hour, etc.)
--   4) RPC لمنح اشتراك متقدم بضغطة زر (تاريخ + نسبة + مبلغ)
--   5) RPC لإدارة المستخدمين (suspend/restore/edit)
--   6) سياسات RLS صارمة - الأدمن فقط يقرأ التتبع
--
-- الترقية idempotent (آمن إعادة تشغيلها).
-- ================================================================

-- ============================================================
-- 1) أعمدة اشتراك متقدمة على store_profiles
-- ============================================================
ALTER TABLE store_profiles
    ADD COLUMN IF NOT EXISTS subscription_amount NUMERIC DEFAULT 199,
    ADD COLUMN IF NOT EXISTS subscription_started_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS admin_notes TEXT,
    ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS custom_features JSONB DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_store_profiles_plan
    ON store_profiles(subscription_plan, subscription_expires_at);

-- ============================================================
-- 2) أعمدة على users لتتبع الحالة
-- ============================================================
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS admin_notes TEXT,
    ADD COLUMN IF NOT EXISTS total_bookings INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_spent NUMERIC DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_users_active ON users(last_active_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_type ON users(user_type, created_at DESC);

-- ============================================================
-- 3) جدول الجلسات النشطة (heartbeat-based)
-- ============================================================
CREATE TABLE IF NOT EXISTS user_sessions (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    user_type TEXT,
    last_seen_at TIMESTAMPTZ DEFAULT NOW(),
    current_page TEXT,
    user_agent TEXT,
    device_type TEXT, -- 'mobile' | 'tablet' | 'desktop'
    started_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_seen
    ON user_sessions(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_type
    ON user_sessions(user_type, last_seen_at DESC);

-- ============================================================
-- 4) سجل النشاطات (activity log)
-- ============================================================
CREATE TABLE IF NOT EXISTS activity_log (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    user_type TEXT,
    action TEXT NOT NULL,
    -- 'login', 'register', 'view_deal', 'book', 'cancel_booking',
    -- 'add_deal', 'edit_deal', 'delete_deal', 'follow', 'rate'
    entity_type TEXT,
    entity_id TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_created
    ON activity_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_user
    ON activity_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_action
    ON activity_log(action, created_at DESC);

-- تنظيف تلقائي للسجلات الأقدم من 90 يوماً (موفر للمساحة)
CREATE OR REPLACE FUNCTION cleanup_old_activity()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM activity_log WHERE created_at < NOW() - INTERVAL '90 days';
    DELETE FROM user_sessions WHERE last_seen_at < NOW() - INTERVAL '7 days';
END $$;

-- ============================================================
-- 5) RLS — الأدمن فقط يقرأ التتبع
-- ============================================================
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sessions_select_admin" ON user_sessions;
CREATE POLICY "sessions_select_admin" ON user_sessions FOR SELECT USING (
    EXISTS (SELECT 1 FROM users
            WHERE id = auth.uid()::text AND user_type = 'admin')
);

DROP POLICY IF EXISTS "sessions_upsert_self" ON user_sessions;
CREATE POLICY "sessions_upsert_self" ON user_sessions FOR INSERT WITH CHECK (
    auth.uid()::text = user_id
);
DROP POLICY IF EXISTS "sessions_update_self" ON user_sessions;
CREATE POLICY "sessions_update_self" ON user_sessions FOR UPDATE USING (
    auth.uid()::text = user_id
) WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "activity_select_admin" ON activity_log;
CREATE POLICY "activity_select_admin" ON activity_log FOR SELECT USING (
    EXISTS (SELECT 1 FROM users
            WHERE id = auth.uid()::text AND user_type = 'admin')
);

DROP POLICY IF EXISTS "activity_insert_self" ON activity_log;
CREATE POLICY "activity_insert_self" ON activity_log FOR INSERT WITH CHECK (
    auth.uid()::text = user_id OR user_id IS NULL
);

-- ============================================================
-- 6) سياسات RLS للأدمن على جداول الإدارة
-- ============================================================
DROP POLICY IF EXISTS "store_profiles_update_admin" ON store_profiles;
CREATE POLICY "store_profiles_update_admin" ON store_profiles FOR UPDATE USING (
    EXISTS (SELECT 1 FROM users
            WHERE id = auth.uid()::text AND user_type = 'admin')
) WITH CHECK (
    EXISTS (SELECT 1 FROM users
            WHERE id = auth.uid()::text AND user_type = 'admin')
);

DROP POLICY IF EXISTS "store_profiles_insert_admin" ON store_profiles;
CREATE POLICY "store_profiles_insert_admin" ON store_profiles FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM users
            WHERE id = auth.uid()::text AND user_type = 'admin')
    OR auth.uid()::text = store_id
);

DROP POLICY IF EXISTS "users_update_admin" ON users;
CREATE POLICY "users_update_admin" ON users FOR UPDATE USING (
    EXISTS (SELECT 1 FROM users u
            WHERE u.id = auth.uid()::text AND u.user_type = 'admin')
    OR auth.uid()::text = id
) WITH CHECK (
    EXISTS (SELECT 1 FROM users u
            WHERE u.id = auth.uid()::text AND u.user_type = 'admin')
    OR auth.uid()::text = id
);

-- ============================================================
-- 7) ENABLE REALTIME على الجداول الجديدة
-- ============================================================
DO $$ BEGIN
    PERFORM 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'user_sessions';
    IF NOT FOUND THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE user_sessions;
    END IF;
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

DO $$ BEGIN
    PERFORM 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'activity_log';
    IF NOT FOUND THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE activity_log;
    END IF;
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

ALTER TABLE user_sessions REPLICA IDENTITY FULL;
ALTER TABLE activity_log REPLICA IDENTITY FULL;

-- ============================================================
-- 8) RPC: get_live_stats — الإحصائيات اللحظية
-- ============================================================
CREATE OR REPLACE FUNCTION get_live_stats(p_minutes INT DEFAULT 5)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_caller_role TEXT;
    v_threshold TIMESTAMPTZ;
    result JSONB;
BEGIN
    SELECT user_type INTO v_caller_role FROM users WHERE id = auth.uid()::text;
    IF v_caller_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Admin only';
    END IF;

    v_threshold := NOW() - (p_minutes || ' minutes')::INTERVAL;

    SELECT jsonb_build_object(
        'active_users',   (SELECT COUNT(DISTINCT user_id)::INT FROM user_sessions WHERE last_seen_at > v_threshold),
        'active_buyers',  (SELECT COUNT(DISTINCT user_id)::INT FROM user_sessions WHERE user_type = 'buyer'  AND last_seen_at > v_threshold),
        'active_sellers', (SELECT COUNT(DISTINCT user_id)::INT FROM user_sessions WHERE user_type = 'seller' AND last_seen_at > v_threshold),
        'bookings_today', (SELECT COUNT(*)::INT FROM bookings WHERE created_at >= NOW()::DATE),
        'bookings_hour',  (SELECT COUNT(*)::INT FROM bookings WHERE created_at > NOW() - INTERVAL '1 hour'),
        'bookings_5min',  (SELECT COUNT(*)::INT FROM bookings WHERE created_at > NOW() - INTERVAL '5 minutes'),
        'new_users_today',(SELECT COUNT(*)::INT FROM users    WHERE created_at >= NOW()::DATE),
        'total_users',    (SELECT COUNT(*)::INT FROM users),
        'total_buyers',   (SELECT COUNT(*)::INT FROM users WHERE user_type = 'buyer'),
        'total_sellers',  (SELECT COUNT(*)::INT FROM users WHERE user_type = 'seller'),
        'active_deals',   (SELECT COUNT(*)::INT FROM deals  WHERE status IS NULL OR status NOT IN ('deleted','expired')),
        'paying_sellers', (SELECT COUNT(*)::INT FROM store_profiles WHERE subscription_plan = 'premium' AND (subscription_expires_at IS NULL OR subscription_expires_at > NOW())),
        'mrr',            (SELECT COALESCE(SUM(subscription_amount), 0)::NUMERIC FROM store_profiles WHERE subscription_plan = 'premium' AND (subscription_expires_at IS NULL OR subscription_expires_at > NOW())),
        'as_of',          NOW()
    ) INTO result;

    RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION get_live_stats(INT) TO authenticated;

-- ============================================================
-- 9) RPC: get_bookings_timeline — للرسم البياني
-- ============================================================
CREATE OR REPLACE FUNCTION get_bookings_timeline(
    p_from TIMESTAMPTZ DEFAULT NOW() - INTERVAL '24 hours',
    p_to   TIMESTAMPTZ DEFAULT NOW(),
    p_bucket TEXT DEFAULT 'hour' -- 'minute' | 'hour' | 'day'
)
RETURNS TABLE(bucket TIMESTAMPTZ, count INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_caller_role TEXT;
    v_interval TEXT;
BEGIN
    SELECT user_type INTO v_caller_role FROM users WHERE id = auth.uid()::text;
    IF v_caller_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Admin only';
    END IF;

    v_interval := CASE p_bucket
        WHEN 'minute' THEN 'minute'
        WHEN 'day'    THEN 'day'
        ELSE 'hour'
    END;

    RETURN QUERY EXECUTE format($f$
        SELECT date_trunc(%L, created_at) AS bucket, COUNT(*)::INT
        FROM bookings
        WHERE created_at BETWEEN $1 AND $2
        GROUP BY 1 ORDER BY 1
    $f$, v_interval) USING p_from, p_to;
END $$;

GRANT EXECUTE ON FUNCTION get_bookings_timeline(TIMESTAMPTZ, TIMESTAMPTZ, TEXT) TO authenticated;

-- ============================================================
-- 10) RPC: get_recent_activity — للتغذية اللحظية
-- ============================================================
CREATE OR REPLACE FUNCTION get_recent_activity(p_limit INT DEFAULT 50)
RETURNS TABLE(
    id BIGINT, user_id TEXT, user_name TEXT, user_type TEXT,
    action TEXT, entity_type TEXT, entity_id TEXT,
    metadata JSONB, created_at TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_caller_role TEXT;
BEGIN
    SELECT user_type INTO v_caller_role FROM users WHERE id = auth.uid()::text;
    IF v_caller_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Admin only';
    END IF;

    RETURN QUERY
    SELECT a.id, a.user_id, u.name, a.user_type, a.action,
           a.entity_type, a.entity_id, a.metadata, a.created_at
    FROM activity_log a
    LEFT JOIN users u ON u.id = a.user_id
    ORDER BY a.created_at DESC
    LIMIT p_limit;
END $$;

GRANT EXECUTE ON FUNCTION get_recent_activity(INT) TO authenticated;

-- ============================================================
-- 11) RPC: admin_apply_subscription — منح اشتراك بضغطة زر
-- ============================================================
-- يأخذ: store_id, plan, started_at, expires_at, discount, amount, notes
-- يطبّق كل شيء في عملية واحدة + يسجل النشاط
CREATE OR REPLACE FUNCTION admin_apply_subscription(
    p_store_id TEXT,
    p_plan TEXT, -- 'free' | 'trial' | 'premium'
    p_started_at TIMESTAMPTZ DEFAULT NOW(),
    p_expires_at TIMESTAMPTZ DEFAULT NULL,
    p_discount NUMERIC DEFAULT 0,
    p_amount NUMERIC DEFAULT 199,
    p_notes TEXT DEFAULT NULL,
    p_send_notification BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_caller_role TEXT;
    v_caller_id TEXT;
    v_user_name TEXT;
BEGIN
    v_caller_id := auth.uid()::text;
    SELECT user_type INTO v_caller_role FROM users WHERE id = v_caller_id;
    IF v_caller_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Admin only';
    END IF;

    IF p_plan NOT IN ('free','trial','premium') THEN
        RAISE EXCEPTION 'Invalid plan: %', p_plan;
    END IF;

    SELECT name INTO v_user_name FROM users WHERE id = p_store_id;
    IF v_user_name IS NULL THEN
        RAISE EXCEPTION 'Store not found: %', p_store_id;
    END IF;

    -- تطبيق الاشتراك
    INSERT INTO store_profiles (
        store_id, subscription_plan, subscription_started_at,
        subscription_expires_at, discount_percentage, subscription_amount,
        admin_notes, updated_at
    ) VALUES (
        p_store_id, p_plan, p_started_at, p_expires_at,
        COALESCE(p_discount, 0), COALESCE(p_amount, 199),
        p_notes, NOW()
    )
    ON CONFLICT (store_id) DO UPDATE SET
        subscription_plan = EXCLUDED.subscription_plan,
        subscription_started_at = EXCLUDED.subscription_started_at,
        subscription_expires_at = EXCLUDED.subscription_expires_at,
        discount_percentage = EXCLUDED.discount_percentage,
        subscription_amount = EXCLUDED.subscription_amount,
        admin_notes = EXCLUDED.admin_notes,
        updated_at = NOW();

    -- إشعار للتاجر
    IF p_send_notification THEN
        INSERT INTO notifications (user_id, title_ar, title_en, body_ar, body_en, type)
        VALUES (
            p_store_id,
            CASE p_plan
                WHEN 'premium' THEN '🌟 تم تفعيل اشتراكك المميز'
                WHEN 'trial'   THEN '🎁 لديك فترة تجريبية جديدة'
                ELSE '✅ تم تحديث اشتراكك'
            END,
            CASE p_plan
                WHEN 'premium' THEN '🌟 Premium subscription activated'
                WHEN 'trial'   THEN '🎁 New trial period granted'
                ELSE '✅ Subscription updated'
            END,
            CASE
                WHEN p_discount > 0 THEN 'تم تطبيق خصم ' || p_discount || '٪ على اشتراكك. صالح حتى ' || COALESCE(to_char(p_expires_at, 'YYYY-MM-DD'), 'بدون انتهاء') || '.'
                ELSE 'اشتراكك ' || p_plan || ' فعّال حتى ' || COALESCE(to_char(p_expires_at, 'YYYY-MM-DD'), 'إشعار آخر') || '.'
            END,
            'Your ' || p_plan || ' subscription is active until ' || COALESCE(to_char(p_expires_at, 'YYYY-MM-DD'), 'further notice') || '.',
            'system'
        );
    END IF;

    -- تسجيل النشاط
    INSERT INTO activity_log (user_id, user_type, action, entity_type, entity_id, metadata)
    VALUES (
        v_caller_id, 'admin', 'admin_apply_subscription', 'store', p_store_id,
        jsonb_build_object(
            'plan', p_plan,
            'discount', p_discount,
            'amount', p_amount,
            'expires_at', p_expires_at
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'store_id', p_store_id,
        'store_name', v_user_name,
        'plan', p_plan
    );
END $$;

GRANT EXECUTE ON FUNCTION admin_apply_subscription(TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, NUMERIC, NUMERIC, TEXT, BOOLEAN) TO authenticated;

-- ============================================================
-- 12) RPC: admin_update_user — تعديل مستخدم بأي حقل
-- ============================================================
CREATE OR REPLACE FUNCTION admin_update_user(
    p_user_id TEXT,
    p_updates JSONB
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_caller_role TEXT;
    v_caller_id TEXT;
BEGIN
    v_caller_id := auth.uid()::text;
    SELECT user_type INTO v_caller_role FROM users WHERE id = v_caller_id;
    IF v_caller_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Admin only';
    END IF;

    UPDATE users SET
        name        = COALESCE(p_updates->>'name', name),
        phone       = COALESCE(p_updates->>'phone', phone),
        email       = COALESCE(p_updates->>'email', email),
        shop        = COALESCE(p_updates->>'shop', shop),
        address     = COALESCE(p_updates->>'address', address),
        bio         = COALESCE(p_updates->>'bio', bio),
        avatar_url  = COALESCE(p_updates->>'avatar_url', avatar_url),
        is_suspended = COALESCE((p_updates->>'is_suspended')::BOOLEAN, is_suspended),
        admin_notes = COALESCE(p_updates->>'admin_notes', admin_notes),
        user_type   = COALESCE(p_updates->>'user_type', user_type),
        updated_at  = NOW()
    WHERE id = p_user_id;

    INSERT INTO activity_log (user_id, user_type, action, entity_type, entity_id, metadata)
    VALUES (v_caller_id, 'admin', 'admin_update_user', 'user', p_user_id, p_updates);

    RETURN jsonb_build_object('success', true, 'user_id', p_user_id);
END $$;

GRANT EXECUTE ON FUNCTION admin_update_user(TEXT, JSONB) TO authenticated;

-- ============================================================
-- 13) RPC: admin_delete_user — حذف ناعم (تعطيل + إخفاء)
-- ============================================================
CREATE OR REPLACE FUNCTION admin_soft_delete_user(p_user_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_caller_role TEXT;
    v_caller_id TEXT;
BEGIN
    v_caller_id := auth.uid()::text;
    SELECT user_type INTO v_caller_role FROM users WHERE id = v_caller_id;
    IF v_caller_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Admin only';
    END IF;

    UPDATE users SET is_suspended = TRUE, updated_at = NOW() WHERE id = p_user_id;
    UPDATE deals SET status = 'deleted' WHERE store_id = p_user_id;

    INSERT INTO activity_log (user_id, user_type, action, entity_type, entity_id)
    VALUES (v_caller_id, 'admin', 'admin_soft_delete_user', 'user', p_user_id);

    RETURN jsonb_build_object('success', true);
END $$;

GRANT EXECUTE ON FUNCTION admin_soft_delete_user(TEXT) TO authenticated;

-- ============================================================
-- 14) RPC: admin_search_users — بحث متقدم مع pagination
-- ============================================================
CREATE OR REPLACE FUNCTION admin_search_users(
    p_query TEXT DEFAULT '',
    p_user_type TEXT DEFAULT NULL,
    p_limit INT DEFAULT 50,
    p_offset INT DEFAULT 0
)
RETURNS TABLE(
    id TEXT, name TEXT, phone TEXT, email TEXT,
    user_type TEXT, shop TEXT, address TEXT,
    is_suspended BOOLEAN, total_bookings INT,
    total_spent NUMERIC, last_active_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ,
    subscription_plan TEXT, subscription_expires_at TIMESTAMPTZ,
    subscription_amount NUMERIC, discount_percentage NUMERIC
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_caller_role TEXT;
    v_q TEXT;
BEGIN
    SELECT user_type INTO v_caller_role FROM users WHERE id = auth.uid()::text;
    IF v_caller_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Admin only';
    END IF;

    v_q := '%' || COALESCE(p_query, '') || '%';

    RETURN QUERY
    SELECT u.id, u.name, u.phone, u.email, u.user_type, u.shop, u.address,
           COALESCE(u.is_suspended, FALSE),
           COALESCE(u.total_bookings, 0),
           COALESCE(u.total_spent, 0),
           u.last_active_at, u.created_at,
           sp.subscription_plan, sp.subscription_expires_at,
           sp.subscription_amount, sp.discount_percentage
    FROM users u
    LEFT JOIN store_profiles sp ON sp.store_id = u.id
    WHERE (p_user_type IS NULL OR u.user_type = p_user_type)
      AND (
        p_query = '' OR
        u.name  ILIKE v_q OR
        u.phone ILIKE v_q OR
        u.email ILIKE v_q OR
        u.shop  ILIKE v_q OR
        u.address ILIKE v_q
      )
    ORDER BY u.created_at DESC
    LIMIT p_limit OFFSET p_offset;
END $$;

GRANT EXECUTE ON FUNCTION admin_search_users(TEXT, TEXT, INT, INT) TO authenticated;

-- ============================================================
-- 15) RPC: heartbeat — heartbeat للجلسة
-- ============================================================
-- يستدعى كل 30 ثانية من الـ frontend
CREATE OR REPLACE FUNCTION session_heartbeat(
    p_page TEXT DEFAULT NULL,
    p_user_agent TEXT DEFAULT NULL,
    p_device_type TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_user_id TEXT;
    v_user_type TEXT;
BEGIN
    v_user_id := auth.uid()::text;
    IF v_user_id IS NULL THEN RETURN; END IF;

    SELECT user_type INTO v_user_type FROM users WHERE id = v_user_id;

    INSERT INTO user_sessions (user_id, user_type, current_page, user_agent, device_type, last_seen_at)
    VALUES (v_user_id, v_user_type, p_page, p_user_agent, p_device_type, NOW())
    ON CONFLICT (user_id) DO UPDATE SET
        last_seen_at = NOW(),
        current_page = COALESCE(EXCLUDED.current_page, user_sessions.current_page),
        device_type  = COALESCE(EXCLUDED.device_type, user_sessions.device_type);

    UPDATE users SET last_active_at = NOW() WHERE id = v_user_id;
END $$;

GRANT EXECUTE ON FUNCTION session_heartbeat(TEXT, TEXT, TEXT) TO authenticated;

-- ============================================================
-- 16) RPC: log_activity — تسجيل نشاط من الـ frontend
-- ============================================================
CREATE OR REPLACE FUNCTION log_activity(
    p_action TEXT,
    p_entity_type TEXT DEFAULT NULL,
    p_entity_id TEXT DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_user_id TEXT;
    v_user_type TEXT;
BEGIN
    v_user_id := auth.uid()::text;
    SELECT user_type INTO v_user_type FROM users WHERE id = v_user_id;

    INSERT INTO activity_log (user_id, user_type, action, entity_type, entity_id, metadata)
    VALUES (v_user_id, v_user_type, p_action, p_entity_type, p_entity_id, p_metadata);
END $$;

GRANT EXECUTE ON FUNCTION log_activity(TEXT, TEXT, TEXT, JSONB) TO authenticated;

-- ============================================================
-- 17) VIEW: top_sellers / top_buyers
-- ============================================================
CREATE OR REPLACE VIEW v_top_sellers AS
SELECT
    u.id, u.name, u.shop,
    COUNT(DISTINCT d.id) FILTER (WHERE d.status IS NULL OR d.status NOT IN ('deleted')) AS deals_count,
    COUNT(DISTINCT b.barcode) AS bookings_count,
    sp.subscription_plan,
    sp.subscription_amount,
    sp.subscription_expires_at,
    u.last_active_at
FROM users u
LEFT JOIN deals    d ON d.store_id = u.id
LEFT JOIN bookings b ON b.store_id = u.id
LEFT JOIN store_profiles sp ON sp.store_id = u.id
WHERE u.user_type = 'seller'
GROUP BY u.id, u.name, u.shop, sp.subscription_plan, sp.subscription_amount, sp.subscription_expires_at, u.last_active_at
ORDER BY bookings_count DESC;

CREATE OR REPLACE VIEW v_top_buyers AS
SELECT
    u.id, u.name, u.phone,
    COUNT(b.barcode)::INT AS bookings_count,
    SUM(d.discounted_price * b.booked_quantity)::NUMERIC AS total_spent,
    u.last_active_at, u.created_at
FROM users u
LEFT JOIN bookings b ON b.user_id = u.id
LEFT JOIN deals d    ON d.id = b.deal_id
WHERE u.user_type = 'buyer'
GROUP BY u.id, u.name, u.phone, u.last_active_at, u.created_at
ORDER BY bookings_count DESC;

-- ============================================================
-- ✅ تم
-- ============================================================
DO $$ BEGIN
    RAISE NOTICE '✅ TAKI v9.7 Admin Pro migration applied successfully';
END $$;
