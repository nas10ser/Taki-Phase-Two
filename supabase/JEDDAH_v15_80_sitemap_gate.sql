-- ════════════════════════════════════════════════════════════════════════
-- TAKI · v15.81 — مفتاحُ نشرِ الكتالوج في فهرس البحث (`sitemap_catalogue_enabled`)
--
-- تُشغَّل على **جدة (الإنتاج)** بالدور `supabase_admin`. آمنةٌ للتكرار،
-- ولا فيها `CONCURRENTLY` ولا `ALTER TYPE` — فكلُّها تعمل داخل معاملةٍ واحدة.
--
-- ───────────────────────── لماذا، ومقيساً ─────────────────────────
-- قِيس على جدة في ٨ نوفمبر ٢٠٢٦:
--   • `deals` بحالة `active` = ٦، و**كلُّها** للمتجر
--     `2c0b4cde-79c3-4290-abaa-812a895b1bcb`، وصاحبُه `user_type='admin'`
--     باسم «تاكي». أي أنّ الكتالوجَ الحيَّ كلَّه بياناتُ تجربةٍ لحسابِ الأدمن.
--   • و`sellers_public` فيه ثلاثةُ متاجر، اثنان منها (`ced5ba57…` باسم N15 و
--     `fa5e533c…` باسم «الاناقة») **بلا أيِّ عرضٍ حيّ**.
--   • و`api/sitemap.js` ينشرها كلَّها بـ`changefreq hourly`.
-- وما يدخل فهرسَ جوجل يبقى فيه بعد مسحه من عندنا — فالضررُ لا يُستردّ بنشرٍ
-- جديد. ولذلك يلزم مفتاحٌ يُخرج الكتالوجَ من الفهرس **بلا نشر**.
--
-- 🔴 والافتراضُ `false` عمداً — فشلٌ مغلق: اليوم المنشورُ بياناتُ تجربة،
--    فالصحيحُ ألّا يُنشر حتى يقول ناصرُ «انشره». وكلفةُ الخطأ غيرُ متكافئة:
--    تأخيرُ فهرسةِ عرضٍ حقيقيٍّ ساعاتٍ ⇔ فهرسةُ «Hbdd» و«كوووووووورة» إلى الأبد.
--    (والصفحاتُ الثابتةُ — ومنها القانونيّةُ الستّ — تُنشر دائماً بلا مفتاح.)
--
-- 🪤 وثلاثةُ مواضعَ لا موضعان (درس v14.92 · v15.25) — وهنا **موضعان** فقط
--    لأن القارئَ دالّةٌ خادميّة لا متصفّح:
--      ① الصفُّ في `platform_settings`            ← هذه الهجرة
--      ② قائمةُ السماح في `platform_settings_select` ← هذه الهجرة
--      ③ قائمةُ جلب المتصفّح (`PLATFORM_SETTING_KEYS`) — **لا تلزم**:
--         `api/sitemap.js` يقرأ REST مباشرةً ولا فرعَ تطبيقٍ للمفتاح.
--    وقِيس أثرُ نسيان ②: بدور `anon`، مفتاحٌ داخل القائمة يعود بصفٍّ واحد
--    ومفتاحٌ خارجها يعود **بصفر صفوفٍ لا بخطأ** — فتبدو الواجهةُ سليمةً
--    وهي عمياء.
--
-- 🪤 وتُعاد بناءُ السياسةِ **من نصّها الحيّ** (`pg_get_expr`) بإضافةِ عنصرٍ
--    واحد، لا من نسخةٍ مكتوبةٍ هنا — ففي القائمة الحيّة ٢٥ مفتاحاً، ونسخُها
--    يدوياً يُسقط ما لا نعلم به. وأدوارُها تُنسخ حرفياً (`public` اليوم):
--    إعادةُ بنائها بـ`authenticated` كانت ستحجب الإعدادات عن كلّ زائر.
-- ════════════════════════════════════════════════════════════════════════

-- ① حارسُ المختبر — أوّلُ عبارةٍ دائماً
DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION '⛔ هذه هجرةُ إنتاج (جدة) — ومُنعت على مختبر طوكيو.';
  END IF;
END $guard$;

-- ② الصفُّ نفسُه — `DO NOTHING` فلا تدهس إعادةُ التشغيل قراراً اتّخذه ناصر
INSERT INTO public.platform_settings (key, value, description)
VALUES ('sitemap_catalogue_enabled', 'false'::jsonb,
        'نشرُ العروض والمتاجر في خريطة الموقع (/sitemap.xml). false = الصفحاتُ الثابتةُ وحدها. الافتراضُ مُطفأ حتى يصير الكتالوجُ حقيقياً.')
ON CONFLICT (key) DO NOTHING;

-- ③ قائمةُ السماح في سياسة القراءة — تُعاد بناؤها من نصّها الحيّ
DO $policy$
DECLARE
  v_qual  text;
  v_roles text;
  v_pos   int;
  v_new   text;
