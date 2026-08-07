-- ═══════════════════════════════════════════════════════════════════════════
-- v13.75 — فحص أمني شامل لخادم جدة (قراءة فقط + هجمات محاكاة تُلغى)
--
-- الغرض: الإجابة على سؤالين بالأرقام لا بالثقة —
--   (أ) هل انتقلت كل حراسات الأمان التي بنيناها على مدى أشهر إلى جدة؟
--   (ب) هل بقيت ثغرة مفتوحة الآن؟
--
-- الاستعمال: الصقه كاملاً في SQL Editor على خادم جدة واضغط Run.
-- كل اختبار كتابة يجري داخل معاملة فرعية **تُلغى** — صفر أثر على البيانات.
-- المتوقع: ✅ في كل سطر. أي ❌ = بند ناقص، وبجانبه اسمه بالضبط.
--
-- القيم المرجعية مقيسة على نسخة طوكيو (٧ أغسطس ٢٠٢٦) وهي المصدر الذي نُقلت
-- منه جدة في v13.55-57 ببصمات MD5 متطابقة.
-- ═══════════════════════════════════════════════════════════════════════════

WITH
-- ── ١) الأساس: RLS على كل جدول ────────────────────────────────────────────
rls AS (
    SELECT count(*) FILTER (WHERE NOT c.relrowsecurity) AS tables_without_rls,
           count(*)                                     AS tables_total
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
),
-- ── ٢) كل دالة SECURITY DEFINER بمسار بحث مثبَّت (v10.51 / v11.43) ────────
sp AS (
    SELECT count(*) AS secdef_unpinned
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prosecdef
       AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) cfg
                        WHERE cfg LIKE 'search_path=%')
),
-- ── ٣) 🔴 الفخّ الذي كشفته v13.75: view في public يقبل كتابة anon ─────────
vw AS (
    SELECT count(*) AS writable_views
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
       AND (has_table_privilege('anon', c.oid, 'INSERT')
         OR has_table_privilege('anon', c.oid, 'UPDATE')
         OR has_table_privilege('anon', c.oid, 'DELETE')
         OR has_table_privilege('authenticated', c.oid, 'INSERT')
         OR has_table_privilege('authenticated', c.oid, 'UPDATE')
         OR has_table_privilege('authenticated', c.oid, 'DELETE'))
),
-- ── ٤) جدول بلا RLS ومكشوف للزائر (نفس فئة الخطر) ─────────────────────────
tbl AS (
    SELECT count(*) AS exposed_tables
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
       AND (has_table_privilege('anon', c.oid, 'SELECT')
         OR has_table_privilege('anon', c.oid, 'UPDATE')
         OR has_table_privilege('anon', c.oid, 'INSERT')
         OR has_table_privilege('anon', c.oid, 'DELETE'))
),
-- ── ٥) الحراسات المُسمّاة من كل هجرة أمنية سابقة ───────────────────────────
guards AS (
    SELECT
      -- v10.38 / v12.75: الأدمن يُقاس بدالة SECURITY DEFINER لا بـEXISTS داخل السياسة
      EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
               WHERE n.nspname='public' AND p.proname='is_admin')                    AS g_is_admin,
      -- v12.12: بوابة البوت السرّية — بدونها ينتحل أي أحد هوية أي مستخدم مرتبط
      EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
               WHERE n.nspname='public' AND p.proname='_bot_gate_ok')                AS g_bot_gate,
      -- v13.15: تحديد المعدّل
      EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
               WHERE n.nspname='public' AND c.relname='rate_limit_counters')         AS g_rate_limit,
      -- v13.46: صلاحيات الأدمن التفصيلية
      EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
               WHERE n.nspname='public' AND c.relname='admin_rpc_permissions')       AS g_admin_perms,
      -- v13.71: بيانات التجار محمية (السياسة المفتوحة القديمة محذوفة)
      EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
               AND policyname='users_select_own_or_admin')                           AS g_users_policy,
      NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                   AND policyname='users_select_all')                                AS g_old_policy_gone,
      -- v13.58: مشغّلا auth.users (بدونهما كل مسجَّل جديد بلا ملف شخصي)
      EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal
               AND tgname='on_auth_user_created')                                    AS g_auth_created,
      EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal
               AND tgname='on_auth_user_deleted')                                    AS g_auth_deleted,
      -- v10.46 / v13.16: سقف مواقع الباقة
      EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal
               AND tgname='tr_enforce_branch_cap')                                   AS g_branch_cap,
      -- v13.67: مواءمة المعروض عند تغيير الباقة (جدة فقط — غير موجود في طوكيو)
      EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal
               AND tgname='tr_branch_cap_on_package_change')                         AS g_branch_pkg,
      -- v13.75: الحاجز البنيوي الجديد على الدليل العام
      EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal
               AND tgname='tr_sellers_public_readonly')                              AS g_v1375
)
SELECT
    CASE WHEN rls.tables_without_rls = 0 THEN '✅ نعم'
         ELSE '❌ لا — ' || rls.tables_without_rls || ' جدول' END
        AS "١ RLS مفعّل على كل جدول؟",
    CASE WHEN sp.secdef_unpinned = 0 THEN '✅ نعم'
         ELSE '❌ لا — ' || sp.secdef_unpinned || ' دالة' END
        AS "٢ كل دوال SECURITY DEFINER بمسار مثبَّت؟",
    CASE WHEN vw.writable_views = 0 THEN '✅ نعم'
         ELSE '🔴 لا — ' || vw.writable_views || ' view مكشوف للكتابة!' END
        AS "٣ لا يوجد view يقبل كتابة الزائر؟",
    CASE WHEN tbl.exposed_tables = 0 THEN '✅ نعم'
         ELSE '🔴 لا — ' || tbl.exposed_tables || ' جدول' END
        AS "٤ لا يوجد جدول بلا RLS مكشوف؟",
    CASE WHEN guards.g_is_admin AND guards.g_bot_gate AND guards.g_rate_limit
          AND guards.g_admin_perms AND guards.g_users_policy AND guards.g_old_policy_gone
          AND guards.g_auth_created AND guards.g_auth_deleted AND guards.g_branch_cap
         THEN '✅ نعم'
         ELSE '❌ ناقص: ' || concat_ws(' · ',
                CASE WHEN NOT guards.g_is_admin       THEN 'is_admin()' END,
                CASE WHEN NOT guards.g_bot_gate       THEN 'بوابة البوت' END,
                CASE WHEN NOT guards.g_rate_limit     THEN 'تحديد المعدّل' END,
                CASE WHEN NOT guards.g_admin_perms    THEN 'صلاحيات الأدمن' END,
                CASE WHEN NOT guards.g_users_policy   THEN 'سياسة users (v13.71)' END,
                CASE WHEN NOT guards.g_old_policy_gone THEN 'users_select_all لم تُحذف!' END,
                CASE WHEN NOT guards.g_auth_created   THEN 'on_auth_user_created' END,
                CASE WHEN NOT guards.g_auth_deleted   THEN 'on_auth_user_deleted' END,
                CASE WHEN NOT guards.g_branch_cap     THEN 'سقف المواقع' END) END
        AS "٥ حراسات طوكيو التسع موجودة؟",
    CASE WHEN guards.g_v1375 THEN '✅ نعم' ELSE '❌ لا — طبّق migration_v13_75' END
        AS "٦ إصلاح v13.75 مطبَّق؟",
    CASE WHEN guards.g_branch_pkg THEN '✅ نعم' ELSE '⚠️ لا — طبّق migration_v13_67' END
        AS "٧ مواءمة المواقع مع الباقة (v13.67)؟"
