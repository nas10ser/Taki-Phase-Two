-- ========================================================
-- Migration v15 — Admin Command Center
-- ========================================================
-- Adds:
--   • activity_log table (full audit + live feed)
--   • presence (last_seen_at) and soft-suspend on users
--   • Banner enhancements (discount, amount, schedule, tracking)
--   • Admin RPCs: overview stats, time-series, city breakdown,
--     top stores, suspend/unsuspend, deal moderation
--   • Seller analytics RPC (rich, separate from admin)
--   • Banner view/click counters
--   • Admin RLS for full access to deals / bookings / banners
-- All RPCs are SECURITY DEFINER but check auth.uid() role first.
-- ========================================================

-- ====================== 1. ACTIVITY LOG ======================
CREATE TABLE IF NOT EXISTS activity_log (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    actor_type TEXT,
    event_type TEXT NOT NULL,
    target_table TEXT,
    target_id TEXT,
    severity TEXT DEFAULT 'info' CHECK (severity IN ('info','warning','critical','success')),
    metadata JSONB DEFAULT '{}',
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_log_user ON activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_event ON activity_log(event_type);
CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_severity ON activity_log(severity, created_at DESC);

ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log REPLICA IDENTITY FULL;

DROP POLICY IF EXISTS "activity_log_select_admin" ON activity_log;
CREATE POLICY "activity_log_select_admin" ON activity_log FOR SELECT USING (
    auth.uid()::text IN (SELECT id FROM users WHERE user_type = 'admin')
);

DROP POLICY IF EXISTS "activity_log_insert_self" ON activity_log;
CREATE POLICY "activity_log_insert_self" ON activity_log FOR INSERT WITH CHECK (
    user_id IS NULL OR auth.uid()::text = user_id
);

-- Add to realtime (idempotent)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'activity_log'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE activity_log;
    END IF;
END $$;

-- Logging helper RPC (anyone can log their own action)
CREATE OR REPLACE FUNCTION public.log_activity(
    p_event_type TEXT,
    p_target_table TEXT DEFAULT NULL,
    p_target_id TEXT DEFAULT NULL,
    p_severity TEXT DEFAULT 'info',
    p_metadata JSONB DEFAULT '{}'
) RETURNS void AS $$
DECLARE
    v_user_type TEXT;
BEGIN
    SELECT user_type INTO v_user_type FROM users WHERE id = auth.uid()::text;
    INSERT INTO activity_log (user_id, actor_type, event_type, target_table, target_id, severity, metadata)
    VALUES (auth.uid()::text, COALESCE(v_user_type, 'guest'), p_event_type, p_target_table, p_target_id, p_severity, p_metadata);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ====================== 2. PRESENCE & SUSPENSION ======================
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspension_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users(last_seen_at DESC) WHERE last_seen_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active);

CREATE OR REPLACE FUNCTION public.heartbeat()
RETURNS void AS $$
BEGIN
    UPDATE users SET last_seen_at = NOW() WHERE id = auth.uid()::text;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ====================== 3. BANNER ENHANCEMENTS ======================
ALTER TABLE banners
    ADD COLUMN IF NOT EXISTS subtitle_ar TEXT,
    ADD COLUMN IF NOT EXISTS subtitle_en TEXT,
    ADD COLUMN IF NOT EXISTS discount_percentage INTEGER,
    ADD COLUMN IF NOT EXISTS amount NUMERIC,
    ADD COLUMN IF NOT EXISTS target_city TEXT,
    ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS view_count INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS click_count INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS background_color TEXT,
    ADD COLUMN IF NOT EXISTS cta_label_ar TEXT,
    ADD COLUMN IF NOT EXISTS cta_label_en TEXT,
    ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 0;

CREATE OR REPLACE FUNCTION public.increment_banner_view(banner_id UUID)
RETURNS void AS $$
BEGIN
    UPDATE banners SET view_count = view_count + 1 WHERE id = banner_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.increment_banner_click(banner_id UUID)
RETURNS void AS $$
BEGIN
    UPDATE banners SET click_count = click_count + 1 WHERE id = banner_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ====================== 4. ADMIN ANALYTICS RPCS ======================