BEGIN
  SELECT pg_get_expr(p.polqual, p.polrelid, true),
         (SELECT string_agg(CASE WHEN r.oid = 0 THEN 'public'
                                 ELSE quote_ident(pg_get_userbyid(r.oid)) END, ', ')
            FROM unnest(p.polroles) AS r(oid))
    INTO v_qual, v_roles
    FROM pg_policy p
   WHERE p.polrelid = 'public.platform_settings'::regclass
     AND p.polname  = 'platform_settings_select';

  IF v_qual IS NULL THEN
    RAISE EXCEPTION '❌ السياسةُ `platform_settings_select` غير موجودة — لا يُبنى على غائب.';
  END IF;

  IF position('''sitemap_catalogue_enabled''' IN v_qual) > 0 THEN
    RAISE NOTICE 'ℹ️ ③ المفتاحُ في القائمة أصلاً — لا إعادةَ بناء (آمنةٌ للتكرار).';
    RETURN;
  END IF;

  v_pos := position('ARRAY[' IN v_qual);
  IF v_pos = 0 THEN
    RAISE EXCEPTION '❌ شكلُ السياسةِ الحيِّ غير المتوقَّع (لا `ARRAY[`): %', v_qual;
  END IF;

  -- يُحشر العنصرُ في أوّل `ARRAY[` — وهي قائمةُ المفاتيح، وبقيّةُ الشرط تبقى حرفياً
  v_new := overlay(v_qual PLACING 'ARRAY[''sitemap_catalogue_enabled''::text, ' FROM v_pos FOR 6);

  EXECUTE 'DROP POLICY IF EXISTS platform_settings_select ON public.platform_settings';
  EXECUTE format(
    'CREATE POLICY platform_settings_select ON public.platform_settings FOR SELECT TO %s USING (%s)',
    v_roles, v_new);
  RAISE NOTICE '✅ ③ أُعيدت السياسةُ من نصّها الحيّ بأدوارها (%)', v_roles;
END $policy$;

-- ④ تحقّقٌ **يرفع استثناءً** (جدولُ ✅/❌ لا يُفشل psql — خروجُه صفر)
DO $verify$
DECLARE
  v_rows  int;
  v_qual  text;
  v_roles text;
BEGIN
  -- (أ) الصفُّ موجود
  SELECT count(*) INTO v_rows FROM public.platform_settings WHERE key = 'sitemap_catalogue_enabled';
  IF v_rows <> 1 THEN
    RAISE EXCEPTION '❌ (أ) صفُّ `sitemap_catalogue_enabled` = % لا ١', v_rows;
  END IF;

  -- (ب) القائمةُ الحيّةُ تحمل المفتاح، والأدوارُ ما زالت كما كانت
  SELECT pg_get_expr(p.polqual, p.polrelid, true),
         (SELECT string_agg(CASE WHEN r.oid = 0 THEN 'public'
                                 ELSE pg_get_userbyid(r.oid) END, ',')
            FROM unnest(p.polroles) AS r(oid))
    INTO v_qual, v_roles
    FROM pg_policy p
   WHERE p.polrelid = 'public.platform_settings'::regclass
     AND p.polname  = 'platform_settings_select';
  IF v_qual IS NULL OR position('''sitemap_catalogue_enabled''' IN v_qual) = 0 THEN
    RAISE EXCEPTION '❌ (ب) المفتاحُ ليس في قائمةِ سماحِ السياسة الحيّة';
  END IF;
  IF v_roles <> 'public' THEN
    RAISE EXCEPTION '❌ (ب) أدوارُ السياسةِ صارت «%» لا «public» — نُسخت خطأً', v_roles;
  END IF;
  -- وبقيّةُ الشرطِ لم تُقتطع: صلاحيّاتُ الأدمن الثلاثُ باقيةٌ في النصّ
  IF position('tab_tools' IN v_qual) = 0
     OR position('tab_launch' IN v_qual) = 0
     OR position('tab_reports' IN v_qual) = 0 THEN
    RAISE EXCEPTION '❌ (ب) فُقد فرعُ صلاحيّاتِ الأدمن من السياسة — إعادةُ البناء اقتطعت';
  END IF;
  -- ومفاتيحُ كانت في القائمة لم تسقط (عيّنةٌ شاهدة)
  IF position('''booking_holds''' IN v_qual) = 0
     OR position('''contact_emails''' IN v_qual) = 0 THEN
    RAISE EXCEPTION '❌ (ب) سقط مفتاحٌ قائمٌ من القائمة — النصُّ الحيُّ لم يُنسخ حرفياً';
  END IF;

  -- (ج) 🔴 والاختبارُ الحقيقيّ: هل يقرؤه **الزائرُ المجهول**؟ جلسةُ
  --     `supabase_admin` تتجاوز RLS، فتحقّقٌ بها يُبرّئ مفتاحاً محجوباً.
  --     ⇒ انتحالُ الدور داخل كتلةٍ تُستعاد قبل أيِّ حكم (درس v14.77).
  SET ROLE anon;
  SELECT count(*) INTO v_rows FROM public.platform_settings WHERE key = 'sitemap_catalogue_enabled';
  RESET ROLE;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION '❌ (ج) الزائرُ المجهول يقرأ % صفّاً لا ١ — القائمةُ لم تسرِ', v_rows;
  END IF;

  -- (د) سالبٌ مقصود: مفتاحٌ خارج القائمة يبقى محجوباً عن الزائر — وإلّا
  --     لم يكن الفحصُ (ج) يقيس القائمةَ أصلاً بل انفتاحَ الجدول كلِّه.
  SET ROLE anon;
  SELECT count(*) INTO v_rows FROM public.platform_settings WHERE key = 'bot_channels_disclosed';
  RESET ROLE;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION '❌ (د) الزائرُ قرأ مفتاحاً خارج القائمة (%) — السياسةُ انفتحت', v_rows;
  END IF;

  RAISE NOTICE '✅ ④ الصفُّ موجود · القائمةُ تحمله · الزائرُ يقرؤه · وما خارجَها ما زال محجوباً';
