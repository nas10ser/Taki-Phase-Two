-- ================================================================
-- TAKI Migration v8.13 — Smart Alerts v2 + Push Subscriptions
-- ================================================================
-- 1. Replaces the pipe-string `notif_keywords` model with a
--    structured `smart_alerts JSONB[]` column. Each rule is a
--    JSON object combining any of: regions, cities, malls,
--    categories, keywords, coords+radiusKm. A rule matches a deal
--    only when ALL provided criteria hold (conjunctive). The user
--    can stack many rules.
--
-- 2. The trigger sends ONE notification per (user, deal) — even
--    when the user follows the merchant AND the deal also matches
--    one or more smart-alert rules. The body lists all reasons.
--
-- 3. Adds `push_subscriptions` table for Web Push endpoints, plus
--    server-side `regions` / `cities` / `locations` reference
--    tables so the trigger can resolve a deal's region/city/coords
--    without trusting the client.
--
-- Safe to re-run.
-- ================================================================

-- ─── 1. New columns ──────────────────────────────────────────────
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS smart_alerts JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS preferred_lang TEXT DEFAULT 'ar' CHECK (preferred_lang IN ('ar','en'));
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS last_promo_check_at TIMESTAMPTZ;

-- ─── 2. Server-side geo reference tables ─────────────────────────
CREATE TABLE IF NOT EXISTS public.regions (
    id   TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    lat  DOUBLE PRECISION,
    lng  DOUBLE PRECISION
);

CREATE TABLE IF NOT EXISTS public.cities (
    id        TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
    region_id TEXT REFERENCES public.regions(id) ON DELETE SET NULL,
    lat       DOUBLE PRECISION,
    lng       DOUBLE PRECISION
);
CREATE INDEX IF NOT EXISTS idx_cities_region ON public.cities(region_id);

CREATE TABLE IF NOT EXISTS public.locations (
    id      TEXT PRIMARY KEY,
    name    TEXT NOT NULL,
    type    TEXT,
    city_id TEXT REFERENCES public.cities(id) ON DELETE SET NULL,
    lat     DOUBLE PRECISION,
    lng     DOUBLE PRECISION
);
CREATE INDEX IF NOT EXISTS idx_locations_city ON public.locations(city_id);

ALTER TABLE public.regions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cities    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "regions_read_all"   ON public.regions;
DROP POLICY IF EXISTS "cities_read_all"    ON public.cities;
DROP POLICY IF EXISTS "locations_read_all" ON public.locations;
CREATE POLICY "regions_read_all"   ON public.regions   FOR SELECT USING (TRUE);
CREATE POLICY "cities_read_all"    ON public.cities    FOR SELECT USING (TRUE);
CREATE POLICY "locations_read_all" ON public.locations FOR SELECT USING (TRUE);

-- ─── 3. Push Subscriptions ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
    id           BIGSERIAL PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    endpoint     TEXT NOT NULL UNIQUE,
    p256dh       TEXT NOT NULL,
    auth         TEXT NOT NULL,
    user_agent   TEXT,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    last_used_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_push_subs_user ON public.push_subscriptions(user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "push_subs_self_select" ON public.push_subscriptions;
DROP POLICY IF EXISTS "push_subs_self_insert" ON public.push_subscriptions;
DROP POLICY IF EXISTS "push_subs_self_update" ON public.push_subscriptions;
DROP POLICY IF EXISTS "push_subs_self_delete" ON public.push_subscriptions;
CREATE POLICY "push_subs_self_select" ON public.push_subscriptions
    FOR SELECT USING (auth.uid()::text = user_id);
CREATE POLICY "push_subs_self_insert" ON public.push_subscriptions
    FOR INSERT WITH CHECK (auth.uid()::text = user_id);
CREATE POLICY "push_subs_self_update" ON public.push_subscriptions
    FOR UPDATE USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);
