-- =========================================================================
-- TAKI v10.64 — Smart alerts: combined + priority-ordered + backfill + bot prep
-- =========================================================================
-- Three problems addressed:
--   (1) Nasser turned on an Electronics smart alert but never received a
--       notification. Root cause: tr_deal_smart_notifications fires only on
--       AFTER INSERT on deals, so deals that already existed when the alert
--       was enabled are never re-evaluated.
--   (2) When a single deal matches multiple alert rules, the seller wanted
--       ONE notification combining all reasons — most specific first —
--       rather than several separate notifications. The existing trigger
--       already inserted one notification per (user, deal), but the body
--       just joined reasons with "•" and the title was a generic
--       "🎯 يطابق تنبيهك الذكي". This release upgrades both.
--   (3) Bots (Telegram + WhatsApp) need a clean, multi-line message to
--       forward to subscribed users in the future — same notification row,
--       just consumed from `meta_data.bot_message_ar/_en`.
--
-- Architecture: one reusable dispatch function `taki_dispatch_smart_alert`
-- is called by two triggers:
--   - tr_deal_smart_notifications  (on deals AFTER INSERT)  → for every user
--   - tr_smart_alerts_backfill     (on users AFTER UPDATE OF smart_alerts)
--                                                          → for every recent active deal
--
-- The backfill trigger uses a deep-equality scan over OLD vs NEW JSONB to
-- detect newly-added or edited rules, so removing a rule does NOT replay
-- backfill, and editing one DOES.
-- =========================================================================

-- Step 1 — Bot routing columns. Inert until the user opts in by linking a
-- chat ID AND flipping the boolean. Defaults to OFF so this migration is
-- behaviorally a no-op for the bot side; the actual realtime forwarder
-- lives in server/bot.js.
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS telegram_chat_id     BIGINT,
    ADD COLUMN IF NOT EXISTS whatsapp_chat_id     TEXT,
    ADD COLUMN IF NOT EXISTS notify_via_telegram  BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS notify_via_whatsapp  BOOLEAN NOT NULL DEFAULT FALSE;

