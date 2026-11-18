-- ═══════════════════════════════════════════════════════════════════════════
-- v16.40 — تحليلُ الجمهور: الجنس × الفئة العمرية × مدينة الشراء
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 طلبُ ناصر: «أريد تحليلاً شاملاً في النمو للموقع، وأستطيع فلترة الأعمار
--    والذكور أو الإناث ومدنهم وبحثهم — فلترة شاملة لتحليل سلوك المستهلكين».
--
-- 🔴 **وتصحيحٌ لا بدّ منه قبل البناء: «مدينة المستخدم» غير مخزَّنة أصلاً.**
--    قِيس على جدة (١٨ نوفمبر): `public.users` فيها **صفرُ عمودٍ باسم مدينة**،
--    و`delivery_address` فيها **صفرُ صفٍّ** بمدينة، و٣ حساباتٍ فقط لها إحداثيات.
--    فأيُّ «فلترةٍ بالمدينة» على مستوى الحساب كانت ستكون عموداً فارغاً يُعرض
--    كأنّه بيانات.
--    ⇒ تُشتقّ المدينةُ من **حيث يشتري فعلاً** (مدينةُ العروض التي حجزها)، وهي
--      تُسمّى في الشاشة «مدينة الشراء» لا «مدينة السكن» — فلا يُقرأ المشتقُّ
--      على أنه مُصرَّحٌ به. ومن لم يحجز بعدُ يظهر تحت «غير معروفة».
--
-- 🪤 والمدى `p_days = 0` يعني **كلَّ الوقت** عمداً: الفئاتُ الديموغرافية تُجمع
--    مرّةً عند التسجيل ولا تتغيّر، فحصرُها في آخر ٣٠ يوماً يُخفي كلَّ من سجّل
--    قبل ذلك — وهو عكسُ المقصود من «تحليل الجمهور».
-- 🪤 ولا يُرجَع أيُّ صفٍّ يدلّ على شخص: أعدادٌ مجمّعةٌ فقط، بلا اسمٍ ولا معرّف.
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
    v jsonb;
BEGIN
    IF NOT public.taki_admin_perm('tab_analytics') THEN
        RAISE EXCEPTION 'forbidden: analytics permission required';
    END IF;

    WITH base AS (
        SELECT u.id, u.gender, u.age_band
          FROM public.users u
         WHERE u.user_type = 'buyer'
           AND u.deleted_at IS NULL
           AND COALESCE(u.is_anonymized, false) = false
           AND u.created_at >= v_from
    ),
    -- مدينةُ الشراء: أكثرُ مدينةٍ حجز فيها هذا المشتري. 🪤 `DISTINCT ON` مع
    -- ترتيبٍ صريح — لا `max()` على نصٍّ (تلك تُعيد الأبجديَّ لا الأكثر).
    city AS (
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
        'gender', (SELECT count(*) FROM base WHERE gender IS NOT NULL),
        'age',    (SELECT count(*) FROM base WHERE age_band IS NOT NULL)
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
      'cities', COALESCE((
        SELECT jsonb_agg(x ORDER BY (x->>'n')::int DESC)
          FROM (SELECT jsonb_build_object('city', COALESCE(c.city, 'unknown'), 'n', count(*)) AS x
                  FROM base b LEFT JOIN city c ON c.user_id = b.id
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

    -- الحارسُ في الجسم لا في تعليق (يُجرَّد التعليقُ أوّلاً — فخٌّ مسجَّل).
    IF position('taki_admin_perm' in regexp_replace(v_src, '--[^\n]*', '', 'g')) = 0 THEN
        RAISE EXCEPTION 'حارسُ الصلاحية غائبٌ عن جسم admin_demographics';
    END IF;

    IF v_acl IS NOT NULL AND position('anon=' in v_acl) > 0 THEN
        RAISE EXCEPTION 'admin_demographics ممنوحةٌ لـanon: %', v_acl;
    END IF;

    -- والمحذوفون والمجهَّلون مستثنون — وإلّا عُدَّ من حذف حسابَه جمهوراً.
    IF position('is_anonymized' in v_src) = 0 OR position('deleted_at' in v_src) = 0 THEN
        RAISE EXCEPTION 'admin_demographics لا تستثني المحذوفين/المجهَّلين';
    END IF;

    RAISE NOTICE '✅ admin_demographics: نسخةٌ واحدة · محروسة · لا منحَ لـanon · تستثني المحذوفين';
END $verify$;