CREATE OR REPLACE FUNCTION public.admin_overview_stats()
RETURNS JSONB AS $$
DECLARE
    result JSONB;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM users WHERE id = auth.uid()::text AND user_type = 'admin') THEN
        RAISE EXCEPTION 'Forbidden: admin only';
    END IF;

    SELECT jsonb_build_object(
        'totals', jsonb_build_object(
            'users', (SELECT COUNT(*) FROM users),
            'buyers', (SELECT COUNT(*) FROM users WHERE user_type='buyer'),
            'sellers', (SELECT COUNT(*) FROM users WHERE user_type='seller'),
            'active_now', (SELECT COUNT(*) FROM users WHERE last_seen_at > NOW() - INTERVAL '5 minutes'),
            'active_today', (SELECT COUNT(*) FROM users WHERE last_seen_at > NOW() - INTERVAL '24 hours'),
            'active_week', (SELECT COUNT(*) FROM users WHERE last_seen_at > NOW() - INTERVAL '7 days'),
            'suspended', (SELECT COUNT(*) FROM users WHERE is_active = FALSE),
            'deals_active', (SELECT COUNT(*) FROM deals WHERE status='active'),
            'deals_paused', (SELECT COUNT(*) FROM deals WHERE status='paused'),
            'deals_total', (SELECT COUNT(*) FROM deals WHERE status != 'deleted'),
            'bookings_total', (SELECT COUNT(*) FROM bookings),
            'bookings_today', (SELECT COUNT(*) FROM bookings WHERE created_at > NOW() - INTERVAL '24 hours'),
            'bookings_pending', (SELECT COUNT(*) FROM bookings WHERE status='pending'),
            'bookings_completed', (SELECT COUNT(*) FROM bookings WHERE status='completed'),
            'banners_active', (SELECT COUNT(*) FROM banners WHERE is_active=true),
            'banners_total', (SELECT COUNT(*) FROM banners),
            'subs_active', (SELECT COUNT(*) FROM store_profiles WHERE subscription_expires_at > NOW()),
            'subs_expired', (SELECT COUNT(*) FROM store_profiles WHERE subscription_expires_at <= NOW()),
            'subs_premium', (SELECT COUNT(*) FROM store_profiles WHERE subscription_plan = 'premium' AND subscription_expires_at > NOW()),
            'total_views', (SELECT COALESCE(SUM(views), 0) FROM deals),
            'total_clicks', (SELECT COALESCE(SUM(clicks), 0) FROM deals),
            'avg_rating', (SELECT COALESCE(AVG(score)::NUMERIC(3,1), 0) FROM ratings),
            'ratings_count', (SELECT COUNT(*) FROM ratings)
        ),
        'today', jsonb_build_object(
            'new_users', (SELECT COUNT(*) FROM users WHERE created_at > NOW() - INTERVAL '24 hours'),
            'new_sellers', (SELECT COUNT(*) FROM users WHERE user_type='seller' AND created_at > NOW() - INTERVAL '24 hours'),
            'new_buyers', (SELECT COUNT(*) FROM users WHERE user_type='buyer' AND created_at > NOW() - INTERVAL '24 hours'),
            'new_deals', (SELECT COUNT(*) FROM deals WHERE created_at > extract(epoch from NOW() - INTERVAL '24 hours')*1000),
            'new_bookings', (SELECT COUNT(*) FROM bookings WHERE created_at > NOW() - INTERVAL '24 hours')
        ),
        'yesterday', jsonb_build_object(
            'new_users', (SELECT COUNT(*) FROM users WHERE created_at > NOW() - INTERVAL '48 hours' AND created_at <= NOW() - INTERVAL '24 hours'),
            'new_bookings', (SELECT COUNT(*) FROM bookings WHERE created_at > NOW() - INTERVAL '48 hours' AND created_at <= NOW() - INTERVAL '24 hours')
        )
    ) INTO result;

    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Time-series for charts (last N days)
