-- TAKI v14.39c — 🪤 `platform_settings.value` من نوع **jsonb** لا نصّ.
-- الإدراج الأوّل بـ'true' مرّ لأن Postgres يحوّل الحرفيّ ضمنياً، لكن نفس
-- التعبير داخل دالة يفشل: «column value is of type jsonb». تحويلٌ صريح.
DO $g$ BEGIN IF obj_description('public'::regnamespace,'pg_namespace')='TAKI_LAB_TOKYO_MARKER_v1382'
  THEN RAISE EXCEPTION 'TOKYO_LAB_REFUSED'; END IF; END $g$;

CREATE OR REPLACE FUNCTION public.taki_delivery_globally_on()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT (value #>> '{}') FROM public.platform_settings WHERE key = 'delivery_enabled'),
    'true') <> 'false';
$$;
GRANT EXECUTE ON FUNCTION public.taki_delivery_globally_on() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_delivery_global(p_enabled boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.taki_admin_perm('tab_sellers') THEN RAISE EXCEPTION 'Not allowed'; END IF;
  INSERT INTO public.platform_settings (key, value)
  VALUES ('delivery_enabled', to_jsonb(p_enabled))
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  RETURN jsonb_build_object('ok', true, 'enabled', p_enabled);
END $$;
REVOKE ALL ON FUNCTION public.admin_set_delivery_global(boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_delivery_global(boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_set_delivery_global(boolean) TO authenticated;

SELECT 'قيمة المفتاح الآن' AS الفحص,
       COALESCE((SELECT value::text FROM platform_settings WHERE key='delivery_enabled'),'—') AS النتيجة
UNION ALL SELECT 'الدالة تقرؤها صحيحاً',
       CASE WHEN public.taki_delivery_globally_on() THEN '✅ مفعّل' ELSE '⏸ موقوف' END;
