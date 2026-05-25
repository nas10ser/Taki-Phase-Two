-- =========================================================================
-- TAKI v11.20 — Coming Soon deals (scheduled launch)
-- =========================================================================
-- Lets a merchant schedule a deal up to 30 days ahead. The deal stays
-- HIDDEN from buyers until it enters its 7-day countdown window, at which
-- point it appears on Home in the new "العروض القادمة" section with a
-- locked card + countdown. Bookings open the moment `starts_at` passes.
--
-- DB-side changes:
--   1. New column `starts_at BIGINT` (epoch ms, nullable). NULL = legacy
--      always-live deal.
--   2. Index on `starts_at` so the Home `coming_soon` filter is fast.
--   3. The smart-alert dispatcher (`taki_dispatch_smart_alert`) now writes
--      a `coming_soon=true` flag + a localised title/body variant when
--      the deal is scheduled. This lets a buyer who set "تنبيه عيادة
--      الرياض" get pinged the moment a clinic schedules an upcoming
--      launch — even before the 7-day visibility window opens. They can
--      prep early; the actual booking still waits for starts_at.
--
-- Notes:
--   * Visibility windowing (7-day Home cut, 30-day max schedule) is
--     enforced client-side — the DB doesn't need to know. The trigger
--     fires once on INSERT regardless of when the deal will launch.
--   * The `tr_guard_deal_publish` trigger remains untouched — scheduling
--     a deal still counts as publishing for the merchant's plan quota,
--     which is the right call (the slot is committed for that future
--     launch and shouldn't be double-spent).
-- =========================================================================

-- Step 1 — Column + index.
ALTER TABLE public.deals
    ADD COLUMN IF NOT EXISTS starts_at BIGINT;

COMMENT ON COLUMN public.deals.starts_at IS
    'Scheduled launch (epoch ms). NULL = launches immediately on insert. '
    'When set in the future the deal is "Coming Soon": surfaced on Home but '
    'locked from booking until the timestamp passes.';

-- Partial index — only future-dated deals matter for the Home "Coming Soon"
-- section. Past starts_at means the deal is already live; the existing
-- created_at index handles the active listings.
CREATE INDEX IF NOT EXISTS idx_deals_starts_at_future
    ON public.deals (starts_at)
    WHERE starts_at IS NOT NULL;

-- Step 2 — Rebuild taki_dispatch_smart_alert with Coming-Soon awareness.
-- The body of the function is identical to v10.64 except for the new
-- `is_coming_soon` branch that swaps the title/body wording and stamps
-- `coming_soon=true` + `starts_at` into meta_data so the client can route
-- the buyer to a locked detail page (or simply highlight the chip).
CREATE OR REPLACE FUNCTION public.taki_dispatch_smart_alert(
    p_user_id            TEXT,
    p_followed_merchants TEXT[],
    p_smart_alerts       JSONB,
    p_deal               public.deals,
    p_deal_region        TEXT,
    p_deal_city          TEXT,
    p_deal_lat           DOUBLE PRECISION,
    p_deal_lng           DOUBLE PRECISION,
    p_skip_existing      BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
    is_follower         BOOLEAN;
    rule_matched        BOOLEAN := FALSE;
    deal_text           TEXT;
    rule                JSONB;
    rule_idx            INT;
    ok                  BOOLEAN;
    has_any_condition   BOOLEAN;
    this_range          DOUBLE PRECISION;
    this_kw             TEXT;
    kw_ok               BOOLEAN;
    i                   INT;
    kw                  TEXT;
    has_range           BOOLEAN := FALSE;
    range_km_min        DOUBLE PRECISION;
    has_mall            BOOLEAN := FALSE;
    has_city            BOOLEAN := FALSE;
    has_category        BOOLEAN := FALSE;
    cat_first           TEXT;
    has_keyword         BOOLEAN := FALSE;
    kw_first            TEXT;
    has_region          BOOLEAN := FALSE;
    chips_ar            TEXT[] := ARRAY[]::TEXT[];
    chips_en            TEXT[] := ARRAY[]::TEXT[];
    title_ar            TEXT;
    title_en            TEXT;
    body_ar             TEXT;
    body_en             TEXT;
    nkind               TEXT;
    city_name           TEXT;
    mall_name           TEXT;
    chip_count          INT;
    shown_ar            TEXT[];
    shown_en            TEXT[];
    more_n              INT;
    line1_ar            TEXT;
    line1_en            TEXT;
    line2_ar            TEXT;
    line2_en            TEXT;
    line3_ar            TEXT;
    line3_en            TEXT;
    range_num_text      TEXT;
    range_chip_ar       TEXT;
    range_chip_en       TEXT;
    range_title_ar      TEXT;
    range_title_en      TEXT;
    -- v11.20
    is_coming_soon      BOOLEAN := FALSE;
    now_ms              BIGINT;
    starts_in_days      INT;
    starts_eta_ar       TEXT;
    starts_eta_en       TEXT;
BEGIN
    is_follower := p_followed_merchants IS NOT NULL
                   AND p_deal.store_id = ANY(p_followed_merchants);

    -- v11.20 — detect scheduled deals.
    now_ms := (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT;
    IF p_deal.starts_at IS NOT NULL AND p_deal.starts_at > now_ms THEN
        is_coming_soon := TRUE;
        starts_in_days := GREATEST(1, CEIL((p_deal.starts_at - now_ms)::numeric / 86400000.0)::INT);
        IF starts_in_days = 1 THEN
            starts_eta_ar := 'خلال يوم';
            starts_eta_en := 'in 1 day';
        ELSIF starts_in_days = 2 THEN
            starts_eta_ar := 'بعد يومين';
            starts_eta_en := 'in 2 days';
        ELSE
            starts_eta_ar := 'خلال ' || starts_in_days::TEXT || ' أيام';
            starts_eta_en := 'in ' || starts_in_days::TEXT || ' days';
        END IF;
    END IF;

    deal_text := LOWER(
        COALESCE(p_deal.item_name, '')   || ' ' ||
        COALESCE(p_deal.shop_name, '')   || ' ' ||
        COALESCE(p_deal.category, '')    || ' ' ||
        COALESCE(p_deal.description, '')
    );

    -- ===== Rule evaluation =====
    IF p_smart_alerts IS NOT NULL
       AND jsonb_typeof(p_smart_alerts) = 'array'
       AND jsonb_array_length(p_smart_alerts) > 0
    THEN
        FOR rule_idx IN 0 .. (jsonb_array_length(p_smart_alerts) - 1) LOOP
            rule              := p_smart_alerts -> rule_idx;
            ok                := TRUE;
            this_range        := NULL;
            this_kw           := NULL;
            has_any_condition := FALSE;

            IF rule ? 'regions' AND jsonb_array_length(rule->'regions') > 0 THEN
                has_any_condition := TRUE;
                IF p_deal_region IS NULL OR NOT (rule->'regions' ? p_deal_region) THEN
                    ok := FALSE;
                END IF;
            END IF;
            IF ok AND rule ? 'cities' AND jsonb_array_length(rule->'cities') > 0 THEN
                has_any_condition := TRUE;
                IF p_deal_city IS NULL OR NOT (rule->'cities' ? p_deal_city) THEN
                    ok := FALSE;
                END IF;
            END IF;
            IF ok AND rule ? 'malls' AND jsonb_array_length(rule->'malls') > 0 THEN
                has_any_condition := TRUE;
                IF p_deal.location_id IS NULL OR NOT (rule->'malls' ? p_deal.location_id) THEN
                    ok := FALSE;
                END IF;
            END IF;
            IF ok AND rule ? 'categories' AND jsonb_array_length(rule->'categories') > 0 THEN
                has_any_condition := TRUE;
                IF p_deal.category IS NULL OR NOT (rule->'categories' ? p_deal.category) THEN
                    ok := FALSE;
                END IF;
            END IF;
            IF ok AND rule ? 'keywords' AND jsonb_array_length(rule->'keywords') > 0 THEN
                has_any_condition := TRUE;
                kw_ok := FALSE;
                FOR i IN 0 .. (jsonb_array_length(rule->'keywords') - 1) LOOP
                    kw := lower(rule->'keywords'->>i);
                    IF length(kw) > 0 AND deal_text LIKE '%' || kw || '%' THEN
                        kw_ok := TRUE;
                        this_kw := rule->'keywords'->>i;
                        EXIT;
                    END IF;
                END LOOP;
                IF NOT kw_ok THEN ok := FALSE; END IF;
            END IF;
            IF ok
               AND rule ? 'coords'
               AND rule->'coords' ? 'lat'
               AND rule->'coords' ? 'lng'
               AND rule ? 'radiusKm'
            THEN
                has_any_condition := TRUE;
                this_range := public.taki_haversine_km(
                    (rule->'coords'->>'lat')::DOUBLE PRECISION,
                    (rule->'coords'->>'lng')::DOUBLE PRECISION,
                    p_deal_lat, p_deal_lng
                );
                IF this_range IS NULL
                   OR this_range > (rule->>'radiusKm')::DOUBLE PRECISION
                THEN
                    ok := FALSE;
                END IF;
            END IF;

            IF NOT has_any_condition THEN
                ok := FALSE;
            END IF;

            IF ok THEN
                rule_matched := TRUE;
                IF rule ? 'regions' AND jsonb_array_length(rule->'regions') > 0 THEN
                    has_region := TRUE;
                END IF;
                IF rule ? 'cities' AND jsonb_array_length(rule->'cities') > 0 THEN
                    has_city := TRUE;
                END IF;
                IF rule ? 'malls' AND jsonb_array_length(rule->'malls') > 0 THEN
                    has_mall := TRUE;
                END IF;
                IF rule ? 'categories' AND jsonb_array_length(rule->'categories') > 0 THEN
                    has_category := TRUE;
                    IF cat_first IS NULL THEN cat_first := p_deal.category; END IF;
                END IF;
                IF rule ? 'keywords' AND jsonb_array_length(rule->'keywords') > 0 THEN
                    has_keyword := TRUE;
                    IF kw_first IS NULL THEN kw_first := this_kw; END IF;
                END IF;
                IF rule ? 'coords' AND rule ? 'radiusKm' THEN
                    has_range := TRUE;
                    IF this_range IS NOT NULL
                       AND (range_km_min IS NULL OR this_range < range_km_min)
                    THEN
                        range_km_min := this_range;
                    END IF;
                END IF;
            END IF;
        END LOOP;
    END IF;

    IF NOT is_follower AND NOT rule_matched THEN
        RETURN FALSE;
    END IF;

    IF p_skip_existing THEN
        IF EXISTS (
            SELECT 1 FROM public.notifications
            WHERE user_id = p_user_id
              AND (meta_data->>'dealId') = p_deal.id::TEXT
              AND type IN ('deal','marketing')
        ) THEN
            RETURN FALSE;
        END IF;
    END IF;

    IF has_city AND p_deal_city IS NOT NULL THEN
        SELECT name INTO city_name FROM public.cities WHERE id = p_deal_city LIMIT 1;
    END IF;
    IF has_mall AND p_deal.location_id IS NOT NULL THEN
        SELECT name INTO mall_name FROM public.locations WHERE id = p_deal.location_id LIMIT 1;
    END IF;

    IF has_range AND range_km_min IS NOT NULL THEN
        IF range_km_min < 0.1 THEN
            range_chip_ar  := '📍 بجانبك تماماً';
            range_chip_en  := '📍 Right next to you';
            range_title_ar := '📍 عرض بجانبك تماماً';
            range_title_en := '📍 A deal right next to you';
        ELSIF range_km_min < 1 THEN
            range_chip_ar  := '📍 أقل من 1 كم منك';
            range_chip_en  := '📍 Under 1 km away';
            range_title_ar := '📍 عرض على بُعد أقل من 1 كم منك';
            range_title_en := '📍 Deal under 1 km from you';
        ELSE
            range_num_text := TRIM(TRAILING '.' FROM
                                   TRIM(TRAILING '0' FROM ROUND(range_km_min::numeric, 1)::TEXT));
            IF range_num_text = '' OR range_num_text IS NULL THEN
                range_num_text := '1';
            END IF;
            range_chip_ar  := '📍 ' || range_num_text || ' كم منك';
            range_chip_en  := '📍 ' || range_num_text || ' km away';
            range_title_ar := '📍 عرض على بُعد ' || range_num_text || ' كم منك';
            range_title_en := '📍 Deal ' || range_num_text || ' km from you';
        END IF;
    END IF;

    IF is_follower THEN
        chips_ar := chips_ar || '🔥 متجر تتابعه'::TEXT;
        chips_en := chips_en || '🔥 Followed store'::TEXT;
    END IF;
    IF has_range THEN
        chips_ar := chips_ar || range_chip_ar;
        chips_en := chips_en || range_chip_en;
    END IF;
    IF has_mall THEN
        chips_ar := chips_ar || ('🏬 ' || COALESCE(mall_name, 'مولك'))::TEXT;
        chips_en := chips_en || ('🏬 ' || COALESCE(mall_name, 'Your mall'))::TEXT;
    END IF;
    IF has_city THEN
        chips_ar := chips_ar || ('🌆 ' || COALESCE(city_name, 'مدينتك'))::TEXT;
        chips_en := chips_en || ('🌆 ' || COALESCE(city_name, 'Your city'))::TEXT;
    END IF;
    IF has_category THEN
        chips_ar := chips_ar || public.taki_category_label_ar(cat_first);
        chips_en := chips_en || public.taki_category_label_en(cat_first);
    END IF;
    IF has_keyword THEN
        chips_ar := chips_ar || ('🔍 «' || kw_first || '»')::TEXT;
        chips_en := chips_en || ('🔍 "' || kw_first || '"')::TEXT;
    END IF;
    IF has_region THEN
        chips_ar := chips_ar || '🌍 منطقتك'::TEXT;
        chips_en := chips_en || '🌍 Your region'::TEXT;
    END IF;
    -- v11.20 — Coming Soon chip (always last so the type chips up front
    -- stay scannable; but it dominates the TITLE below).
    IF is_coming_soon THEN
        chips_ar := chips_ar || ('⏳ يبدأ ' || starts_eta_ar)::TEXT;
        chips_en := chips_en || ('⏳ Starts ' || starts_eta_en)::TEXT;
    END IF;

    -- ===== Title — Coming Soon WINS over all other signals, because the
    -- buyer needs to know they can't book it yet. =====
    IF is_coming_soon THEN
        title_ar := '⏳ عرض قادم — ' || COALESCE(p_deal.shop_name, 'متجر') || ' يبدأ ' || starts_eta_ar;
        title_en := '⏳ Coming soon — ' || COALESCE(p_deal.shop_name, 'a store') || ' starts ' || starts_eta_en;
    ELSIF is_follower AND rule_matched THEN
        title_ar := '🔥 ' || COALESCE(p_deal.shop_name, 'متجر تتابعه') || ' نزّل عرضاً يطابق تنبيهك';
        title_en := '🔥 ' || COALESCE(p_deal.shop_name, 'A store you follow') || ' posted a matching deal';
    ELSIF is_follower THEN
        title_ar := '🔥 ' || COALESCE(p_deal.shop_name, 'متجرك المفضل') || ' نزّل عرضاً جديداً';
        title_en := '🔥 New deal from ' || COALESCE(p_deal.shop_name, 'your favorite store');
    ELSIF has_range THEN
        title_ar := range_title_ar;
        title_en := range_title_en;
    ELSIF has_mall THEN
        title_ar := '🏬 عرض جديد في ' || COALESCE(mall_name, 'مولك');
        title_en := '🏬 New deal at ' || COALESCE(mall_name, 'your mall');
    ELSIF has_city THEN
        title_ar := '🌆 عرض جديد في ' || COALESCE(city_name, 'مدينتك');
        title_en := '🌆 New deal in ' || COALESCE(city_name, 'your city');
    ELSIF has_keyword THEN
        title_ar := '🔍 عرض يطابق كلمتك «' || kw_first || '»';
        title_en := '🔍 Deal matching "' || kw_first || '"';
    ELSIF has_category THEN
        title_ar := '🎯 ' || public.taki_category_label_ar(cat_first) || ' — عرض جديد';
        title_en := '🎯 ' || public.taki_category_label_en(cat_first) || ' — new deal';
    ELSIF has_region THEN
        title_ar := '🌍 عرض جديد في منطقتك';
        title_en := '🌍 New deal in your region';
    ELSE
        title_ar := '🎯 يطابق تنبيهك الذكي';
        title_en := '🎯 Matches your smart alert';
    END IF;

    line1_ar := COALESCE(p_deal.item_name, 'عرض جديد')
                || '  —  خصم ' || COALESCE(p_deal.discount_percentage::TEXT, '؟') || '٪';
    line1_en := COALESCE(p_deal.item_name, 'New deal')
                || '  —  ' || COALESCE(p_deal.discount_percentage::TEXT, '?') || '% off';
    line2_ar := '🏪 ' || COALESCE(p_deal.shop_name, 'متجر');
    line2_en := '🏪 ' || COALESCE(p_deal.shop_name, 'Store');

    chip_count := COALESCE(array_length(chips_ar, 1), 0);
    IF chip_count <= 3 THEN
        shown_ar := chips_ar;
        shown_en := chips_en;
        more_n   := 0;
    ELSE
        shown_ar := chips_ar[1:3];
        shown_en := chips_en[1:3];
        more_n   := chip_count - 3;
    END IF;

    IF chip_count > 0 THEN
        line3_ar := array_to_string(shown_ar, '  •  ');
        line3_en := array_to_string(shown_en, '  •  ');
        IF more_n > 0 THEN
            line3_ar := line3_ar || '  •  +' || more_n::TEXT;
            line3_en := line3_en || '  •  +' || more_n::TEXT;
        END IF;
        body_ar := line1_ar || E'\n' || line2_ar || E'\n' || line3_ar;
        body_en := line1_en || E'\n' || line2_en || E'\n' || line3_en;
    ELSE
        body_ar := line1_ar || E'\n' || line2_ar;
        body_en := line1_en || E'\n' || line2_en;
    END IF;

    IF is_coming_soon THEN
        nkind := 'coming_soon';
    ELSIF is_follower THEN
        nkind := 'follow';
    ELSIF has_range THEN
        nkind := 'range';
    ELSIF has_mall THEN
        nkind := 'mall';
    ELSIF has_city THEN
        nkind := 'city';
    ELSIF has_keyword THEN
        nkind := 'keyword';
    ELSIF has_category THEN
        nkind := 'category';
    ELSIF has_region THEN
        nkind := 'region';
    ELSE
        nkind := 'other';
    END IF;

    INSERT INTO public.notifications
        (user_id, title_ar, title_en, body_ar, body_en, type, meta_data, created_at)
    VALUES (
        p_user_id, title_ar, title_en, body_ar, body_en,
        CASE WHEN is_follower THEN 'deal' ELSE 'marketing' END,
        jsonb_build_object(
            'dealId',         p_deal.id::TEXT,
            'reasons_ar',     to_jsonb(chips_ar),
            'reasons_en',     to_jsonb(chips_en),
            'follower',       is_follower,
            'primary_kind',   nkind,
            'audience',       CASE WHEN is_follower THEN 'follower' ELSE 'alert' END,
            'coming_soon',    is_coming_soon,
            'starts_at',      p_deal.starts_at,
            'bot_message_ar', title_ar || E'\n\n' || body_ar,
            'bot_message_en', title_en || E'\n\n' || body_en
        ),
        NOW()
    );

    RETURN TRUE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.taki_dispatch_smart_alert(
    TEXT, TEXT[], JSONB, public.deals, TEXT, TEXT,
    DOUBLE PRECISION, DOUBLE PRECISION, BOOLEAN
) FROM PUBLIC;