CREATE OR REPLACE FUNCTION public.admin_timeseries(days_back INTEGER DEFAULT 30)
RETURNS JSONB AS $$
DECLARE
    result JSONB;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM users WHERE id = auth.uid()::text AND user_type = 'admin') THEN
        RAISE EXCEPTION 'Forbidden: admin only';
    END IF;

    SELECT COALESCE(jsonb_agg(row_to_json(r) ORDER BY day), '[]'::jsonb) INTO result FROM (
        SELECT
            d::date AS day,
            (SELECT COUNT(*) FROM users WHERE created_at::date = d::date) AS new_users,
            (SELECT COUNT(*) FROM users WHERE created_at::date = d::date AND user_type='seller') AS new_sellers,
            (SELECT COUNT(*) FROM deals WHERE to_timestamp(created_at/1000)::date = d::date) AS new_deals,
            (SELECT COUNT(*) FROM bookings WHERE created_at::date = d::date) AS new_bookings,
            (SELECT COUNT(*) FROM users WHERE last_seen_at::date = d::date) AS active_users
        FROM generate_series(
            (NOW() - (days_back || ' days')::INTERVAL)::date,
            NOW()::date,
            '1 day'::INTERVAL
        ) d
    ) r;

    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- City / region breakdown
CREATE OR REPLACE FUNCTION public.admin_city_breakdown()
RETURNS JSONB AS $$
DECLARE
    result JSONB;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM users WHERE id = auth.uid()::text AND user_type = 'admin') THEN
        RAISE EXCEPTION 'Forbidden: admin only';
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'city', city,
        'users', cnt,
        'sellers', sellers,
        'buyers', buyers
    ) ORDER BY cnt DESC), '[]'::jsonb) INTO result FROM (
        SELECT
            COALESCE(NULLIF(TRIM(address), ''), 'غير محدد') AS city,
            COUNT(*) AS cnt,
            COUNT(*) FILTER (WHERE user_type = 'seller') AS sellers,
            COUNT(*) FILTER (WHERE user_type = 'buyer') AS buyers
        FROM users
        GROUP BY city
        ORDER BY cnt DESC
        LIMIT 30
    ) c;

    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Top performing stores
CREATE OR REPLACE FUNCTION public.admin_top_stores(limit_count INTEGER DEFAULT 10)
RETURNS TABLE (
    store_id TEXT,
    shop TEXT,
    address TEXT,
    deal_count BIGINT,
    total_views BIGINT,
    total_clicks BIGINT,
    total_bookings BIGINT,
    avg_rating NUMERIC,
    subscription_plan TEXT
) AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM users WHERE id = auth.uid()::text AND user_type = 'admin') THEN
        RAISE EXCEPTION 'Forbidden: admin only';
    END IF;

    RETURN QUERY
    SELECT
        u.id,
        COALESCE(u.shop, u.name),
        COALESCE(u.address, ''),
        COUNT(d.id)::BIGINT FILTER (WHERE d.status != 'deleted'),
        COALESCE(SUM(d.views), 0)::BIGINT,
        COALESCE(SUM(d.clicks), 0)::BIGINT,
        (SELECT COUNT(*) FROM bookings WHERE store_id = u.id),
        COALESCE((SELECT AVG(score)::NUMERIC(3,1) FROM ratings r WHERE r.deal_id IN (SELECT id FROM deals WHERE store_id = u.id)), 0),
        COALESCE(sp.subscription_plan, 'free')
    FROM users u
    LEFT JOIN deals d ON d.store_id = u.id
    LEFT JOIN store_profiles sp ON sp.store_id = u.id
    WHERE u.user_type = 'seller'
    GROUP BY u.id, u.shop, u.name, u.address, sp.subscription_plan
    ORDER BY COALESCE(SUM(d.views), 0) DESC
    LIMIT limit_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ====================== 5. SELLER ANALYTICS RPC ======================
CREATE OR REPLACE FUNCTION public.seller_analytics(seller_id TEXT)
RETURNS JSONB AS $$
DECLARE
    result JSONB;
    requester TEXT := auth.uid()::text;
    is_admin BOOLEAN;
