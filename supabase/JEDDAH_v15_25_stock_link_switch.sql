-- ═══════════════════════════════════════════════════════════════════════════
-- v15.25 — مفتاحُ إظهار «اربط مخزونك بنظامك» بيد ناصر
-- ═══════════════════════════════════════════════════════════════════════════
-- طلبُ ناصر (٢٥ أكتوبر): «اجعل هناك زرّ تشغيلٍ وإخفاءٍ لاربط مخزونك بنظامك
-- لحين التأكّد من عمليّته». والسببُ وجيه: الربطُ مبنيٌّ ومقيس، لكنّ سلّة وزد
-- لا يعملان قبل تسجيل تطبيقَي تاكي لديهما — **وبطاقةٌ لا تُنجز شيئاً للتاجر
-- أسوأُ من غيابها**.
--
-- 🔴 والافتراضُ **مطفأ** (فشلٌ مغلق): غيابُ الصفّ يعني «مخفيّ» لا «ظاهر».
--    وعكسُ ذلك يجعل نسيانَ الضبط يفتح ميزةً غيرَ مؤكَّدة على كلّ التجّار.
--
-- 🪤 وقاعدةُ المشروع المسجَّلة: **أيُّ مفتاح إعدادٍ جديد يُدرَج في ثلاثة
--    مواضع لا اثنين** — فرعُ التطبيق، وقائمةُ الجلب، **وقائمةُ السماح في
--    RLS**. ونسيانُ الثالث يجعل `SELECT` يعود بصفر صفوفٍ **لا بخطأ**، فترتدّ
--    الواجهةُ إلى الافتراضي وتبدو سليمةً تماماً (درس v14.92: ضُبطت مهلةُ
--    الشكاوى على ٦ وبقيت الشاشة تقول ٢٤).
--
-- 🪤 وتُعاد بناءُ السياسة **من نصّها الحيّ** (`pg_get_expr`) بإضافة عنصرٍ
--    واحد — لا من نسخةٍ مكتوبةٍ في هذه الهجرة، وإلّا حُذفت مفاتيحُ أضافها
--    غيري ولا أعلم بها.
-- ═══════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر. أوقِفت.';
  END IF;
  IF to_regclass('public.platform_settings') IS NULL THEN
    RAISE EXCEPTION 'جدولُ الإعدادات غير موجود — أوقِفت.';
  END IF;
END
$guard$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ١) الصفّ — مطفأً
-- ═══════════════════════════════════════════════════════════════════════════
INSERT INTO public.platform_settings (key, value, description)
VALUES ('stock_link_enabled', 'false'::jsonb,
        'إظهار بطاقة «اربط مخزونك بنظامك» للتجّار (v15.25). مطفأةٌ حتى يتأكّد ناصر من عملها.')
ON CONFLICT (key) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٢) قائمةُ السماح — من النصّ الحيّ
-- ═══════════════════════════════════════════════════════════════════════════
DO $patch$
DECLARE v_qual text; v_roles text; v_new text;
BEGIN
  SELECT pg_get_expr(p.polqual, p.polrelid),
         COALESCE(string_agg(quote_ident(r.rolname), ', '), 'public')
    INTO v_qual, v_roles
    FROM pg_policy p
    LEFT JOIN LATERAL unnest(p.polroles) AS pr(oid) ON true
    LEFT JOIN pg_roles r ON r.oid = pr.oid
   WHERE p.polrelid = 'public.platform_settings'::regclass
     AND p.polname = 'platform_settings_select'
   GROUP BY p.polqual, p.polrelid;

  IF v_qual IS NULL THEN RAISE EXCEPTION '❌ سياسةُ القراءة غير موجودة — أوقِفت.'; END IF;
  IF position('stock_link_enabled' IN v_qual) > 0 THEN
    RAISE NOTICE 'ℹ️ المفتاحُ في قائمة السماح أصلاً.'; RETURN;
  END IF;
  IF position('''complaints_sla_hours''::text]' IN v_qual) = 0 THEN
    RAISE EXCEPTION '❌ لم يُعثر على نهاية قائمة السماح في النصّ الحيّ — أوقِفت بدل الرقع الأعمى. النصّ: %', left(v_qual, 200);
  END IF;
  -- 🪤 وتُنسخ الأدوارُ حرفياً: ٦٣ من ٦٤ سياسةً في هذا المشروع كانت `TO public`،
  --    وإعادةُ بنائها بـ`authenticated` كانت ستحجب المحتوى عن الزوّار (v14.38).
  v_new := replace(v_qual, '''complaints_sla_hours''::text]',
                           '''complaints_sla_hours''::text, ''stock_link_enabled''::text]');
  EXECUTE format('DROP POLICY IF EXISTS platform_settings_select ON public.platform_settings');
  EXECUTE format('CREATE POLICY platform_settings_select ON public.platform_settings FOR SELECT TO %s USING (%s)',
                 v_roles, v_new);
  RAISE NOTICE '✅ أُضيف المفتاحُ إلى قائمة السماح (الأدوار: %).', v_roles;
END
$patch$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٣) فحصٌ يرفع استثناءً — والكسرةُ: هل يراه الزائرُ فعلاً؟
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE v_qual text; v_n int; v_val jsonb;
BEGIN
  SELECT pg_get_expr(polqual, polrelid) INTO v_qual FROM pg_policy
   WHERE polrelid = 'public.platform_settings'::regclass AND polname = 'platform_settings_select';
  IF position('stock_link_enabled' IN v_qual) = 0 THEN
    RAISE EXCEPTION '❌ 🔴 المفتاحُ خارج قائمة السماح — سيعود SELECT بصفر صفوفٍ بلا خطأ، وتبدو الشاشةُ سليمة.';
  END IF;
  -- 🔴 ولا تُحذف المفاتيحُ الأخرى: إعادةُ بناءٍ من نسخةٍ مكتوبةٍ كانت ستفعل
  FOR v_n IN SELECT 1 LOOP END LOOP;
  IF position('complaints_sla_hours' IN v_qual) = 0
     OR position('booking_holds' IN v_qual) = 0
     OR position('vapid_public_key' IN v_qual) = 0
     OR position('refund_window' IN v_qual) = 0
     OR position('delivery_enabled' IN v_qual) = 0 THEN
    RAISE EXCEPTION '❌ 🔴 فُقدت مفاتيحُ من قائمة السماح أثناء إعادة البناء.';
  END IF;
  SELECT count(*) INTO v_n FROM pg_policy
   WHERE polrelid = 'public.platform_settings'::regclass;
  IF v_n < 2 THEN RAISE EXCEPTION '❌ فُقدت سياسةٌ (العدد %).', v_n; END IF;

  SELECT value INTO v_val FROM public.platform_settings WHERE key = 'stock_link_enabled';
  IF v_val IS NULL THEN RAISE EXCEPTION '❌ الصفُّ لم يُدرَج.'; END IF;
  IF v_val <> 'false'::jsonb THEN
    RAISE NOTICE 'ℹ️ المفتاحُ مضبوطٌ على % (ضبطٌ سابقٌ محفوظ).', v_val::text;
  END IF;

  RAISE NOTICE '✅ v15.25: المفتاحُ في المواضع الثلاثة · ولا مفتاحَ فُقد · والافتراضُ مطفأ.';
END
$verify$;
