-- ═══════════════════════════════════════════════════════════════════════════
-- v15.72 — مفتاحُ مضيف شبكة التوصيل للصور (مفتاحٌ جاهزٌ لا تغييرٌ مُنفَّذ)
-- ═══════════════════════════════════════════════════════════════════════════
-- `image_cdn_host` فارغٌ افتراضاً = **لا تغيير**. وتفريغُه لاحقاً يُعيد كلَّ
-- عنوانِ صورةٍ إلى الأصل في اللحظة نفسِها، بلا نشرٍ — وهذا مقبضُ الإيقاف.
--
-- 🔴 وما يقوله القياسُ عن الحاجة (٧ نوفمبر ٢٠٢٦): **ليست ضرورةً اليوم.**
--    الجدارُ كان محوّلَ الصور الآنيّ (٤١٢ م.ث معالجاً لكلّ مشاهدة = سقفُ
--    ~٢٫٤ في الثانية على نواةٍ واحدة)، وقد زال بتوأمٍ ثابتٍ يُخدَم بـ٦ م.ث.
--    وما بقي نطاقٌ: مصغّرةٌ ٦٥ ك.ب وهيرو ١٨٠ من مستودعٍ كلُّه ٤٢ م.ب.
--    فإشعالُها يُضيف طرفاً ثالثاً وطريقَ فشلٍ جديداً مقابل مكسبٍ غيرِ مقيس.
--
-- 🪤 والمفتاحُ الجديد في **ثلاثة مواضع لا اثنين** (قاعدةُ v14.92): فرعُ
--    التطبيق · قائمةُ الجلب · **وقائمةُ السماح في RLS**. ونسيانُ الثالث
--    يُعيد `SELECT` بصفر صفوفٍ **لا بخطأ** فترتدّ الواجهةُ إلى الافتراضي
--    وتبدو سليمةً تماماً — وهو أخبثُ صنفٍ من الفشل.
-- 🪤 وتُعاد بناءُ السياسة **من نصّها الحيّ** بإضافة عنصرٍ واحد، وأدوارُها
--    تُنسخ حرفياً (`public`) — فإعادةُ بنائها بـ`authenticated` تحجب
--    البانراتَ والمسابقاتَ عن الزوّار (درسُ v14.38).
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'')
     = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه قاعدةُ المختبر (طوكيو) — الهجرةُ لجدة وحدها.';
  END IF;
END $$;

INSERT INTO public.platform_settings (key, value)
VALUES ('image_cdn_host', '""'::jsonb)
ON CONFLICT (key) DO NOTHING;

DO $$
DECLARE q text; roles text; new_q text;
BEGIN
  SELECT pg_get_expr(pol.polqual, pol.polrelid),
         COALESCE(NULLIF(array_to_string(ARRAY(
           SELECT r.rolname FROM pg_roles r WHERE r.oid = ANY(pol.polroles)), ','), ''), 'public')
    INTO q, roles
    FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid
   WHERE c.relname = 'platform_settings' AND pol.polname = 'platform_settings_select';
  IF q IS NULL THEN RAISE EXCEPTION 'سياسةُ قراءة الإعدادات غير موجودة'; END IF;

  IF q LIKE '%''image_cdn_host''%' THEN
    RAISE NOTICE 'ℓ image_cdn_host مدرجٌ أصلاً.';
  ELSE
    new_q := regexp_replace(q, '(ARRAY\[)', '\1''image_cdn_host''::text, ');
    IF new_q = q THEN RAISE EXCEPTION 'لم يُعثر على ARRAY[ في نصّ السياسة'; END IF;
    EXECUTE 'DROP POLICY platform_settings_select ON public.platform_settings';
    EXECUTE format('CREATE POLICY platform_settings_select ON public.platform_settings '
                 || 'FOR SELECT TO %s USING (%s)', roles, new_q);
    RAISE NOTICE '✅ أُدرج image_cdn_host (الأدوار: %)', roles;
  END IF;
END $$;

-- ── التحقّق: سلوكيٌّ ويرفع ───────────────────────────────────────────────
-- 🪤 ووجودُ المفتاح في القائمة لا يُثبت أن الزائرَ يقرؤه: يُقرأ **بدور
--    `anon` فعلاً** داخل معاملةٍ تُلفى — وهذا ما يفعله المتصفّح.
BEGIN;
DO $$
DECLARE v_n integer; v_pol text;
BEGIN
  SELECT pg_get_expr(pol.polqual, pol.polrelid) INTO v_pol FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
   WHERE c.relname='platform_settings' AND pol.polname='platform_settings_select';
  IF v_pol NOT LIKE '%image_cdn_host%' THEN
    RAISE EXCEPTION 'المفتاحُ ليس في سماح RLS';
  END IF;

  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_n FROM public.platform_settings WHERE key='image_cdn_host';
  RESET ROLE;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'الزائرُ يقرأ % صفّاً للمفتاح (المتوقَّع ١) — سيرتدّ إلى الافتراضي بلا خطأ', v_n;
  END IF;

  -- والقيمةُ الافتراضيّةُ فارغةٌ: أيُّ قيمةٍ غيرُ فارغةٍ هنا تعني إشعالاً
  -- غيرَ مقصودٍ لبنيةٍ لم تُجهَّز بعد.
  IF (SELECT value::text FROM public.platform_settings WHERE key='image_cdn_host') NOT IN ('""', 'null') THEN
    RAISE EXCEPTION 'المفتاحُ مضبوطٌ على قيمةٍ وDNS قد لا يكون جاهزاً';
  END IF;
  RAISE NOTICE '✅ المفتاحُ مُدرَجٌ · والزائرُ يقرؤه · وفارغٌ (لا تغيير)';
END $$;
ROLLBACK;

SELECT 'الخادم' AS "البند", current_setting('server_version') AS "القيمة",
       CASE WHEN COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'')
                 = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN '❌ المختبر' ELSE '✅ جدة' END AS "الحالة"
UNION ALL SELECT 'image_cdn_host',
       COALESCE((SELECT value::text FROM public.platform_settings WHERE key='image_cdn_host'), '(غائب)'),
       CASE WHEN (SELECT value::text FROM public.platform_settings WHERE key='image_cdn_host') = '""'
            THEN '✅ فارغٌ — لا تغيير' ELSE '⚠️ مضبوط' END
UNION ALL SELECT 'في سماح RLS', 'platform_settings_select',
       CASE WHEN (SELECT pg_get_expr(pol.polqual, pol.polrelid) FROM pg_policy pol
                    JOIN pg_class c ON c.oid=pol.polrelid
                   WHERE c.relname='platform_settings'
                     AND pol.polname='platform_settings_select') LIKE '%image_cdn_host%'
            THEN '✅' ELSE '❌' END;