-- Step 2 — Category label helpers, mirroring CATEGORIES[] in src/data/mock.ts.
-- Used by the dispatch function to render "🎯 إلكترونيات" instead of the
-- raw "Electronics" id in the chip / title.
CREATE OR REPLACE FUNCTION public.taki_category_label_ar(p_id TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
SET search_path = 'public'
AS $$
    SELECT CASE p_id
        WHEN 'Fashion_Women' THEN '👗 فساتين ونساء'
        WHEN 'Fashion_Men'   THEN '👔 ملابس رجالية'
        WHEN 'Kids_Infants'  THEN '👶 رضع وملابس حمل'
        WHEN 'Kids_Girls'    THEN '👧 ملابس أطفال'
        WHEN 'Electronics'   THEN '📱 إلكترونيات'
        WHEN 'Food'          THEN '🍔 مطاعم'
        WHEN 'Beauty'        THEN '💄 عطور وتجميل'
        WHEN 'Sports'        THEN '⚽ رياضة'
        WHEN 'Supermarket'   THEN '🛒 سوبرماركت'
        WHEN 'Sanitary'      THEN '🚿 أدوات صحية'
        WHEN 'Cafe'          THEN '☕ مقاهي'
        WHEN 'Home'          THEN '🏠 منزل وديكور'
        WHEN 'Hotels'        THEN '🏨 فنادق'
        WHEN 'CarRentals'    THEN '🚗 تأجير سيارات'
        WHEN 'Laundry'       THEN '🧺 مغسلة ملابس'
        WHEN 'CarWash'       THEN '🧽 مغسلة سيارات'
        WHEN 'CarWorkshop'   THEN '🔧 ورش سيارات'
        WHEN 'Amusements'    THEN '🎡 ملاهي ألعاب'
        WHEN 'Gym'           THEN '🏋️ نادي رياضي'
        WHEN 'Library'       THEN '📚 مكتبة'
        WHEN 'Nursery'       THEN '🌱 مشاتل زراعية'
        WHEN 'Pharmacy'      THEN '💊 صيدلية'
        WHEN 'Online'        THEN '🌐 أونلاين'
        WHEN 'Other'         THEN '✨ أخرى'
        ELSE COALESCE(p_id, '')
    END;
$$;

CREATE OR REPLACE FUNCTION public.taki_category_label_en(p_id TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
SET search_path = 'public'
AS $$
    SELECT CASE p_id
        WHEN 'Fashion_Women' THEN '👗 Women & Dresses'
        WHEN 'Fashion_Men'   THEN '👔 Men Fashion'
        WHEN 'Kids_Infants'  THEN '👶 Infants & Maternity'
        WHEN 'Kids_Girls'    THEN '👧 Kids'
        WHEN 'Electronics'   THEN '📱 Electronics'
        WHEN 'Food'          THEN '🍔 Food'
        WHEN 'Beauty'        THEN '💄 Beauty'
        WHEN 'Sports'        THEN '⚽ Sports'
        WHEN 'Supermarket'   THEN '🛒 Supermarket'
        WHEN 'Sanitary'      THEN '🚿 Sanitary'
        WHEN 'Cafe'          THEN '☕ Cafes'
        WHEN 'Home'          THEN '🏠 Home'
        WHEN 'Hotels'        THEN '🏨 Hotels'
        WHEN 'CarRentals'    THEN '🚗 Car Rentals'
        WHEN 'Laundry'       THEN '🧺 Laundromats'
        WHEN 'CarWash'       THEN '🧽 Car Wash'
        WHEN 'CarWorkshop'   THEN '🔧 Car Workshops'
        WHEN 'Amusements'    THEN '🎡 Amusements'
        WHEN 'Gym'           THEN '🏋️ Gym'
        WHEN 'Library'       THEN '📚 Library'
        WHEN 'Nursery'       THEN '🌱 Nurseries'
        WHEN 'Pharmacy'      THEN '💊 Pharmacy'
        WHEN 'Online'        THEN '🌐 Online'
        WHEN 'Other'         THEN '✨ Other'
        ELSE COALESCE(p_id, '')
    END;
$$;

-- Step 3 — The core dispatch function.
-- Evaluates ONE (user, deal) pair against the user's followed_merchants and
-- smart_alerts (array of rules; AND within a rule, OR across rules).
-- If anything matches it INSERTs exactly ONE notification with:
--   * Title       = highest-priority match-kind ("📍 على بُعد X كم منك" beats
--                   "🌍 عرض جديد في منطقتك")
--   * Body        = 3 lines: item+discount / store / priority-ordered chips
--                   (capped at top 3 + "+N more" indicator)
--   * meta_data   = dealId, reasons (both langs), primary_kind, audience,
--                   plus a bot-ready pre-rendered `bot_message_ar/_en`
-- Returns TRUE iff a notification was inserted.
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
BEGIN
    is_follower := p_followed_merchants IS NOT NULL
                   AND p_deal.store_id = ANY(p_followed_merchants);

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

            -- Empty rule { } would otherwise match everything — guard.
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

    -- Backfill dedupe — don't double-notify the same (user, deal) pair.
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

    -- Resolve display names for chips/title
    IF has_city AND p_deal_city IS NOT NULL THEN
        SELECT name INTO city_name FROM public.cities WHERE id = p_deal_city LIMIT 1;
    END IF;
    IF has_mall AND p_deal.location_id IS NOT NULL THEN
        SELECT name INTO mall_name FROM public.locations WHERE id = p_deal.location_id LIMIT 1;
    END IF;

    -- Range text variants — chip vs. title, with natural wording for very
    -- short distances. "0 كم" reads badly, so anything under 100 m maps to
    -- "بجانبك" and under 1 km maps to "أقل من 1 كم".
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

    -- ===== Priority-ordered chips (most specific → most general) =====
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

    -- ===== Title — strongest signal wins =====
    IF is_follower AND rule_matched THEN
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

    -- ===== Body — 3 lines, scannable, top-3 chips =====
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

    IF is_follower THEN
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
            -- Pre-rendered, plain-text, bot-friendly forms. The bot can grab
            -- these as-is and send to Telegram/WhatsApp with no escaping.
            'bot_message_ar', title_ar || E'\n\n' || body_ar,
            'bot_message_en', title_en || E'\n\n' || body_en
        ),
        NOW()
    );

    RETURN TRUE;
END;
$$;

-- Lock down the dispatch function — only triggers (definer) should call it.
REVOKE EXECUTE ON FUNCTION public.taki_dispatch_smart_alert(
    TEXT, TEXT[], JSONB, public.deals, TEXT, TEXT,
    DOUBLE PRECISION, DOUBLE PRECISION, BOOLEAN
) FROM PUBLIC;

-- Step 4 — Replace the deal-INSERT trigger function so it routes through
-- the new dispatch (instead of inlining all the matching/formatting logic).
CREATE OR REPLACE FUNCTION public.handle_deal_smart_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
    deal_region_id  TEXT;
    deal_city_id    TEXT;
    deal_lat        DOUBLE PRECISION;
    deal_lng        DOUBLE PRECISION;
    nearest_row     public.sa_cities_geo;
    rec             RECORD;
