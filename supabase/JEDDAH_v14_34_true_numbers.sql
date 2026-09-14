-- ════════════════════════════════════════════════════════════════════════════
-- TAKI v14.34 — الأرقام تقول الحقيقة (طلب ناصر ٤)
-- ════════════════════════════════════════════════════════════════════════════
-- ثلاثة أرقام كانت تكذب على ناصر بلا أن يشكّ فيها:
--  ١. «ر.س مصروفة» لكل مشترٍ = **صفر دائماً**. العمود `users.total_spent`
--     معرّف بـDEFAULT 0 ولا يكتبه أحد في المنصّة كلها (قِيس: صفر لكل الحسابات
--     الستّة). ومرشّح «الأكثر إنفاقاً» يرتّب بقيمة ثابتة فلا يرتّب شيئاً.
--  ٢. عدّاد المستخدمين في «الرئيسية» يشمل **المحذوفين**، بينما القائمة التي
--     يفتحها الزرّ نفسه تستبعدهم — فيظنّ ناصر أن القائمة «ضاع منها» أحد.
--  ٣. «العروض النشطة» تشمل الموقوفة: الشرط نفيٌ لحالتين ومجال الحالات أربع.
--
-- وبطاقات «البلاغات والشكاوى» كانت تعدّ **الصفوف المحمّلة** وتكتب تحتها
-- «الإجمالي» — ومع سقف ١٠٠ صفّاً كان «الإجمالي» يتوقّف عند ١٠٠ إلى الأبد.
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