FROM rls, sp, vw, tbl, guards;

-- ═══════════════════════════════════════════════════════════════════════════
-- هجوم محاكاة: هل يستطيع زائر بلا حساب الكتابة على بيانات التجار؟
-- (كل شيء داخل معاملة فرعية تُلغى — لا يتغيّر أي صف)
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE v_id text; v_before text; v_after text; v_verdict text; v_readable int;
BEGIN
    SELECT id, bio INTO v_id, v_before
      FROM public.users
     WHERE user_type <> 'buyer' AND deleted_at IS NULL LIMIT 1;

    IF v_id IS NULL THEN
        RAISE NOTICE '⚠️ لا يوجد تاجر لاختباره — تخطّي';
        RETURN;
    END IF;

    BEGIN
        SET LOCAL ROLE anon;
        SELECT count(*) INTO v_readable FROM public.sellers_public;
        UPDATE public.sellers_public SET bio = 'TAKI_PENTEST_MARKER' WHERE id = v_id;
        RESET ROLE;
        v_verdict := '🔴 خطر — الكتابة نجحت';
    EXCEPTION
        WHEN insufficient_privilege THEN RESET ROLE; v_verdict := '✅ صُدّ (permission denied)';
        WHEN OTHERS                THEN RESET ROLE; v_verdict := '✅ صُدّ (' || SQLSTATE || ')';
    END;

    SELECT bio INTO v_after FROM public.users WHERE id = v_id;

    RAISE NOTICE '════════════════════════════════════════════';
    RAISE NOTICE 'هجوم الزائر على دليل المتاجر : %', v_verdict;
    RAISE NOTICE 'الدليل ما زال يُقرأ للزائر   : % متجر', coalesce(v_readable, 0);
    RAISE NOTICE 'بيانات التاجر لم تتغيّر      : %',
        CASE WHEN v_after IS NOT DISTINCT FROM v_before THEN '✅ نعم' ELSE '🔴 لا' END;
    RAISE NOTICE '════════════════════════════════════════════';

    -- إلغاء كل ما سبق مهما كانت النتيجة
    RAISE EXCEPTION USING ERRCODE = 'query_canceled',
        MESSAGE = 'انتهى الفحص — أُلغيت المعاملة عمداً (صفر أثر). النتائج في تبويب Messages/Notices أعلاه.';
END $$;
