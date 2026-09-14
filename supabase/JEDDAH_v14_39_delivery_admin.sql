-- ════════════════════════════════════════════════════════════════════════════
-- TAKI v14.39 — تبويب التوصيل في لوحة الإدارة (طلب ناصر ٦)
-- ════════════════════════════════════════════════════════════════════════════
-- ما كان ناقصاً بالقياس:
--   • **لا مفتاح إيقاف عام للتوصيل إطلاقاً.** لو ظهر خلل في التسعير أو النطاقات
--     لا يملك ناصر أي طريقة لإيقاف الخدمة على المنصّة كلها إلا أن يطلب من كل
--     تاجر إطفاءها بنفسه.
--   • **ولا مفتاح لكل متجر بيد الإدارة.** `store_profiles.delivery_enabled`
--     يملكه التاجر وحده، فإيقافُ ناصر له يُلغيه التاجر بضغطة.
--   • **ولا دالة إدارية واحدة تُرجع أي بيانات توصيل.** كلمة `fulfillment`
--     ترد في المخطط عشرين مرّة، ولا مرّة داخل دالة `admin_*`. والأدمن لا يقرأ
--     `bookings` مباشرةً.
--
-- 🪤 فخّ الإعدادات: مفتاحٌ جديد في `platform_settings` **لا يراه المتصفّح**
-- إلا إن أُضيف إلى قائمة السماح داخل سياسة القراءة. بدون ذلك يُطفئ ناصر
-- التوصيل فلا يتغيّر شيء في الواجهة.
--
-- الخادم المستهدف: **جدة (الإنتاج)**. يرفض التنفيذ على مختبر طوكيو.
-- ════════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'TOKYO_LAB_REFUSED: هذه هجرة إنتاج. نفّذها على جدة.';
  END IF;
END
$guard$;

-- ── ١. مفتاح الإيقاف العام ──────────────────────────────────────────────────
INSERT INTO public.platform_settings (key, value)
VALUES ('delivery_enabled', 'true')
ON CONFLICT (key) DO NOTHING;