CREATE POLICY "push_subs_self_delete" ON public.push_subscriptions
    FOR DELETE USING (auth.uid()::text = user_id);

-- ─── 4. Distance helper ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.taki_haversine_km(
    lat1 DOUBLE PRECISION, lng1 DOUBLE PRECISION,
    lat2 DOUBLE PRECISION, lng2 DOUBLE PRECISION
) RETURNS DOUBLE PRECISION AS $$
DECLARE
    p CONSTANT DOUBLE PRECISION := 0.017453292519943295;
    a DOUBLE PRECISION;
BEGIN
    IF lat1 IS NULL OR lng1 IS NULL OR lat2 IS NULL OR lng2 IS NULL THEN
        RETURN NULL;
    END IF;
    a := 0.5
       - cos((lat2 - lat1) * p) / 2
       + cos(lat1 * p) * cos(lat2 * p) * (1 - cos((lng2 - lng1) * p)) / 2;
    RETURN 2 * 6371.0 * asin(sqrt(a));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ─── 5. Smart-Alert Trigger v2 ──────────────────────────────────
-- Replaces the v8.11 implementation. Conjunctive matching per
-- rule; one combined notification per user; dedup against
-- follower-only path so a follower who also has a matching alert
-- still gets a single, richer entry.

CREATE OR REPLACE FUNCTION public.handle_deal_smart_notifications()
RETURNS TRIGGER AS $$
DECLARE
    deal_text       TEXT;
    deal_city_id    TEXT;
    deal_region_id  TEXT;
    deal_lat        DOUBLE PRECISION;
    deal_lng        DOUBLE PRECISION;
    rec             RECORD;
    rule            JSONB;
    rule_idx        INT;
    is_follower     BOOLEAN;
    rule_matched    BOOLEAN;
    matched_reasons TEXT[];
    distance_km     DOUBLE PRECISION;
    title_ar        TEXT;
    title_en        TEXT;
    body_ar         TEXT;
    body_en         TEXT;
