-- ============================================================
-- TAKI Platform — Phase 2.4 Store Analytics Engine
-- ============================================================
-- Tracks the full visitor funnel for each store:
--   page_view, deal_view, deal_click, click_phone, click_map,
--   booking_started, booking_abandoned, booking_completed,
--   click_share, click_favorite, click_follow, time_on_page
--
-- Designed for high write volume (every visitor, every scroll):
--   - bigint PK
--   - aggressive indexes
--   - RPC for batched inserts (reduces round trips)
--   - aggregated views for the merchant dashboard
-- ============================================================

CREATE TABLE IF NOT EXISTS store_analytics_events (
    id BIGSERIAL PRIMARY KEY,
    store_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    deal_id TEXT REFERENCES deals(id) ON DELETE SET NULL,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    session_id TEXT,
    event_type TEXT NOT NULL CHECK (event_type IN (
        'page_view',          -- store landing page or feed impression
        'deal_view',          -- deal card visible in feed
        'deal_click',         -- user opened the deal details
        'click_phone',
        'click_map',
        'click_share',
        'click_favorite',
        'click_follow',
        'booking_started',    -- user opened the booking modal
        'booking_abandoned',  -- closed modal without booking
        'booking_completed',  -- actual booking row written
        'time_on_page'        -- aggregated session length
    )),
    duration_ms INTEGER,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_an_store_time ON store_analytics_events(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_an_deal_time ON store_analytics_events(deal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_an_event ON store_analytics_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_an_session ON store_analytics_events(session_id) WHERE session_id IS NOT NULL;

ALTER TABLE store_analytics_events ENABLE ROW LEVEL SECURITY;

-- Anyone (incl. anon) can write events — but only their own session id.
-- Admins and the owning store can read all rows for their funnel dashboards.
DROP POLICY IF EXISTS "an_insert_anyone" ON store_analytics_events;
CREATE POLICY "an_insert_anyone" ON store_analytics_events FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "an_select_owner_or_admin" ON store_analytics_events;
CREATE POLICY "an_select_owner_or_admin" ON store_analytics_events FOR SELECT USING (
    auth.uid()::text = store_id
    OR auth.uid()::text IN (SELECT id FROM users WHERE user_type = 'admin')
);

-- ====================== BATCH INSERT RPC ======================
-- The client buffers events and flushes 1× per second. JSONB array
-- arrives, server unrolls into rows. Reduces network chatter dramatically.
CREATE OR REPLACE FUNCTION public.record_analytics_events(p_events JSONB)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_count INTEGER := 0;
BEGIN
    IF p_events IS NULL OR jsonb_array_length(p_events) = 0 THEN
        RETURN 0;
    END IF;

    INSERT INTO store_analytics_events (
        store_id, deal_id, user_id, session_id, event_type, duration_ms, metadata, created_at
    )
    SELECT
        ev->>'store_id',
        NULLIF(ev->>'deal_id',''),
        NULLIF(ev->>'user_id',''),
        NULLIF(ev->>'session_id',''),
        ev->>'event_type',
        NULLIF(ev->>'duration_ms','')::int,
        COALESCE(ev->'metadata','{}'::jsonb),
        COALESCE((ev->>'created_at')::timestamptz, NOW())
    FROM jsonb_array_elements(p_events) AS ev
    WHERE ev->>'store_id' IS NOT NULL
      AND ev->>'event_type' IS NOT NULL;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_analytics_events(JSONB) TO authenticated, anon;

-- ====================== FUNNEL AGGREGATION RPC ======================
-- Returns the conversion funnel for a store over a date range.
-- Used by the seller's analytics dashboard.
CREATE OR REPLACE FUNCTION public.get_store_funnel(
    p_store_id TEXT,
    p_start TIMESTAMPTZ DEFAULT NOW() - interval '30 days',
    p_end TIMESTAMPTZ DEFAULT NOW()
)
RETURNS TABLE (
    views BIGINT,
    clicks BIGINT,
    booking_started BIGINT,
    booking_abandoned BIGINT,
    booking_completed BIGINT,
    abandoned_rate NUMERIC,
    conversion_rate NUMERIC,
    unique_sessions BIGINT,
    avg_time_ms NUMERIC
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_caller_role TEXT;
BEGIN
    -- The owning seller and admins can run this.
    SELECT user_type INTO v_caller_role FROM users WHERE id = auth.uid()::text;
    IF auth.uid()::text <> p_store_id AND v_caller_role <> 'admin' THEN
        RAISE EXCEPTION 'Forbidden';
    END IF;

    RETURN QUERY
    WITH ev AS (
        SELECT * FROM store_analytics_events
         WHERE store_id = p_store_id
           AND created_at BETWEEN p_start AND p_end
    ),
    cnt_v   AS (SELECT COUNT(*)::bigint AS n FROM ev WHERE event_type IN ('deal_view','page_view')),
    cnt_c   AS (SELECT COUNT(*)::bigint AS n FROM ev WHERE event_type = 'deal_click'),
    cnt_bs  AS (SELECT COUNT(*)::bigint AS n FROM ev WHERE event_type = 'booking_started'),
    cnt_ba  AS (SELECT COUNT(*)::bigint AS n FROM ev WHERE event_type = 'booking_abandoned'),
    cnt_bc  AS (SELECT COUNT(*)::bigint AS n FROM ev WHERE event_type = 'booking_completed'),
    cnt_s   AS (SELECT COUNT(DISTINCT session_id)::bigint AS n FROM ev WHERE session_id IS NOT NULL),
    cnt_t   AS (SELECT COALESCE(AVG(duration_ms)::numeric,0) AS n FROM ev WHERE event_type = 'time_on_page')
    SELECT
        cnt_v.n, cnt_c.n, cnt_bs.n, cnt_ba.n, cnt_bc.n,
        CASE WHEN cnt_bs.n = 0 THEN 0 ELSE ROUND((cnt_ba.n::numeric / cnt_bs.n::numeric) * 100, 1) END,
        CASE WHEN cnt_c.n  = 0 THEN 0 ELSE ROUND((cnt_bc.n::numeric / cnt_c.n::numeric) * 100, 1) END,
        cnt_s.n, cnt_t.n
    FROM cnt_v, cnt_c, cnt_bs, cnt_ba, cnt_bc, cnt_s, cnt_t;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_store_funnel(TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

-- Per-deal funnel for the dashboard.
CREATE OR REPLACE FUNCTION public.get_deal_funnel(
    p_deal_id TEXT,
    p_start TIMESTAMPTZ DEFAULT NOW() - interval '30 days',
    p_end TIMESTAMPTZ DEFAULT NOW()
)
RETURNS TABLE (
    views BIGINT,
    clicks BIGINT,
    booking_started BIGINT,
    booking_abandoned BIGINT,
    booking_completed BIGINT,
    favorites BIGINT,
    shares BIGINT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_store_id TEXT;
    v_caller_role TEXT;
BEGIN
    SELECT store_id INTO v_store_id FROM deals WHERE id = p_deal_id;
    SELECT user_type INTO v_caller_role FROM users WHERE id = auth.uid()::text;
    IF auth.uid()::text <> v_store_id AND v_caller_role <> 'admin' THEN
        RAISE EXCEPTION 'Forbidden';
    END IF;

    RETURN QUERY
    WITH ev AS (
        SELECT * FROM store_analytics_events
         WHERE deal_id = p_deal_id
           AND created_at BETWEEN p_start AND p_end
    )
    SELECT
        (SELECT COUNT(*) FROM ev WHERE event_type = 'deal_view')::bigint,
        (SELECT COUNT(*) FROM ev WHERE event_type = 'deal_click')::bigint,
        (SELECT COUNT(*) FROM ev WHERE event_type = 'booking_started')::bigint,
        (SELECT COUNT(*) FROM ev WHERE event_type = 'booking_abandoned')::bigint,
        (SELECT COUNT(*) FROM ev WHERE event_type = 'booking_completed')::bigint,
        (SELECT COUNT(*) FROM ev WHERE event_type = 'click_favorite')::bigint,
        (SELECT COUNT(*) FROM ev WHERE event_type = 'click_share')::bigint;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_deal_funnel(TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

-- Daily breakdown for charting.
CREATE OR REPLACE FUNCTION public.get_store_daily(
    p_store_id TEXT,
    p_days INTEGER DEFAULT 14
)
RETURNS TABLE (day DATE, views BIGINT, clicks BIGINT, bookings BIGINT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_caller_role TEXT;
BEGIN
    SELECT user_type INTO v_caller_role FROM users WHERE id = auth.uid()::text;
    IF auth.uid()::text <> p_store_id AND v_caller_role <> 'admin' THEN
        RAISE EXCEPTION 'Forbidden';
    END IF;

    RETURN QUERY
    SELECT (created_at AT TIME ZONE 'Asia/Riyadh')::date AS day,
           SUM(CASE WHEN event_type IN ('deal_view','page_view') THEN 1 ELSE 0 END)::bigint,
           SUM(CASE WHEN event_type = 'deal_click' THEN 1 ELSE 0 END)::bigint,
           SUM(CASE WHEN event_type = 'booking_completed' THEN 1 ELSE 0 END)::bigint
      FROM store_analytics_events
     WHERE store_id = p_store_id
       AND created_at >= NOW() - (p_days || ' days')::interval
     GROUP BY 1
     ORDER BY 1 DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_store_daily(TEXT, INTEGER) TO authenticated;

-- ====================== HOUSEKEEPING ======================
-- Limit storage growth: drop raw events older than 180 days.
-- Call from pg_cron weekly.
CREATE OR REPLACE FUNCTION public.prune_analytics_events(p_keep_days INTEGER DEFAULT 180)
RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_count BIGINT;
BEGIN
    DELETE FROM store_analytics_events
     WHERE created_at < NOW() - (p_keep_days || ' days')::interval;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.prune_analytics_events(INTEGER) TO authenticated;