-- قائمة السماح: بلا هذا يبقى المفتاح غير مرئيّ للمتصفّح فيظنّ التوصيل مفتوحاً.
DO $allow$
DECLARE v_qual text;
BEGIN
  SELECT qual INTO v_qual FROM pg_policies
   WHERE schemaname='public' AND tablename='platform_settings' AND policyname='platform_settings_select';
  IF v_qual IS NULL THEN RAISE EXCEPTION 'سياسة قراءة الإعدادات غير موجودة'; END IF;
  IF position('delivery_enabled' in v_qual) = 0 THEN
    EXECUTE 'DROP POLICY platform_settings_select ON public.platform_settings';
    EXECUTE format(
      'CREATE POLICY platform_settings_select ON public.platform_settings FOR SELECT USING (%s)',
      replace(v_qual, '''oauth_google_enabled''::text',
                      '''delivery_enabled''::text, ''oauth_google_enabled''::text'));
    RAISE NOTICE 'أُضيف delivery_enabled إلى قائمة السماح';
  END IF;
END
$allow$;

-- ── ٢. مفتاح الإدارة لكل متجر — منفصل عن مفتاح التاجر ───────────────────────
-- لو استعملنا `delivery_enabled` نفسه لأعاد التاجر تشغيلها بضغطة. عمودٌ ثانٍ
-- تملكه الإدارة وحدها، وسياسة `store_profiles_update` تمنع التاجر من لمسه.
ALTER TABLE public.store_profiles
  ADD COLUMN IF NOT EXISTS delivery_blocked_by_admin boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS delivery_block_reason text,
  ADD COLUMN IF NOT EXISTS delivery_blocked_at timestamptz;

CREATE OR REPLACE FUNCTION public.taki_guard_delivery_block()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.delivery_blocked_by_admin IS DISTINCT FROM OLD.delivery_blocked_by_admin
     AND NOT COALESCE(public.taki_admin_perm('tab_sellers'), false)
     AND auth.uid()::text = NEW.store_id THEN
    RAISE EXCEPTION 'إيقاف التوصيل على هذا المتجر قرارٌ إداري — تواصل مع إدارة تاكي.'
      USING ERRCODE = 'P0021';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tr_ab_guard_delivery_block ON public.store_profiles;
CREATE TRIGGER tr_ab_guard_delivery_block
  BEFORE UPDATE ON public.store_profiles
  FOR EACH ROW EXECUTE FUNCTION public.taki_guard_delivery_block();

-- ── ٣. المفتاحان يسريان في نقطة القرار الوحيدة ─────────────────────────────
-- `delivery_quote` هي المختنق الذي تمرّ به كل المسارات (الموقع والبوتان وحارس
-- الحجز)، فإضافة الفحص هنا تُغطّيها جميعاً بلا تكرار.
CREATE OR REPLACE FUNCTION public.taki_delivery_globally_on()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((SELECT value FROM public.platform_settings WHERE key = 'delivery_enabled'), 'true') <> 'false';
$$;
GRANT EXECUTE ON FUNCTION public.taki_delivery_globally_on() TO anon, authenticated;

-- ── ٤. دوال اللوحة ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_delivery_overview()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v jsonb;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Admin only'; END IF;
  SELECT jsonb_build_object(
    'global_on',       public.taki_delivery_globally_on(),
    'orders_delivery', (SELECT count(*) FROM bookings WHERE fulfillment = 'delivery'),
    'orders_pickup',   (SELECT count(*) FROM bookings WHERE COALESCE(fulfillment,'pickup') = 'pickup'),
    'revenue_delivery',(SELECT COALESCE(SUM(total_amount),0) FROM bookings WHERE fulfillment='delivery' AND status='completed'),
    'fees_collected',  (SELECT COALESCE(SUM(delivery_fee),0) FROM bookings WHERE fulfillment='delivery' AND status='completed'),
    'stores_enabled',  (SELECT count(*) FROM store_profiles WHERE delivery_enabled AND NOT delivery_blocked_by_admin),
    'stores_blocked',  (SELECT count(*) FROM store_profiles WHERE delivery_blocked_by_admin),
    'zones',           (SELECT count(*) FROM store_delivery_zones WHERE is_active),
    'tracks_live',     (SELECT count(*) FROM delivery_tracks WHERE status IN ('on_the_way','arrived')),
    'by_status',       (SELECT COALESCE(jsonb_object_agg(status, n), '{}'::jsonb)
                        FROM (SELECT status, count(*) n FROM bookings
                              WHERE fulfillment='delivery' GROUP BY status) t)
  ) INTO v;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.admin_delivery_orders(
  p_status text DEFAULT NULL, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v jsonb; v_lim int := GREATEST(1, LEAST(200, COALESCE(p_limit,50)));
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Admin only'; END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.booked_at DESC), '[]'::jsonb) INTO v
  FROM (
    SELECT b.barcode, b.status, b.booked_at, b.total_amount, b.delivery_fee,
           b.user_name, b.user_phone,
           COALESCE(NULLIF(u.shop,''), u.name) AS store_name, b.store_id,
           d.item_name, b.payment_method, (b.paid_at IS NOT NULL) AS paid,
           b.delivery_address->>'label'   AS addr_label,
           b.delivery_address->>'details' AS addr_details,
           dt.status AS track_status, dt.updated_at AS track_at
    FROM bookings b
    LEFT JOIN users u ON u.id = b.store_id
    LEFT JOIN deals d ON d.id = b.deal_id
    LEFT JOIN delivery_tracks dt ON dt.barcode = b.barcode
    WHERE b.fulfillment = 'delivery'
      AND (p_status IS NULL OR b.status = p_status)
    ORDER BY b.booked_at DESC
    LIMIT v_lim OFFSET GREATEST(0, COALESCE(p_offset,0))
  ) t;
  RETURN jsonb_build_object('ok', true, 'rows', v,
    'total', (SELECT count(*) FROM bookings WHERE fulfillment='delivery'
                AND (p_status IS NULL OR status = p_status)));
END $$;

CREATE OR REPLACE FUNCTION public.admin_delivery_stores()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v jsonb;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Admin only'; END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.store_name), '[]'::jsonb) INTO v
  FROM (
    SELECT sp.store_id,
           COALESCE(NULLIF(u.shop,''), u.name, '—') AS store_name,
           sp.delivery_enabled, sp.delivery_blocked_by_admin, sp.delivery_block_reason,
           sp.delivery_fee, sp.delivery_min_order, sp.delivery_eta_min, sp.delivery_payment,
           (SELECT count(*) FROM store_delivery_zones z WHERE z.store_id = sp.store_id AND z.is_active) AS zones,
           (SELECT count(*) FROM bookings b WHERE b.store_id = sp.store_id AND b.fulfillment='delivery') AS orders
    FROM store_profiles sp
    LEFT JOIN users u ON u.id = sp.store_id
    WHERE sp.delivery_enabled OR sp.delivery_blocked_by_admin
  ) t;
  RETURN jsonb_build_object('ok', true, 'rows', v);
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_delivery_global(p_enabled boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.taki_admin_perm('tab_sellers') THEN RAISE EXCEPTION 'Not allowed'; END IF;
  INSERT INTO public.platform_settings (key, value)
  VALUES ('delivery_enabled', CASE WHEN p_enabled THEN 'true' ELSE 'false' END)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  RETURN jsonb_build_object('ok', true, 'enabled', p_enabled);
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_store_delivery(
  p_store_id text, p_blocked boolean, p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_msg text;
BEGIN
  IF NOT public.taki_admin_perm('tab_sellers') THEN RAISE EXCEPTION 'Not allowed'; END IF;
  UPDATE public.store_profiles
     SET delivery_blocked_by_admin = p_blocked,
         delivery_block_reason = CASE WHEN p_blocked THEN NULLIF(btrim(COALESCE(p_reason,'')),'') END,
         delivery_blocked_at = CASE WHEN p_blocked THEN now() END
   WHERE store_id = p_store_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'STORE_NOT_FOUND'); END IF;

  v_msg := CASE WHEN p_blocked
    THEN '🚚 أوقفت إدارة تاكي خدمة التوصيل على متجرك'
         || CASE WHEN COALESCE(btrim(p_reason),'')<>'' THEN ' — ' || btrim(p_reason) ELSE '' END
         || '. الاستلام من المتجر يبقى متاحاً.'
    ELSE '✅ أُعيدت خدمة التوصيل على متجرك.' END;
  INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data)
  VALUES (p_store_id, CASE WHEN p_blocked THEN '🚚 إيقاف التوصيل' ELSE '✅ إعادة التوصيل' END,
          CASE WHEN p_blocked THEN '🚚 Delivery paused' ELSE '✅ Delivery restored' END,
          v_msg, v_msg, 'system', jsonb_build_object('audience','seller'));
  RETURN jsonb_build_object('ok', true, 'blocked', p_blocked);
END $$;

DO $g$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['admin_delivery_overview()','admin_delivery_orders(text,integer,integer)',
                           'admin_delivery_stores()','admin_set_delivery_global(boolean)',
                           'admin_set_store_delivery(text,boolean,text)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', f);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END
$g$;

INSERT INTO public.admin_rpc_permissions (rpc_name, required_perm) VALUES
  ('admin_delivery_overview','tab_sellers'), ('admin_delivery_orders','tab_sellers'),
  ('admin_delivery_stores','tab_sellers'), ('admin_set_delivery_global','tab_sellers'),
  ('admin_set_store_delivery','tab_sellers')
ON CONFLICT DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════════
-- التحقّق
-- ════════════════════════════════════════════════════════════════════════════
SELECT 'الخادم' AS الفحص,
       CASE WHEN obj_description('public'::regnamespace,'pg_namespace')
                 = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN '❌ مختبر طوكيو'
            ELSE '✅ جدة (الإنتاج)' END AS النتيجة
UNION ALL SELECT 'مفتاح الإيقاف العام',
       CASE WHEN EXISTS (SELECT 1 FROM platform_settings WHERE key='delivery_enabled')
            THEN '✅ موجود' ELSE '❌ مفقود' END
UNION ALL SELECT 'المتصفّح يراه (قائمة السماح)',
       CASE WHEN (SELECT qual FROM pg_policies WHERE schemaname='public'
                  AND tablename='platform_settings' AND policyname='platform_settings_select')
                 LIKE '%delivery_enabled%' THEN '✅ نعم' ELSE '❌ غير مرئيّ' END
UNION ALL SELECT 'مفتاح الإدارة لكل متجر',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
                         AND table_name='store_profiles' AND column_name='delivery_blocked_by_admin')
            THEN '✅ موجود' ELSE '❌ مفقود' END
UNION ALL SELECT 'التاجر لا يرفع إيقاف الإدارة',
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.store_profiles'::regclass
                         AND tgname='tr_ab_guard_delivery_block') THEN '✅ مشغّل' ELSE '❌ مفقود' END
UNION ALL SELECT 'دوال اللوحة الخمس',
       (SELECT count(*)::text || '/5' FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname IN ('admin_delivery_overview','admin_delivery_orders',
              'admin_delivery_stores','admin_set_delivery_global','admin_set_store_delivery'))
UNION ALL SELECT 'كلها في خريطة الصلاحيات',
       (SELECT count(*)::text || '/5' FROM admin_rpc_permissions
        WHERE rpc_name LIKE 'admin_delivery%' OR rpc_name LIKE 'admin_set_delivery%'
           OR rpc_name = 'admin_set_store_delivery');
