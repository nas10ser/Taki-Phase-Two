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
DROP POLICY IF EXISTS "promo_select_all" ON promotional_campaigns;
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
RETURNS INTEGER AS $BODY$
DECLARE
    affected INTEGER := 0;
    campaign_exists BOOLEAN;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Only admins can broadcast campaigns';
    END IF;

    SELECT EXISTS(SELECT 1 FROM public.promotional_campaigns WHERE id = p_campaign_id)
        INTO campaign_exists;
    IF NOT campaign_exists THEN
        RAISE EXCEPTION 'Campaign % not found', p_campaign_id;
    END IF;

    INSERT INTO public.notifications (
        user_id, title_ar, title_en, body_ar, body_en, type, meta_data, created_at
    )
    SELECT
        u.id,
        pc.title_ar, pc.title_en, pc.body_ar, pc.body_en,
        'marketing',
        jsonb_build_object(
            'campaignId', pc.id,
            'imageUrl', pc.image_url,
            'actionUrl', pc.action_url,
            'actionLabelAr', pc.action_label_ar,
            'actionLabelEn', pc.action_label_en
        ),
        NOW()
    FROM public.promotional_campaigns pc
    CROSS JOIN public.users u
    WHERE pc.id = p_campaign_id
      AND (pc.target_audience = 'all' OR u.user_type = pc.target_audience)
      AND NOT EXISTS (
          SELECT 1 FROM public.promo_impressions pi
          WHERE pi.campaign_id = pc.id AND pi.user_id = u.id
      );

    GET DIAGNOSTICS affected = ROW_COUNT;

    INSERT INTO public.promo_impressions (campaign_id, user_id, seen_at, clicked)
    SELECT pc.id, u.id, NOW(), FALSE
    FROM public.promotional_campaigns pc
    CROSS JOIN public.users u
    WHERE pc.id = p_campaign_id
      AND (pc.target_audience = 'all' OR u.user_type = pc.target_audience)
    ON CONFLICT (campaign_id, user_id) DO NOTHING;

    UPDATE public.promotional_campaigns
       SET current_impressions = COALESCE(current_impressions, 0) + affected
     WHERE id = p_campaign_id;

    RETURN affected;
END;
$BODY$ LANGUAGE plpgsql SECURITY DEFINER;

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