END $verify$;

-- ⑤ جدولٌ للقراءة البشرية — **بعد** كلّ تحقّقٍ رافع
SELECT 'الخادم' AS بند,
       CASE WHEN obj_description('public'::regnamespace,'pg_namespace') IS NULL
            THEN 'جدة — الإنتاج' ELSE 'مختبر ⚠️' END AS قيمة
UNION ALL SELECT 'نشرُ الكتالوج في الفهرس',
       (SELECT COALESCE(value::text,'(غائب)') FROM public.platform_settings WHERE key='sitemap_catalogue_enabled')
UNION ALL SELECT 'المفتاحُ في قائمةِ سماحِ RLS',
       (SELECT CASE WHEN position('''sitemap_catalogue_enabled''' IN pg_get_expr(polqual, polrelid, true)) > 0
                    THEN '✅' ELSE '❌' END
          FROM pg_policy WHERE polrelid='public.platform_settings'::regclass
                           AND polname='platform_settings_select')
UNION ALL SELECT 'عروضٌ حيّة', (SELECT count(*)::text FROM public.deals WHERE status='active')
UNION ALL SELECT 'منها لحسابِ الأدمن',
       (SELECT count(*)::text FROM public.deals d JOIN public.users u ON u.id = d.store_id
         WHERE d.status='active' AND u.user_type='admin')
UNION ALL SELECT 'متاجرٌ في الدليل العامّ', (SELECT count(*)::text FROM public.sellers_public)
UNION ALL SELECT 'منها بعرضٍ حيٍّ واحدٍ على الأقلّ',
       (SELECT count(*)::text FROM public.sellers_public s
         WHERE EXISTS (SELECT 1 FROM public.deals d WHERE d.store_id = s.id AND d.status='active'));

-- ════════════════════════════════════════════════════════════════════════
-- -- ROLLBACK
-- -- ① يُسقط المفتاحُ من قائمةِ السماح — من النصّ الحيِّ أيضاً، لا من نسخة
-- DO $rb$
-- DECLARE v_qual text; v_roles text;
-- BEGIN
--   SELECT pg_get_expr(p.polqual, p.polrelid, true),
--          (SELECT string_agg(CASE WHEN r.oid = 0 THEN 'public'
--                                  ELSE quote_ident(pg_get_userbyid(r.oid)) END, ', ')
--             FROM unnest(p.polroles) AS r(oid))
--     INTO v_qual, v_roles
--     FROM pg_policy p
--    WHERE p.polrelid = 'public.platform_settings'::regclass
--      AND p.polname  = 'platform_settings_select';
--   v_qual := replace(v_qual, '''sitemap_catalogue_enabled''::text, ', '');
--   EXECUTE 'DROP POLICY IF EXISTS platform_settings_select ON public.platform_settings';
--   EXECUTE format('CREATE POLICY platform_settings_select ON public.platform_settings FOR SELECT TO %s USING (%s)', v_roles, v_qual);
-- END $rb$;
-- -- ② ثمّ الصفّ
-- DELETE FROM public.platform_settings WHERE key = 'sitemap_catalogue_enabled';
-- 🪤 وبعد الرجوع يبقى `api/sitemap.js` قارئاً للمفتاح، وغيابُه يعني **لا
--    نشرَ كتالوج** (فشلٌ مغلق) — فالرجوعُ وحده لا يُعيد النشرَ القديم، ويلزمه
--    رجوعُ الكود معه.
-- ════════════════════════════════════════════════════════════════════════
