-- ================================================================
-- TAKI Migration v8.8 — Admin Role + Tightened Promo RLS
-- ================================================================
--
-- Goals:
--   1. Introduce a SQL helper `is_admin(uid)` that checks
--      users.user_type = 'admin' so RLS policies can use it.
--   2. Tighten promotional_campaigns RLS so ONLY admins can
--      INSERT/UPDATE/DELETE campaigns (previously any auth user).
--   3. Add a `broadcast_campaign(...)` SECURITY DEFINER function
--      that fan-outs an admin's campaign into individual
--      notification rows for every targeted user — used when the
--      admin clicks "Send Now" instead of waiting on the polling
--      delivery loop.
--
-- Safe to re-run (idempotent).
-- ================================================================

-- ====================== 1. is_admin() helper ======================
CREATE OR REPLACE FUNCTION public.is_admin(uid TEXT DEFAULT NULL)
RETURNS BOOLEAN AS $$
DECLARE
    target_uid TEXT;
    found BOOLEAN;
BEGIN
    target_uid := COALESCE(uid, auth.uid()::text);
    IF target_uid IS NULL THEN
        RETURN FALSE;
    END IF;
    SELECT EXISTS (
        SELECT 1 FROM public.users
        WHERE id = target_uid AND user_type = 'admin'
    ) INTO found;
    RETURN found;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ====================== 2. Tighten promo RLS ======================
DROP POLICY IF EXISTS "promo_select_active" ON promotional_campaigns;
DROP POLICY IF EXISTS "promo_insert_admin" ON promotional_campaigns;
DROP POLICY IF EXISTS "promo_update_admin" ON promotional_campaigns;
DROP POLICY IF EXISTS "promo_delete_admin" ON promotional_campaigns;

-- Anyone authenticated can READ (the client filters by audience).
CREATE POLICY "promo_select_all" ON promotional_campaigns
    FOR SELECT USING (true);

-- Only admins can WRITE.
CREATE POLICY "promo_insert_admin" ON promotional_campaigns
    FOR INSERT WITH CHECK (public.is_admin());

CREATE POLICY "promo_update_admin" ON promotional_campaigns
    FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "promo_delete_admin" ON promotional_campaigns
    FOR DELETE USING (public.is_admin());

-- ====================== 3. broadcast_campaign() ======================
-- Manually fan-out a campaign to every targeted user immediately.
-- Useful for "Send Now" — bypasses the per-user polling delay.
-- SECURITY DEFINER so the admin can write notifications for users
-- they don't own; we still gate on is_admin() inside.
CREATE OR REPLACE FUNCTION public.broadcast_campaign(p_campaign_id TEXT)
RETURNS INTEGER AS $$
DECLARE
    c RECORD;
    affected INTEGER := 0;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Only admins can broadcast campaigns';
    END IF;

    SELECT * INTO c FROM public.promotional_campaigns WHERE id = p_campaign_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Campaign % not found', p_campaign_id;
    END IF;

    -- Insert one notification row per targeted user. Skip users
    -- who already saw this campaign so a re-broadcast doesn't spam.
    INSERT INTO public.notifications (
        user_id, title_ar, title_en, body_ar, body_en, type, meta_data, created_at
    )
    SELECT
        u.id,
        c.title_ar, c.title_en, c.body_ar, c.body_en,
        'marketing',
        jsonb_build_object(
            'campaignId', c.id,
            'imageUrl', c.image_url,
            'actionUrl', c.action_url,
            'actionLabelAr', c.action_label_ar,
            'actionLabelEn', c.action_label_en
        ),
        NOW()
    FROM public.users u
    WHERE
        (c.target_audience = 'all' OR u.user_type = c.target_audience)
        AND NOT EXISTS (
            SELECT 1 FROM public.promo_impressions p
            WHERE p.campaign_id = c.id AND p.user_id = u.id
        );

    GET DIAGNOSTICS affected = ROW_COUNT;

    -- Mark all those users as having seen the campaign so they
    -- don't get a duplicate via the regular polling delivery loop.
    INSERT INTO public.promo_impressions (campaign_id, user_id, seen_at, clicked)
    SELECT c.id, u.id, NOW(), FALSE
    FROM public.users u
    WHERE
        (c.target_audience = 'all' OR u.user_type = c.target_audience)
    ON CONFLICT (campaign_id, user_id) DO NOTHING;

    UPDATE public.promotional_campaigns
       SET current_impressions = COALESCE(current_impressions, 0) + affected
     WHERE id = c.id;

    RETURN affected;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.broadcast_campaign(TEXT) TO authenticated;

-- ====================== 4. (Optional) Promote first admin ======================
-- TAKI starts with no admin. Pick ONE existing user to promote and run:
--
--   UPDATE public.users SET user_type = 'admin' WHERE phone = '+9665XXXXXXXX';
--
-- Or, if you signed up with email:
--   UPDATE public.users SET user_type = 'admin' WHERE email = 'you@example.com';
--
-- Verify:
--   SELECT id, name, phone, email, user_type FROM public.users WHERE user_type = 'admin';