BEGIN
    IF NEW.status <> 'active' THEN
        RETURN NEW;
    END IF;

    deal_region_id := NEW.region;
    deal_city_id   := NEW.city;
    deal_lat       := NEW.map_lat;
    deal_lng       := NEW.map_lng;

    -- Fall back to location_id → city → region if the deal didn't denormalise.
    IF deal_region_id IS NULL OR deal_city_id IS NULL THEN
        SELECT l.city_id, c.region_id,
               COALESCE(deal_lat, l.lat),
               COALESCE(deal_lng, l.lng)
        INTO deal_city_id, deal_region_id, deal_lat, deal_lng
        FROM public.locations l
        LEFT JOIN public.cities c ON c.id = l.city_id
        WHERE l.id = NEW.location_id;
    END IF;

    -- Geo last-resort: nearest SA city from lat/lng.
    IF (deal_region_id IS NULL OR deal_city_id IS NULL)
       AND deal_lat IS NOT NULL AND deal_lng IS NOT NULL
    THEN
        SELECT * INTO nearest_row FROM public.find_nearest_sa_city(deal_lat, deal_lng);
        IF nearest_row.city_id IS NOT NULL THEN
            deal_region_id := COALESCE(deal_region_id, nearest_row.region_id);
            deal_city_id   := COALESCE(deal_city_id,   nearest_row.city_id);
        END IF;
    END IF;

    FOR rec IN
        SELECT id, smart_alerts, followed_merchants
        FROM public.users
        WHERE id <> NEW.store_id
    LOOP
        PERFORM public.taki_dispatch_smart_alert(
            rec.id,
            rec.followed_merchants,
            rec.smart_alerts,
            NEW,
            deal_region_id, deal_city_id,
            deal_lat, deal_lng,
            FALSE  -- live insert → don't dedupe (no prior row exists yet)
        );
    END LOOP;

    RETURN NEW;
END;
$$;

-- Step 5 — Backfill trigger. Fires when a user adds OR edits a rule
-- (detected via deep JSONB equality scan). Replays the dispatch against
-- recent active deals.
CREATE OR REPLACE FUNCTION public.handle_smart_alerts_backfill()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
    deal_rec        public.deals;
    deal_region_id  TEXT;
    deal_city_id    TEXT;
    deal_lat        DOUBLE PRECISION;
    deal_lng        DOUBLE PRECISION;
    nearest_row     public.sa_cities_geo;
    has_new_rules   BOOLEAN;
    cutoff_ms       BIGINT;
BEGIN
    IF NEW.smart_alerts IS NULL
       OR jsonb_typeof(NEW.smart_alerts) <> 'array'
       OR jsonb_array_length(NEW.smart_alerts) = 0
    THEN
        RETURN NEW;
    END IF;

    -- Only backfill if at least one rule in NEW is NOT in OLD (added or edited).
    -- Pure removals don't need a replay.
    SELECT EXISTS (
        SELECT 1 FROM jsonb_array_elements(NEW.smart_alerts) AS new_rule
        WHERE NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(COALESCE(OLD.smart_alerts, '[]'::jsonb)) AS old_rule
            WHERE old_rule = new_rule
        )
    ) INTO has_new_rules;
    IF NOT has_new_rules THEN
        RETURN NEW;
    END IF;

    -- deals.created_at is stored as BIGINT epoch-milliseconds (NOT timestamptz),
    -- so we compute the cutoff in ms once and do an integer-to-integer compare.
    cutoff_ms := (EXTRACT(EPOCH FROM (NOW() - INTERVAL '7 days')) * 1000)::BIGINT;

    -- Scan active deals from the last 7 days, newest first. Cap at 200 so
    -- a single profile edit can't fan out into thousands of inserts.
    FOR deal_rec IN
        SELECT * FROM public.deals
        WHERE status = 'active'
          AND created_at > cutoff_ms
          AND store_id <> NEW.id
        ORDER BY created_at DESC
        LIMIT 200
    LOOP
        deal_region_id := deal_rec.region;
        deal_city_id   := deal_rec.city;
        deal_lat       := deal_rec.map_lat;
        deal_lng       := deal_rec.map_lng;

        IF deal_region_id IS NULL OR deal_city_id IS NULL THEN
            SELECT l.city_id, c.region_id,
                   COALESCE(deal_lat, l.lat),
                   COALESCE(deal_lng, l.lng)
            INTO deal_city_id, deal_region_id, deal_lat, deal_lng
            FROM public.locations l
            LEFT JOIN public.cities c ON c.id = l.city_id
            WHERE l.id = deal_rec.location_id;
        END IF;
        IF (deal_region_id IS NULL OR deal_city_id IS NULL)
           AND deal_lat IS NOT NULL AND deal_lng IS NOT NULL
        THEN
            SELECT * INTO nearest_row FROM public.find_nearest_sa_city(deal_lat, deal_lng);
            IF nearest_row.city_id IS NOT NULL THEN
                deal_region_id := COALESCE(deal_region_id, nearest_row.region_id);
                deal_city_id   := COALESCE(deal_city_id,   nearest_row.city_id);
            END IF;
        END IF;

        PERFORM public.taki_dispatch_smart_alert(
            NEW.id,
            NEW.followed_merchants,
            NEW.smart_alerts,
            deal_rec,
            deal_region_id, deal_city_id,
            deal_lat, deal_lng,
            TRUE  -- dedupe against existing notifications
        );
    END LOOP;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_smart_alerts_backfill ON public.users;
CREATE TRIGGER tr_smart_alerts_backfill
AFTER UPDATE OF smart_alerts ON public.users
FOR EACH ROW
WHEN (OLD.smart_alerts IS DISTINCT FROM NEW.smart_alerts)
EXECUTE FUNCTION public.handle_smart_alerts_backfill();