BEGIN
    SELECT EXISTS (SELECT 1 FROM users WHERE id = requester AND user_type = 'admin') INTO is_admin;
    IF requester != seller_id AND NOT is_admin THEN
        RAISE EXCEPTION 'Forbidden';
    END IF;

    SELECT jsonb_build_object(
        'totals', jsonb_build_object(
            'deals_total', (SELECT COUNT(*) FROM deals WHERE store_id = seller_id AND status != 'deleted'),
            'deals_active', (SELECT COUNT(*) FROM deals WHERE store_id = seller_id AND status='active'),
            'deals_paused', (SELECT COUNT(*) FROM deals WHERE store_id = seller_id AND status='paused'),
            'deals_expired', (SELECT COUNT(*) FROM deals WHERE store_id = seller_id AND status='expired'),
            'views', (SELECT COALESCE(SUM(views), 0) FROM deals WHERE store_id = seller_id),
            'clicks', (SELECT COALESCE(SUM(clicks), 0) FROM deals WHERE store_id = seller_id),
            'bookings', (SELECT COUNT(*) FROM bookings WHERE store_id = seller_id),
            'bookings_completed', (SELECT COUNT(*) FROM bookings WHERE store_id = seller_id AND status='completed'),
            'bookings_pending', (SELECT COUNT(*) FROM bookings WHERE store_id = seller_id AND status='pending'),
            'bookings_cancelled', (SELECT COUNT(*) FROM bookings WHERE store_id = seller_id AND status='cancelled'),
            'avg_rating', (SELECT COALESCE(AVG(score)::NUMERIC(3,1), 0) FROM ratings r JOIN deals d ON r.deal_id = d.id WHERE d.store_id = seller_id),
            'rating_count', (SELECT COUNT(*) FROM ratings r JOIN deals d ON r.deal_id = d.id WHERE d.store_id = seller_id),
            'followers', (SELECT COUNT(*) FROM users WHERE seller_id = ANY(followed_merchants)),
            'revenue_estimate', (
                SELECT COALESCE(SUM(d.discounted_price * b.booked_quantity), 0)
                FROM bookings b
                JOIN deals d ON b.deal_id = d.id
                WHERE b.store_id = seller_id AND b.status = 'completed'
            )
        ),
        'last7days', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'date', d::date,
                'bookings', (SELECT COUNT(*) FROM bookings WHERE store_id = seller_id AND created_at::date = d::date),
                'completed', (SELECT COUNT(*) FROM bookings WHERE store_id = seller_id AND status='completed' AND created_at::date = d::date)
            ) ORDER BY d), '[]'::jsonb)
            FROM generate_series(
                (NOW() - INTERVAL '6 days')::date,
                NOW()::date,
                '1 day'::INTERVAL
            ) d
        ),
        'top_deals', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'id', id, 'name', item_name, 'views', views, 'clicks', clicks,
                'bookings', (SELECT COUNT(*) FROM bookings WHERE deal_id = deals.id),
                'image', CASE WHEN array_length(images, 1) > 0 THEN images[1] ELSE NULL END
            ) ORDER BY views DESC), '[]'::jsonb)
            FROM deals
            WHERE store_id = seller_id AND status != 'deleted'
            LIMIT 10
        ),
        'busiest_hour', (
            SELECT extract(hour FROM created_at)::int
            FROM bookings
            WHERE store_id = seller_id
            GROUP BY extract(hour FROM created_at)
            ORDER BY COUNT(*) DESC
            LIMIT 1
        )
    ) INTO result;

    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ====================== 6. ADMIN MODERATION RPCS ======================
CREATE OR REPLACE FUNCTION public.admin_suspend_user(target_user_id TEXT, reason TEXT)
RETURNS void AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM users WHERE id = auth.uid()::text AND user_type = 'admin') THEN
        RAISE EXCEPTION 'Forbidden: admin only';
    END IF;
    UPDATE users SET is_active=false, suspended_at=NOW(), suspension_reason=reason
    WHERE id = target_user_id AND user_type != 'admin';
    INSERT INTO activity_log (user_id, actor_type, event_type, target_table, target_id, severity, metadata)
    VALUES (auth.uid()::text, 'admin', 'admin_suspend_user', 'users', target_user_id, 'warning', jsonb_build_object('reason', reason));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.admin_unsuspend_user(target_user_id TEXT)