BEGIN
    IF NEW.status <> 'active' THEN
        RETURN NEW;
    END IF;

    deal_text := LOWER(
        COALESCE(NEW.item_name, '')   || ' ' ||
        COALESCE(NEW.shop_name, '')   || ' ' ||
        COALESCE(NEW.category, '')    || ' ' ||
        COALESCE(NEW.description, '')
    );

    -- Resolve the deal's region/city/coords from the canonical
    -- locations + cities tables. Falls back to deal.map_lat/lng
    -- if the location_id isn't seeded yet.
    SELECT l.city_id, c.region_id,
           COALESCE(NEW.map_lat, l.lat) AS lat,
           COALESCE(NEW.map_lng, l.lng) AS lng
    INTO deal_city_id, deal_region_id, deal_lat, deal_lng
    FROM public.locations l
    LEFT JOIN public.cities c ON c.id = l.city_id
    WHERE l.id = NEW.location_id;

    IF NOT FOUND THEN
        deal_lat       := NEW.map_lat;
        deal_lng       := NEW.map_lng;
        deal_city_id   := NULL;
        deal_region_id := NULL;
    END IF;

    FOR rec IN
        SELECT id, smart_alerts, followed_merchants
        FROM public.users
        WHERE id <> NEW.store_id
    LOOP
        is_follower := rec.followed_merchants IS NOT NULL
                       AND NEW.store_id = ANY(rec.followed_merchants);

        rule_matched    := FALSE;
        matched_reasons := ARRAY[]::TEXT[];

        IF rec.smart_alerts IS NOT NULL
           AND jsonb_typeof(rec.smart_alerts) = 'array'
           AND jsonb_array_length(rec.smart_alerts) > 0
        THEN
            FOR rule_idx IN 0 .. (jsonb_array_length(rec.smart_alerts) - 1) LOOP
                rule := rec.smart_alerts -> rule_idx;
                DECLARE
                    ok          BOOLEAN := TRUE;
                    rule_parts  TEXT[]  := ARRAY[]::TEXT[];
                    kw_ok       BOOLEAN;
                    kw          TEXT;
                    i           INT;
                BEGIN
                    -- regions (any-of)
                    IF rule ? 'regions' AND jsonb_array_length(rule->'regions') > 0 THEN
                        IF deal_region_id IS NULL OR NOT (rule->'regions' ? deal_region_id) THEN
                            ok := FALSE;
                        ELSE
                            rule_parts := rule_parts || 'منطقتك';
                        END IF;
                    END IF;

                    -- cities (any-of)
                    IF ok AND rule ? 'cities' AND jsonb_array_length(rule->'cities') > 0 THEN
                        IF deal_city_id IS NULL OR NOT (rule->'cities' ? deal_city_id) THEN
                            ok := FALSE;
                        ELSE
                            rule_parts := rule_parts || 'مدينتك';
                        END IF;
                    END IF;

                    -- malls / location ids (any-of)
                    IF ok AND rule ? 'malls' AND jsonb_array_length(rule->'malls') > 0 THEN
                        IF NEW.location_id IS NULL OR NOT (rule->'malls' ? NEW.location_id) THEN
                            ok := FALSE;
                        ELSE
                            rule_parts := rule_parts || 'مولك المفضل';
                        END IF;
                    END IF;

                    -- categories (any-of, supports multi-select)
                    IF ok AND rule ? 'categories' AND jsonb_array_length(rule->'categories') > 0 THEN
                        IF NEW.category IS NULL OR NOT (rule->'categories' ? NEW.category) THEN
                            ok := FALSE;
                        ELSE
                            rule_parts := rule_parts || 'تصنيفك';
                        END IF;
                    END IF;

                    -- keywords (any-of substring)
                    IF ok AND rule ? 'keywords' AND jsonb_array_length(rule->'keywords') > 0 THEN
                        kw_ok := FALSE;
                        FOR i IN 0 .. (jsonb_array_length(rule->'keywords') - 1) LOOP
                            kw := lower(rule->'keywords'->>i);
                            IF length(kw) > 0 AND deal_text LIKE '%' || kw || '%' THEN
                                kw_ok := TRUE;
                                EXIT;
                            END IF;
                        END LOOP;
                        IF NOT kw_ok THEN
                            ok := FALSE;
                        ELSE
                            rule_parts := rule_parts || 'كلماتك المفتاحية';
                        END IF;
                    END IF;

                    -- coords + radiusKm (geofence)
                    IF ok
                       AND rule ? 'coords'
                       AND rule->'coords' ? 'lat'
                       AND rule->'coords' ? 'lng'
                       AND rule ? 'radiusKm'
                    THEN
                        distance_km := public.taki_haversine_km(
                            (rule->'coords'->>'lat')::DOUBLE PRECISION,
                            (rule->'coords'->>'lng')::DOUBLE PRECISION,
                            deal_lat, deal_lng
                        );
                        IF distance_km IS NULL
                           OR distance_km > (rule->>'radiusKm')::DOUBLE PRECISION
                        THEN
                            ok := FALSE;
                        ELSE
                            rule_parts := rule_parts ||
                                ('على بعد ' || ROUND(distance_km::numeric, 1)::TEXT || ' كم منك');
                        END IF;
                    END IF;

                    -- A rule with no criteria at all is invalid
                    IF ok AND COALESCE(array_length(rule_parts, 1), 0) = 0 THEN
                        ok := FALSE;
                    END IF;

                    IF ok THEN
                        rule_matched    := TRUE;
                        matched_reasons := matched_reasons || rule_parts;
                    END IF;
                END;
            END LOOP;
        END IF;

        -- Skip users who match neither follow nor any rule
        IF NOT is_follower AND NOT rule_matched THEN
            CONTINUE;
        END IF;

        -- Dedup the reason list
        IF array_length(matched_reasons, 1) IS NOT NULL THEN
            SELECT array_agg(DISTINCT r) INTO matched_reasons
            FROM unnest(matched_reasons) AS r;
        END IF;

        -- Compose ONE notification combining follower + smart-alert reasons
        IF is_follower AND rule_matched THEN
            title_ar := '🔥 عرض جديد من ' || COALESCE(NEW.shop_name, 'متجر تتابعه') || ' يطابق تنبيهك';
            title_en := '🔥 New deal from ' || COALESCE(NEW.shop_name, 'a store you follow') || ' matches your alert';
            body_ar  := COALESCE(NEW.item_name, 'عرض جديد')
                     || ' بخصم ' || COALESCE(NEW.discount_percentage::TEXT, '?') || '% — '
                     || array_to_string(matched_reasons, ' • ');
            body_en  := COALESCE(NEW.item_name, 'New deal')
                     || ' at ' || COALESCE(NEW.discount_percentage::TEXT, '?') || '% off — '
                     || array_to_string(matched_reasons, ' • ');
        ELSIF is_follower THEN
            title_ar := '🔥 عرض جديد من ' || COALESCE(NEW.shop_name, 'متجرك المفضل');
            title_en := '🔥 New deal from ' || COALESCE(NEW.shop_name, 'your favorite store');
            body_ar  := COALESCE(NEW.item_name, 'عرض جديد')
                     || ' بخصم ' || COALESCE(NEW.discount_percentage::TEXT, '?') || '%';
            body_en  := COALESCE(NEW.item_name, 'New deal')
                     || ' at ' || COALESCE(NEW.discount_percentage::TEXT, '?') || '% off';
        ELSE
            title_ar := '🎯 يطابق تنبيهك الذكي';
            title_en := '🎯 Matches your smart alert';
            body_ar  := COALESCE(NEW.item_name, 'عرض جديد') || ' في '
                     || COALESCE(NEW.shop_name, 'متجر') || ' — '
                     || array_to_string(matched_reasons, ' • ');
            body_en  := COALESCE(NEW.item_name, 'New deal') || ' at '
                     || COALESCE(NEW.shop_name, 'a store') || ' — '
                     || array_to_string(matched_reasons, ' • ');
        END IF;

        INSERT INTO public.notifications
            (user_id, title_ar, title_en, body_ar, body_en, type, meta_data, created_at)
        VALUES
            (rec.id, title_ar, title_en, body_ar, body_en,
             CASE WHEN is_follower THEN 'deal' ELSE 'marketing' END,
             jsonb_build_object(
                 'dealId',   NEW.id,
                 'reasons',  matched_reasons,
                 'follower', is_follower
             ),
             NOW());
    END LOOP;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tr_deal_smart_notifications ON public.deals;
