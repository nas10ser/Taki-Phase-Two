-- ================================================================
-- TAKI Migration v8.11 — Server-Side Smart Notifications Engine
-- ================================================================
--
-- Goals:
--   1. ALL smart notifications (followed merchant alerts, keyword
--      matching, city/region matching) fire from the DATABASE when
--      a new deal is inserted, NOT from the client. This ensures
--      every buyer who has a matching alert preference receives
--      the notification instantly — even if their browser tab is
--      closed, or they are on a different device.
--
--   2. This mirrors how booking notifications already work via
--      tr_booking_notification: the client just writes the deal
--      row and the server handles all notification fanout.
--
-- Safe to re-run (idempotent: DROP/REPLACE functions, DROP/recreate
-- triggers).
-- ================================================================

-- ====================== 1. DEAL SMART NOTIFICATION FUNCTION ======================
-- Fires AFTER INSERT on deals table.
-- For each new active deal:
--   a) Find all users who follow this merchant → send "new deal" notification
--   b) Find all users whose notif_keywords match → send "smart alert" notification
-- Uses SECURITY DEFINER to bypass RLS when inserting notifications.

CREATE OR REPLACE FUNCTION public.handle_deal_smart_notifications()
RETURNS TRIGGER AS $$
DECLARE
    follower RECORD;
    keyword_user RECORD;
    kw TEXT;
    kw_parts TEXT[];
    match_found BOOLEAN;
    deal_text TEXT;
    city_from_location TEXT;
    kw_part TEXT;
BEGIN
    -- Only process active deals
    IF NEW.status <> 'active' THEN
        RETURN NEW;
    END IF;

    -- Build searchable text from the deal
    deal_text := LOWER(COALESCE(NEW.item_name, '') || ' ' || COALESCE(NEW.shop_name, '') || ' ' || COALESCE(NEW.category, '') || ' ' || COALESCE(NEW.description, ''));

    -- ─── A) FOLLOWER NOTIFICATIONS ───
    -- Find all buyers who have this merchant in their followed_merchants array
    FOR follower IN
        SELECT id, name FROM public.users
        WHERE id <> NEW.store_id
          AND followed_merchants @> ARRAY[NEW.store_id]
    LOOP
        INSERT INTO public.notifications (
            user_id, title_ar, title_en, body_ar, body_en,
            type, meta_data, created_at
        ) VALUES (
            follower.id,
            '🔥 عرض جديد من ' || COALESCE(NEW.shop_name, 'متجرك المفضل'),
            '🔥 New Deal from ' || COALESCE(NEW.shop_name, 'Your Favorite Store'),
            'قام ' || COALESCE(NEW.shop_name, 'المتجر') || ' بنشر: ' || COALESCE(NEW.item_name, 'عرض جديد') || ' بخصم ' || COALESCE(NEW.discount_percentage::TEXT, '?') || '%',
            COALESCE(NEW.shop_name, 'Store') || ' posted: ' || COALESCE(NEW.item_name, 'New deal') || ' at ' || COALESCE(NEW.discount_percentage::TEXT, '?') || '% off',
            'deal',
            jsonb_build_object('dealId', NEW.id),
            NOW()
        );
    END LOOP;

    -- ─── B) KEYWORD / SMART ALERT MATCHING ───
    -- Find all users who have notif_keywords set (non-empty array)
    -- and are NOT the deal creator
    FOR keyword_user IN
        SELECT id, notif_keywords FROM public.users
        WHERE id <> NEW.store_id
          AND notif_keywords IS NOT NULL
          AND array_length(notif_keywords, 1) > 0
          -- Exclude users already notified as followers to avoid duplicates
          AND NOT (followed_merchants @> ARRAY[NEW.store_id])
    LOOP
        -- Check each keyword entry for a match
        FOREACH kw IN ARRAY keyword_user.notif_keywords
        LOOP
            match_found := FALSE;
            -- Split by ' | ' delimiter
            kw_parts := string_to_array(kw, ' | ');

            -- Check each part of the keyword entry
            FOREACH kw_part IN ARRAY kw_parts
            LOOP
                -- Skip metadata markers (COORDS:, CITY_ID:, km suffixes)
                IF kw_part LIKE 'COORDS:%' OR kw_part LIKE '%km' THEN
                    CONTINUE;
                END IF;

                -- City ID matching
                IF kw_part LIKE 'CITY_ID:%' THEN
                    -- Extract city ID and check if the deal's location belongs to that city
                    -- This requires checking against the location_id pattern
                    -- Since location data is client-side, we do a simple prefix match
                    DECLARE
                        target_city_id TEXT;
                    BEGIN
                        target_city_id := REPLACE(kw_part, 'CITY_ID:', '');
                        -- location_id often contains the city as prefix (e.g., riyadh_mall_1)
                        IF NEW.location_id IS NOT NULL AND NEW.location_id LIKE target_city_id || '%' THEN
                            match_found := TRUE;
                        END IF;
                    END;
                    CONTINUE;
                END IF;

                -- Text/keyword matching — case-insensitive substring search
                IF LENGTH(kw_part) > 0 AND deal_text LIKE '%' || LOWER(kw_part) || '%' THEN
                    match_found := TRUE;
                END IF;
            END LOOP;

            -- If any keyword entry matched, send notification and stop
            IF match_found THEN
                INSERT INTO public.notifications (
                    user_id, title_ar, title_en, body_ar, body_en,
                    type, meta_data, created_at
                ) VALUES (
                    keyword_user.id,
                    '🎯 وجدنا طلباً يطابق اهتمامك!',
                    '🎯 Found a match for your alert!',
                    'يتوفر الآن: ' || COALESCE(NEW.item_name, 'عرض جديد') || ' في ' || COALESCE(NEW.shop_name, 'متجر') || ' بخصم ' || COALESCE(NEW.discount_percentage::TEXT, '?') || '%',
                    'Now available: ' || COALESCE(NEW.item_name, 'New deal') || ' at ' || COALESCE(NEW.shop_name, 'Store') || ' — ' || COALESCE(NEW.discount_percentage::TEXT, '?') || '% off',
                    'marketing',
                    jsonb_build_object('dealId', NEW.id, 'matchedKeyword', kw),
                    NOW()
                );
                EXIT; -- One notification per user per deal is enough
            END IF;
        END LOOP;
    END LOOP;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ====================== 2. CREATE THE TRIGGER ======================
DROP TRIGGER IF EXISTS tr_deal_smart_notifications ON public.deals;
CREATE TRIGGER tr_deal_smart_notifications
AFTER INSERT ON public.deals
FOR EACH ROW
EXECUTE FUNCTION public.handle_deal_smart_notifications();

-- ====================== 3. VERIFICATION ======================
-- After running, confirm:
--   SELECT tgname FROM pg_trigger
--      WHERE tgrelid = 'public.deals'::regclass
--      AND tgname = 'tr_deal_smart_notifications';
--   → one row present
--
-- Test: Insert a deal where a user follows the store_id.
-- Check: SELECT * FROM notifications ORDER BY created_at DESC LIMIT 5;
-- → should see follower and/or keyword match notifications

DO $$
BEGIN
    RAISE NOTICE '✅ Server-side smart deal notifications enabled via tr_deal_smart_notifications';
END $$;