RETURNS void AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM users WHERE id = auth.uid()::text AND user_type = 'admin') THEN
        RAISE EXCEPTION 'Forbidden: admin only';
    END IF;
    UPDATE users SET is_active=true, suspended_at=NULL, suspension_reason=NULL WHERE id = target_user_id;
    INSERT INTO activity_log (user_id, actor_type, event_type, target_table, target_id, severity)
    VALUES (auth.uid()::text, 'admin', 'admin_unsuspend_user', 'users', target_user_id, 'success');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.admin_delete_deal(deal_id TEXT)
RETURNS void AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM users WHERE id = auth.uid()::text AND user_type = 'admin') THEN
        RAISE EXCEPTION 'Forbidden: admin only';
    END IF;
    UPDATE deals SET status='deleted', updated_at = NOW() WHERE id = deal_id;
    INSERT INTO activity_log (user_id, actor_type, event_type, target_table, target_id, severity)
    VALUES (auth.uid()::text, 'admin', 'admin_delete_deal', 'deals', deal_id, 'warning');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Admin can update any deal field — we lean on RLS instead of a fat RPC
DROP POLICY IF EXISTS "deals_admin_all" ON deals;
CREATE POLICY "deals_admin_all" ON deals FOR ALL USING (
    auth.uid()::text IN (SELECT id FROM users WHERE user_type = 'admin')
) WITH CHECK (
    auth.uid()::text IN (SELECT id FROM users WHERE user_type = 'admin')
);

-- Admin can read/update ALL bookings
DROP POLICY IF EXISTS "bookings_admin_all" ON bookings;
CREATE POLICY "bookings_admin_all" ON bookings FOR ALL USING (
    auth.uid()::text IN (SELECT id FROM users WHERE user_type = 'admin')
) WITH CHECK (
    auth.uid()::text IN (SELECT id FROM users WHERE user_type = 'admin')
);

-- Admin can update any user (e.g. fix shop name)
DROP POLICY IF EXISTS "users_update_admin" ON users;
CREATE POLICY "users_update_admin" ON users FOR UPDATE USING (
    auth.uid()::text IN (SELECT id FROM users WHERE user_type = 'admin')
) WITH CHECK (
    auth.uid()::text IN (SELECT id FROM users WHERE user_type = 'admin')
);

-- ====================== 7. IMPERSONATION TICKET ======================
-- Issues a short-lived audit-logged ticket. The frontend uses the existing
-- AppContext.viewAs feature to render as buyer/seller; this RPC just records
-- the impersonation for auditing and validates the target exists.
CREATE TABLE IF NOT EXISTS admin_impersonation_log (
    id BIGSERIAL PRIMARY KEY,
    admin_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    notes TEXT
);

ALTER TABLE admin_impersonation_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "imp_log_admin_only" ON admin_impersonation_log;
CREATE POLICY "imp_log_admin_only" ON admin_impersonation_log FOR ALL USING (
    auth.uid()::text IN (SELECT id FROM users WHERE user_type = 'admin')
) WITH CHECK (
    auth.uid()::text IN (SELECT id FROM users WHERE user_type = 'admin')
);

CREATE OR REPLACE FUNCTION public.admin_start_impersonation(target_id TEXT, notes TEXT DEFAULT NULL)
RETURNS BIGINT AS $$
DECLARE
    log_id BIGINT;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM users WHERE id = auth.uid()::text AND user_type = 'admin') THEN
        RAISE EXCEPTION 'Forbidden: admin only';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM users WHERE id = target_id) THEN
        RAISE EXCEPTION 'Target user not found';
    END IF;
    INSERT INTO admin_impersonation_log (admin_id, target_id, notes)
    VALUES (auth.uid()::text, target_id, notes)
    RETURNING id INTO log_id;
    INSERT INTO activity_log (user_id, actor_type, event_type, target_table, target_id, severity, metadata)
    VALUES (auth.uid()::text, 'admin', 'impersonation_start', 'users', target_id, 'critical', jsonb_build_object('log_id', log_id, 'notes', notes));
    RETURN log_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.admin_end_impersonation(log_id BIGINT)