-- ── عدّادات البلاغات والشكاوى من الجدول كلّه لا من الصفحة ───────────────────
CREATE OR REPLACE FUNCTION public.admin_reports_summary()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v jsonb;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Admin only'; END IF;
  SELECT jsonb_build_object(
    'reports', jsonb_build_object(
      'open',     (SELECT count(*) FROM public.reports WHERE status = 'open'),
      'review',   (SELECT count(*) FROM public.reports WHERE status = 'under_review'),
      'resolved', (SELECT count(*) FROM public.reports WHERE status = 'resolved'),
      'total',    (SELECT count(*) FROM public.reports)),
    'complaints', jsonb_build_object(
      'open',     (SELECT count(*) FROM public.complaints WHERE status = 'open'),
      'review',   (SELECT count(*) FROM public.complaints WHERE status = 'reviewing'),
      'resolved', (SELECT count(*) FROM public.complaints WHERE status = 'resolved'),
      'total',    (SELECT count(*) FROM public.complaints))
  ) INTO v;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.admin_reports_summary() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_reports_summary() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_reports_summary() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_search_users(p_query text DEFAULT ''::text, p_user_type text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(id text, name text, phone text, email text, user_type text, shop text, address text, is_suspended boolean, total_bookings integer, total_spent numeric, last_active_at timestamp with time zone, created_at timestamp with time zone, subscription_plan text, subscription_expires_at timestamp with time zone, subscription_amount numeric, discount_percentage numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_caller_role TEXT;
    v_q TEXT;
BEGIN
  PERFORM public._admin_require_ctx();
    SELECT u.user_type INTO v_caller_role FROM users u WHERE u.id = auth.uid()::text;
    IF v_caller_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Admin only';
    END IF;

    v_q := '%' || COALESCE(p_query, '') || '%';

    RETURN QUERY
    SELECT u.id, u.name, u.phone, u.email, u.user_type, u.shop, u.address,
           COALESCE(u.is_suspended, FALSE),
           (SELECT COUNT(*)::int FROM bookings b WHERE b.user_id = u.id),
           -- v14.33 — `u.total_spent` عمودٌ ميّت: DEFAULT 0 ولا يكتبه أحد في
           -- المنصّة كلها (قِيس: صفر لكل الحسابات). فبطاقة المشتري كانت تقول
           -- «٠ ر.س مصروفة» مهما أنفق، ومرشّح «الأكثر إنفاقاً» يرتّب بقيمة
           -- ثابتة فلا يرتّب. المصدر الصحيح هو الإجمالي المُجمَّد على الحجز.
           public.taki_user_spend(u.id),
           u.last_active_at, u.created_at,
           sp.subscription_plan,
           sp.subscription_expires_at,
           sp.subscription_amount,
           sp.discount_percentage::numeric
    FROM users u
    LEFT JOIN store_profiles sp ON sp.store_id = u.id
    WHERE (u.deleted_at IS NULL)
      AND (
        p_user_type IS NULL
        OR u.user_type = p_user_type
        OR (p_user_type = 'buyer' AND u.user_type <> 'seller'
            AND EXISTS (SELECT 1 FROM bookings b WHERE b.user_id = u.id))
      )
      AND (
        p_query = '' OR
        u.name  ILIKE v_q OR
        u.phone ILIKE v_q OR
        u.email ILIKE v_q OR
        u.shop  ILIKE v_q OR
        u.address ILIKE v_q
      )
    ORDER BY u.created_at DESC
    LIMIT p_limit OFFSET p_offset;
END $function$;


CREATE OR REPLACE FUNCTION public.get_live_stats(p_minutes integer DEFAULT 5)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_caller_role TEXT;
    v_threshold TIMESTAMPTZ;
    result JSONB;
BEGIN
    SELECT user_type INTO v_caller_role FROM users WHERE id = auth.uid()::text;
    IF v_caller_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Admin only';
    END IF;

    v_threshold := NOW() - (p_minutes || ' minutes')::INTERVAL;

    SELECT jsonb_build_object(
        'active_users',   (SELECT COUNT(DISTINCT user_id)::INT FROM user_sessions WHERE last_seen_at > v_threshold),
        'active_buyers',  (SELECT COUNT(DISTINCT user_id)::INT FROM user_sessions WHERE user_type = 'buyer'  AND last_seen_at > v_threshold),
        'active_sellers', (SELECT COUNT(DISTINCT user_id)::INT FROM user_sessions WHERE user_type = 'seller' AND last_seen_at > v_threshold),
        'bookings_today', (SELECT COUNT(*)::INT FROM bookings WHERE created_at >= NOW()::DATE),
        'bookings_hour',  (SELECT COUNT(*)::INT FROM bookings WHERE created_at > NOW() - INTERVAL '1 hour'),
        'bookings_5min',  (SELECT COUNT(*)::INT FROM bookings WHERE created_at > NOW() - INTERVAL '5 minutes'),
        'new_users_today',(SELECT COUNT(*)::INT FROM users    WHERE created_at >= NOW()::DATE),
        -- v14.33 — كانت تعدّ المحذوفين، بينما «إدارة المشترين» تستبعدهم.
        -- فالزرّ في الرئيسية يقول عدداً والقائمة التي يفتحها تعرض أقلّ منه.
        'total_users',    (SELECT COUNT(*)::INT FROM users WHERE deleted_at IS NULL),
        'total_buyers',   (SELECT COUNT(*)::INT FROM users WHERE user_type = 'buyer'  AND deleted_at IS NULL),
        'total_sellers',  (SELECT COUNT(*)::INT FROM users WHERE user_type = 'seller' AND deleted_at IS NULL),
        -- «النشطة» كانت تشمل `paused` لأن الشرط نفيٌ لحالتين فقط، ومجال
        -- الحالات أربع. الإثبات أوضح من النفي.
        'active_deals',   (SELECT COUNT(*)::INT FROM deals  WHERE status = 'active'),
        'paying_sellers', (SELECT COUNT(*)::INT FROM store_profiles WHERE subscription_plan = 'premium' AND (subscription_expires_at IS NULL OR subscription_expires_at > NOW())),
        'mrr',            (SELECT COALESCE(SUM(subscription_amount), 0)::NUMERIC FROM store_profiles WHERE subscription_plan = 'premium' AND (subscription_expires_at IS NULL OR subscription_expires_at > NOW())),
        'as_of',          NOW()
    ) INTO result;

    RETURN result;
END $function$;


-- ════════════════════════════════════════════════════════════════════════════
-- التحقّق
-- ════════════════════════════════════════════════════════════════════════════
SELECT 'الخادم' AS الفحص,
       CASE WHEN obj_description('public'::regnamespace,'pg_namespace')
                 = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN '❌ مختبر طوكيو'
            ELSE '✅ جدة (الإنتاج)' END AS النتيجة
UNION ALL SELECT 'الإنفاق يُحسب حيّاً',
       CASE WHEN pg_get_functiondef(to_regprocedure(
              (SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
               WHERE n.nspname='public' AND p.proname='admin_search_users' LIMIT 1)))
                 LIKE '%taki_user_spend%' THEN '✅ نعم' ELSE '❌ ما زال العمود الميّت' END
UNION ALL SELECT 'العدّادات تستبعد المحذوفين',
       CASE WHEN pg_get_functiondef(to_regprocedure(
              (SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
               WHERE n.nspname='public' AND p.proname='get_live_stats' LIMIT 1)))
                 LIKE '%deleted_at IS NULL%' THEN '✅ نعم' ELSE '❌ لا' END
UNION ALL SELECT 'العروض النشطة نشطةٌ فعلاً',
       CASE WHEN pg_get_functiondef(to_regprocedure(
              (SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
               WHERE n.nspname='public' AND p.proname='get_live_stats' LIMIT 1)))
                 LIKE '%status = ''active''%' THEN '✅ نعم' ELSE '❌ لا' END
UNION ALL SELECT 'ملخّص البلاغات من الجدول كلّه',
       CASE WHEN to_regprocedure('public.admin_reports_summary()') IS NOT NULL
            THEN '✅ موجود' ELSE '❌ مفقود' END;