CREATE TRIGGER tr_deal_smart_notifications
AFTER INSERT ON public.deals
FOR EACH ROW EXECUTE FUNCTION public.handle_deal_smart_notifications();

-- ─── 6. Push fan-out hook (best-effort) ─────────────────────────
-- When a notification is inserted, fire a POST to a Web Push edge
-- function configured via the `taki.push_url` GUC. The edge
-- function reads push_subscriptions for the user and sends the
-- payload through web-push.  pg_net must be enabled (it is by
-- default on Supabase). If the GUC is unset, this is a no-op so
-- the trigger never blocks notification inserts.

CREATE OR REPLACE FUNCTION public.handle_notification_push()
RETURNS TRIGGER AS $$
DECLARE
    push_url TEXT;
BEGIN
    BEGIN
        push_url := current_setting('taki.push_url', TRUE);
    EXCEPTION WHEN OTHERS THEN
        push_url := NULL;
    END;
    IF push_url IS NULL OR length(push_url) = 0 THEN
        RETURN NEW;
    END IF;

    BEGIN
        PERFORM net.http_post(
            url := push_url,
            body := jsonb_build_object(
                'userId',  NEW.user_id,
                'titleAr', NEW.title_ar,
                'titleEn', NEW.title_en,
                'bodyAr',  NEW.body_ar,
                'bodyEn',  NEW.body_en,
                'type',    NEW.type,
                'data',    NEW.meta_data,
                'notifId', NEW.id
            ),
            headers := jsonb_build_object('Content-Type', 'application/json')
        );
    EXCEPTION WHEN OTHERS THEN
        -- Never let a push failure abort the notification insert
        NULL;
    END;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tr_notification_push ON public.notifications;