RETURNS void AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM users WHERE id = auth.uid()::text AND user_type = 'admin') THEN
        RAISE EXCEPTION 'Forbidden: admin only';
    END IF;
    UPDATE admin_impersonation_log SET ended_at = NOW() WHERE id = log_id AND admin_id = auth.uid()::text;
    INSERT INTO activity_log (user_id, actor_type, event_type, severity, metadata)
    VALUES (auth.uid()::text, 'admin', 'impersonation_end', 'success', jsonb_build_object('log_id', log_id));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ====================== 8. AUTO-LOG TRIGGERS ======================
-- Keeps activity_log populated even if a frontend forgets to log.

CREATE OR REPLACE FUNCTION public.tg_log_user_signup()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO activity_log (user_id, actor_type, event_type, target_table, target_id, severity, metadata)
    VALUES (NEW.id, NEW.user_type, 'user_registered', 'users', NEW.id, 'success',
            jsonb_build_object('user_type', NEW.user_type, 'name', NEW.name, 'shop', NEW.shop));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tr_log_user_signup ON users;
CREATE TRIGGER tr_log_user_signup AFTER INSERT ON users
FOR EACH ROW EXECUTE FUNCTION public.tg_log_user_signup();

CREATE OR REPLACE FUNCTION public.tg_log_deal_change()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO activity_log (user_id, actor_type, event_type, target_table, target_id, severity, metadata)
        VALUES (NEW.store_id, 'seller', 'deal_created', 'deals', NEW.id, 'info',
                jsonb_build_object('item_name', NEW.item_name, 'discount_percentage', NEW.discount_percentage, 'shop_name', NEW.shop_name));
    ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO activity_log (user_id, actor_type, event_type, target_table, target_id, severity, metadata)
        VALUES (NEW.store_id, 'seller', 'deal_status_changed', 'deals', NEW.id,
                CASE WHEN NEW.status = 'deleted' THEN 'warning' ELSE 'info' END,
                jsonb_build_object('from', OLD.status, 'to', NEW.status, 'item_name', NEW.item_name));
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tr_log_deal_change ON deals;
CREATE TRIGGER tr_log_deal_change AFTER INSERT OR UPDATE ON deals
FOR EACH ROW EXECUTE FUNCTION public.tg_log_deal_change();

CREATE OR REPLACE FUNCTION public.tg_log_booking_change()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO activity_log (user_id, actor_type, event_type, target_table, target_id, severity, metadata)
        VALUES (NEW.user_id, 'buyer', 'booking_created', 'bookings', NEW.barcode, 'success',
                jsonb_build_object('store_id', NEW.store_id, 'deal_id', NEW.deal_id, 'qty', NEW.booked_quantity));
    ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO activity_log (user_id, actor_type, event_type, target_table, target_id, severity, metadata)
        VALUES (NEW.user_id, 'buyer', 'booking_' || NEW.status, 'bookings', NEW.barcode,
                CASE WHEN NEW.status = 'cancelled' THEN 'warning' WHEN NEW.status = 'completed' THEN 'success' ELSE 'info' END,
                jsonb_build_object('store_id', NEW.store_id, 'deal_id', NEW.deal_id));
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tr_log_booking_change ON bookings;
CREATE TRIGGER tr_log_booking_change AFTER INSERT OR UPDATE ON bookings
FOR EACH ROW EXECUTE FUNCTION public.tg_log_booking_change();

-- ====================== 9. COMMENTS / DOCUMENTATION ======================
COMMENT ON TABLE activity_log IS 'Append-only audit log. Admin reads, anyone writes own actions, triggers populate automatically.';
COMMENT ON FUNCTION admin_overview_stats IS 'Returns full KPI bundle for the Admin Overview tab.';
COMMENT ON FUNCTION seller_analytics IS 'Returns analytics for a single seller. Caller must be the seller or an admin.';
COMMENT ON FUNCTION heartbeat IS 'Frontend pings every ~60s to populate users.last_seen_at for presence tracking.';
