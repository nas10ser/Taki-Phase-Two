-- ═══════════════════════════════════════════════════════════════════════════
-- v16.41 — مدينةُ المشتري تُشتقّ من موقعه لا من سؤال
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 قرارُ ناصر (١٩ نوفمبر ٢٠٢٦) جواباً على اقتراحي بإضافة سؤال مدينةٍ عند
--    التسجيل: «لا، لكن الموقع من خلال ربط اللوكيشن سنعرف المدينة».
--    ⇒ لا سؤالَ ثالث. المدينةُ تُستنتج من إحداثيات المشتري.
--
-- 🪤 **والمحرّكُ كان موجوداً** (قاعدةُ المشروع: قِسِ المحرّكَ قبل أن تبنيَه):
--      · `public.sa_cities_geo` — ٧٣ مدينةً بإحداثياتها ومناطقها.
--      · `public.find_nearest_sa_city(lat, lng)` — هافرساين، موجودةٌ وتعمل.
--    فلم يُبنَ شيءٌ جديد؛ رُبط القائمُ وحده.
--
-- 🔴 **ولمن تصحّ هذه الاشتقاقة؟ للمشتري وحده.** قِيس في `AppContext`
--    (`persistLiveLocation`): الكتابةُ في `users.lat/lng` محصورةٌ بـ
--    `userType === 'buyer'` منذ v13.11 — لأن التاجر (وكذلك متجرُ الأدمن) له
--    **دبّوسٌ ثابتٌ للمحلّ** في نفس العمودين، فالكتابةُ فوقَه تُضيّع موقع
--    المتجر. ⇒ لو اشتققتُ «مدينةَ التاجر» من نفس العمودين لقرأتُ موقعَ
--    **محلّه** على أنه سكنُه. ولذلك تبقى الدالّةُ على المشترين وحدهم.
--    (وقِيس على جدة: ٣ حساباتٍ لها إحداثيات — مشترٍ وتاجرٌ وأدمن — وكلُّها
--     قرب الدمام بـ٥٫٣–٥٫٧ كم، فالاشتقاقُ دقيق.)
--
-- 🔴 **وسقفُ مسافة** (`v_max_km`): `find_nearest_sa_city` **بلا حدّ** — تُعيد
--    أقربَ مدينةٍ سعوديّةٍ مهما بَعُد الجهاز. فمشترٍ خارج المملكة كان سيُنسب
--    إلى مدينةٍ لم يَزُرها قطّ. ومن تجاوز السقفَ يظهر «غير معروفة» لا بمدينةٍ
--    مخترَعة. (٢٠٠ كم: تغطّي من يسكن بعيداً عن أقرب مدينةٍ مدرجة، وتستبعد
--    خارجَ الحدود.)
--
-- 🔒 **والخصوصية**: سياسةُ الخصوصية تنصّ أصلاً على أن إحصاءات الجمهور
--    «تُعرض على مستوى المدن والمناطق فقط دون كشف مواقع فردية» — وهذا ما
--    يفعله هذا التجميع حرفاً: أعدادٌ لكلّ مدينة، بلا صفٍّ يدلّ على شخص.
--    فلا تغييرَ قانونيٌّ مطلوب، ولا يُرجَع أيُّ إحداثيّ إلى الشاشة.
--
-- 🪤 و«مدينة الشراء» تبقى **قسماً ثانياً مستقلاً**: هي «أين يشتري» لا «أين
--    هو»، والسؤالان مختلفان — ودمجُهما في رقمٍ واحد يُفسد كليهما.
-- ═══════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
    IF COALESCE(obj_description('public'::regnamespace, 'pg_namespace'), '')
       LIKE '%TAKI_LAB_TOKYO_MARKER%' THEN
        RAISE EXCEPTION 'هذه هجرةُ إنتاج — ورُفض تنفيذُها على المختبر (طوكيو).';
    END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.admin_demographics(p_days integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_days int := GREATEST(0, LEAST(COALESCE(p_days, 0), 3650));
    v_from timestamptz := CASE WHEN v_days = 0 THEN '-infinity'::timestamptz
                               ELSE now() - (v_days || ' days')::interval END;
    -- أبعدُ مسافةٍ تُقبل بين المشتري وأقرب مدينةٍ مدرجة. ما تجاوزها «غير معروفة».
    v_max_km constant double precision := 200;
    v jsonb;
BEGIN
    IF NOT public.taki_admin_perm('tab_analytics') THEN
        RAISE EXCEPTION 'forbidden: analytics permission required';
    END IF;

    WITH base AS (
        SELECT u.id, u.gender, u.age_band, u.lat, u.lng
          FROM public.users u
         WHERE u.user_type = 'buyer'
           AND u.deleted_at IS NULL
           AND COALESCE(u.is_anonymized, false) = false
           AND u.created_at >= v_from
    ),
    -- مدينةُ الموقع: أقربُ مدينةٍ لإحداثيات المشتري، بشرط السقف.
    -- 🪤 `LATERAL` لا نداءٌ مكرّر: استدعاءُ الدالّة ثلاثَ مرّاتٍ في نفس الصفّ
    --    (للمدينة والمنطقة والمسافة) يُعيد مسحَ ٧٣ صفّاً ثلاثَ مرّات لكلّ مشترٍ.
    loc AS (
        SELECT b.id,
               CASE WHEN c.km <= v_max_km THEN c.city_id   END AS city_id,
               CASE WHEN c.km <= v_max_km THEN c.region_id END AS region_id
          FROM base b
          LEFT JOIN LATERAL (
              SELECT g.city_id, g.region_id,
                     2 * 6371 * asin(sqrt(
                         sin(radians((g.lat - b.lat) / 2)) ^ 2
                         + cos(radians(b.lat)) * cos(radians(g.lat))
                           * sin(radians((g.lng - b.lng) / 2)) ^ 2
                     )) AS km
                FROM public.sa_cities_geo g
               ORDER BY km ASC
               LIMIT 1
          ) c ON b.lat IS NOT NULL AND b.lng IS NOT NULL
    ),
    -- مدينةُ الشراء: أكثرُ مدينةٍ حجز فيها. سؤالٌ آخر، ويبقى مستقلّاً.
    buycity AS (
        SELECT DISTINCT ON (b.user_id) b.user_id, d.city
          FROM public.bookings b
          JOIN public.deals d ON d.id = b.deal_id
         WHERE d.city IS NOT NULL AND d.city <> ''
         GROUP BY b.user_id, d.city
         ORDER BY b.user_id, count(*) DESC, d.city
    )
    SELECT jsonb_build_object(
      'days', v_days,
      'total', (SELECT count(*) FROM base),
      'answered', jsonb_build_object(
        'gender',   (SELECT count(*) FROM base WHERE gender IS NOT NULL),
        'age',      (SELECT count(*) FROM base WHERE age_band IS NOT NULL),
        -- v16.41 — تغطيةُ الموقع: كم مشترياً نعرف مدينتَه أصلاً. بلا هذا
        -- الرقم تُقرأ قائمةُ المدن على أنها الجميع، وهي جزءٌ منهم.
        'located',  (SELECT count(*) FROM loc WHERE city_id IS NOT NULL)
      ),
      'gender', COALESCE((
        SELECT jsonb_agg(x ORDER BY (x->>'n')::int DESC)
          FROM (SELECT jsonb_build_object('g', COALESCE(gender, 'unknown'), 'n', count(*)) AS x
                  FROM base GROUP BY COALESCE(gender, 'unknown')) t
      ), '[]'::jsonb),
      'age', COALESCE((
        SELECT jsonb_agg(x ORDER BY x->>'band')
          FROM (SELECT jsonb_build_object('band', COALESCE(age_band, 'unknown'), 'n', count(*)) AS x
                  FROM base GROUP BY COALESCE(age_band, 'unknown')) t
      ), '[]'::jsonb),
      'matrix', COALESCE((
        SELECT jsonb_agg(x ORDER BY x->>'band', x->>'g')
          FROM (SELECT jsonb_build_object(
                        'g',    COALESCE(gender, 'unknown'),
                        'band', COALESCE(age_band, 'unknown'),
                        'n',    count(*)) AS x
                  FROM base GROUP BY COALESCE(gender, 'unknown'), COALESCE(age_band, 'unknown')) t
      ), '[]'::jsonb),
      -- v16.41 — مدينةُ الموقع (قرارُ ناصر: تُعرف من اللوكيشن لا من سؤال).
      'loc_cities', COALESCE((
        SELECT jsonb_agg(x ORDER BY (x->>'n')::int DESC)
          FROM (SELECT jsonb_build_object('city', COALESCE(l.city_id, 'unknown'), 'n', count(*)) AS x
                  FROM loc l GROUP BY COALESCE(l.city_id, 'unknown')
                 ORDER BY count(*) DESC LIMIT 20) t
      ), '[]'::jsonb),
      'loc_regions', COALESCE((
        SELECT jsonb_agg(x ORDER BY (x->>'n')::int DESC)
          FROM (SELECT jsonb_build_object('region', COALESCE(l.region_id, 'unknown'), 'n', count(*)) AS x
                  FROM loc l GROUP BY COALESCE(l.region_id, 'unknown')
                 ORDER BY count(*) DESC LIMIT 20) t
      ), '[]'::jsonb),
      -- ويبقى «أين يشتري» قسماً مستقلّاً — سؤالٌ آخر لا بديلٌ عن الأوّل.
      'cities', COALESCE((
        SELECT jsonb_agg(x ORDER BY (x->>'n')::int DESC)
          FROM (SELECT jsonb_build_object('city', COALESCE(c.city, 'unknown'), 'n', count(*)) AS x
                  FROM base b LEFT JOIN buycity c ON c.user_id = b.id
                 GROUP BY COALESCE(c.city, 'unknown')
                 ORDER BY count(*) DESC LIMIT 20) t
      ), '[]'::jsonb)
    ) INTO v;
    RETURN v;
END $function$;

REVOKE ALL ON FUNCTION public.admin_demographics(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_demographics(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_demographics(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_demographics(integer) TO service_role;

DO $verify$
DECLARE
    v_src text;
    v_acl text;
BEGIN
    SELECT pg_get_functiondef(p.oid), array_to_string(p.proacl, ' | ')
      INTO v_src, v_acl
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname='admin_demographics' AND p.prokind='f';

    IF v_src IS NULL THEN RAISE EXCEPTION 'admin_demographics غير موجودة'; END IF;

    IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
         WHERE n.nspname='public' AND p.proname='admin_demographics') <> 1 THEN
        RAISE EXCEPTION 'توجد أكثرُ من نسخةٍ من admin_demographics';
    END IF;

    -- 🪤 يُجرَّد التعليقُ قبل كلّ فحصٍ نصّيّ: الحارسُ أمسك تعليقَه هو مرّاتٍ
    --    في هذا المشروع. وهذا الملفُّ يذكر كلَّ الأسماء التي يبحث عنها.
    v_src := regexp_replace(v_src, '--[^\n]*', '', 'g');

    IF position('taki_admin_perm' in v_src) = 0 THEN
        RAISE EXCEPTION 'حارسُ الصلاحية غائبٌ عن جسم admin_demographics';
    END IF;
    IF v_acl IS NOT NULL AND position('anon=' in v_acl) > 0 THEN
        RAISE EXCEPTION 'admin_demographics ممنوحةٌ لـanon: %', v_acl;
    END IF;
    IF position('is_anonymized' in v_src) = 0 OR position('deleted_at' in v_src) = 0 THEN
        RAISE EXCEPTION 'admin_demographics لا تستثني المحذوفين/المجهَّلين';
    END IF;

    -- ① المدينةُ تُشتقّ فعلاً من الإحداثيات
    IF position('sa_cities_geo' in v_src) = 0 OR position('loc_cities' in v_src) = 0 THEN
        RAISE EXCEPTION 'الاشتقاقُ من الموقع لم يدخل جسمَ الدالّة';
    END IF;

    -- ② 🔴 وسقفُ المسافة قائم — بلا ذلك يُنسب من خارج المملكة إلى مدينةٍ سعوديّة
    IF position('v_max_km' in v_src) = 0 THEN
        RAISE EXCEPTION 'سقفُ المسافة غائب — ستُنسب إحداثياتٌ بعيدةٌ إلى أقرب مدينةٍ زوراً';
    END IF;

    -- ③ ولا تُشتقّ لغير المشتري: عمودا lat/lng عند التاجر هما دبّوسُ محلّه
    IF position('''buyer''' in v_src) = 0 THEN
        RAISE EXCEPTION 'الاشتقاقُ غيرُ محصورٍ بالمشترين — دبّوسُ المتجر ليس سكنَ صاحبه';
    END IF;

    -- ④ ولا يخرج إحداثيٌّ إلى الواجهة
    IF v_src ~ '''lat''\s*,' OR v_src ~ '''lng''\s*,' THEN
        RAISE EXCEPTION 'الدالّةُ تُرجع إحداثيّاً — التجميعُ على مستوى المدينة فقط';
    END IF;

    RAISE NOTICE '✅ admin_demographics: المدينةُ من الموقع · سقفُ % كم · المشترون وحدهم · بلا إحداثيّات', 200;
END $verify$;