CREATE TRIGGER tr_notification_push
AFTER INSERT ON public.notifications
FOR EACH ROW EXECUTE FUNCTION public.handle_notification_push();

-- ─── 7. One-shot migration of legacy notif_keywords pipe-strings ─
-- Convert each entry of the form:
--     "<region name> | <city name> | CITY_ID:<id> | <category name> | <kw> | <Xkm> | COORDS:<lat>,<lng>"
-- into a structured rule and append it to smart_alerts.
-- Idempotent: skipped for users whose smart_alerts is non-empty.

DO $$
DECLARE
    u RECORD;
    raw TEXT;
    parts TEXT[];
    part TEXT;
    rule JSONB;
    cities JSONB;
    keywords JSONB;
    coords JSONB;
    radius DOUBLE PRECISION;
    new_alerts JSONB;
BEGIN
    FOR u IN
        SELECT id, notif_keywords
        FROM public.users
        WHERE notif_keywords IS NOT NULL
          AND array_length(notif_keywords, 1) > 0
          AND (smart_alerts IS NULL OR jsonb_array_length(smart_alerts) = 0)
    LOOP
        new_alerts := '[]'::jsonb;
        FOREACH raw IN ARRAY u.notif_keywords LOOP
            parts    := string_to_array(raw, ' | ');
            cities   := '[]'::jsonb;
            keywords := '[]'::jsonb;
            coords   := NULL;
            radius   := NULL;

            FOREACH part IN ARRAY parts LOOP
                IF part LIKE 'CITY_ID:%' THEN
                    cities := cities || to_jsonb(replace(part, 'CITY_ID:', ''));
                ELSIF part LIKE 'COORDS:%' THEN
                    DECLARE
                        latlng TEXT[] := string_to_array(replace(part, 'COORDS:', ''), ',');
                    BEGIN
                        IF array_length(latlng, 1) = 2 THEN
                            coords := jsonb_build_object('lat', latlng[1]::DOUBLE PRECISION, 'lng', latlng[2]::DOUBLE PRECISION);
                        END IF;
                    END;
                ELSIF part ~ '^[0-9]+km$' THEN
                    radius := replace(part, 'km', '')::DOUBLE PRECISION;
                ELSIF length(trim(part)) > 0 THEN
                    keywords := keywords || to_jsonb(trim(part));
                END IF;
            END LOOP;

            rule := '{}'::jsonb;
            IF jsonb_array_length(cities)   > 0 THEN rule := rule || jsonb_build_object('cities', cities); END IF;
            IF jsonb_array_length(keywords) > 0 THEN rule := rule || jsonb_build_object('keywords', keywords); END IF;
            IF coords IS NOT NULL AND radius IS NOT NULL THEN
                rule := rule || jsonb_build_object('coords', coords, 'radiusKm', radius);
            END IF;

            IF rule <> '{}'::jsonb THEN
                new_alerts := new_alerts || jsonb_build_array(rule);
            END IF;
        END LOOP;

        IF jsonb_array_length(new_alerts) > 0 THEN
            UPDATE public.users SET smart_alerts = new_alerts WHERE id = u.id;
        END IF;
    END LOOP;
END $$;

-- ─── 8. Verification ────────────────────────────────────────────
DO $$ BEGIN
    RAISE NOTICE '✅ v8.13 applied: smart_alerts JSONB, push_subscriptions, geo tables, conjunctive matching trigger';
END $$;
