-- ═══════════════════════════════════════════════════════════════════════════
-- v13.75 — فحص أمني شامل لخادم جدة
--
-- الغرض: الإجابة على سؤالين بالأرقام لا بالثقة —
--   (أ) هل انتقلت كل حراسات الأمان التي بنيناها على مدى أشهر إلى جدة؟
--   (ب) هل بقيت ثغرة مفتوحة الآن؟
--
-- الاستعمال: الصقه كاملاً في SQL Editor على خادم جدة واضغط Run.
--            النتيجة **جدول واحد** فيه كل الأجوبة. المتوقع: ✅ في كل خانة.
--
-- v13.75-b — أُعيدت كتابة الفحص ليعود كصفّ نتائج بدل `RAISE NOTICE`: النسخة
-- الأولى كانت تطبع النتائج في «Messages/Notices» و**سوبابيس Studio لا يملك هذا
-- التبويب**، فكان الفحص ينتهي برسالة إلغاء حمراء بلا نتيجة مرئية.
--
-- هجوم المحاكاة يجري داخل معاملة فرعية **تُلغى دائماً** — صفر أثر على البيانات
-- (يُتحقَّق من ذلك في العمود الأخير نفسه).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION pg_temp.taki_security_audit()
RETURNS TABLE (
    "١ RLS على كل جدول؟"              text,
    "٢ مسار البحث مثبَّت في كل دالة؟"  text,
    "٣ لا view يقبل كتابة الزائر؟"     text,
    "٤ لا جدول مكشوف بلا RLS؟"         text,
    "٥ حراسات طوكيو التسع؟"            text,
    "٦ إصلاح v13.75؟"                  text,
    "٧ مواءمة الباقة v13.67؟"          text,
    "٨ هجوم زائر على بيانات التجار"    text,
    "٩ البيانات لم تتغيّر بعد الهجوم؟" text
)
LANGUAGE plpgsql
AS $audit$
DECLARE
    v_no_rls int; v_unpinned int; v_wr_views int; v_exposed int;
    v_id text; v_before text; v_after text; v_attack text; v_missing text;
    g_admin bool; g_gate bool; g_rate bool; g_perms bool; g_pol bool;
    g_oldpol bool; g_ac bool; g_ad bool; g_cap bool; g_1375 bool; g_1367 bool;
BEGIN
    -- ── ١) RLS على كل جدول ────────────────────────────────────────────────
    SELECT count(*) INTO v_no_rls
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;

    -- ── ٢) كل دالة SECURITY DEFINER بمسار بحث مثبَّت (v10.51 / v11.43) ────
    SELECT count(*) INTO v_unpinned
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prosecdef
       AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) cfg
                        WHERE cfg LIKE 'search_path=%');

    -- ── ٣) 🔴 فخّ v13.75: view في public يقبل كتابة anon/authenticated ────
    SELECT count(*) INTO v_wr_views
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
       AND (has_table_privilege('anon',          c.oid, 'INSERT')
         OR has_table_privilege('anon',          c.oid, 'UPDATE')
         OR has_table_privilege('anon',          c.oid, 'DELETE')
         OR has_table_privilege('authenticated', c.oid, 'INSERT')
         OR has_table_privilege('authenticated', c.oid, 'UPDATE')
         OR has_table_privilege('authenticated', c.oid, 'DELETE'));

    -- ── ٤) جدول بلا RLS ومكشوف للزائر (نفس فئة الخطر) ─────────────────────
    SELECT count(*) INTO v_exposed
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
       AND (has_table_privilege('anon', c.oid, 'SELECT')
         OR has_table_privilege('anon', c.oid, 'UPDATE')
         OR has_table_privilege('anon', c.oid, 'INSERT')
         OR has_table_privilege('anon', c.oid, 'DELETE'));

    -- ── ٥) الحراسات المُسمّاة من كل هجرة أمنية سابقة ───────────────────────
    g_admin  := EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                         WHERE n.nspname='public' AND p.proname='is_admin');
    g_gate   := EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                         WHERE n.nspname='public' AND p.proname='_bot_gate_ok');
    g_rate   := EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                         WHERE n.nspname='public' AND c.relname='rate_limit_counters');
    g_perms  := EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                         WHERE n.nspname='public' AND c.relname='admin_rpc_permissions');
    g_pol    := EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                         AND policyname='users_select_own_or_admin');
    g_oldpol := NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                             AND policyname='users_select_all');
    g_ac     := EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgname='on_auth_user_created');
    g_ad     := EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgname='on_auth_user_deleted');
    g_cap    := EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgname='tr_enforce_branch_cap');
    g_1375   := EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgname='tr_sellers_public_readonly');
    g_1367   := EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgname='tr_branch_cap_on_package_change');

    v_missing := concat_ws(' · ',
        CASE WHEN NOT g_admin  THEN 'is_admin()'            END,
        CASE WHEN NOT g_gate   THEN 'بوابة البوت'           END,
        CASE WHEN NOT g_rate   THEN 'تحديد المعدّل'          END,
        CASE WHEN NOT g_perms  THEN 'صلاحيات الأدمن'         END,
        CASE WHEN NOT g_pol    THEN 'سياسة users v13.71'    END,
        CASE WHEN NOT g_oldpol THEN 'users_select_all باقية!' END,
        CASE WHEN NOT g_ac     THEN 'on_auth_user_created'  END,
        CASE WHEN NOT g_ad     THEN 'on_auth_user_deleted'  END,
        CASE WHEN NOT g_cap    THEN 'سقف المواقع'            END);

    -- ── ٨) هجوم زائر حقيقي داخل معاملة فرعية تُلغى دائماً ──────────────────
    SELECT u.id, u.bio INTO v_id, v_before
      FROM public.users u
     WHERE u.user_type <> 'buyer' AND u.deleted_at IS NULL LIMIT 1;

    IF v_id IS NULL THEN
        v_attack := '⚠️ لا يوجد تاجر لاختباره';
    ELSE
        BEGIN
            SET LOCAL ROLE anon;
            UPDATE public.sellers_public SET bio = 'TAKI_PENTEST_MARKER' WHERE id = v_id;
            RESET ROLE;
            v_attack := '🔴 خطر — الكتابة نجحت';
            -- الكتابة وقعت: نُلغي هذه المعاملة الفرعية عمداً حتى لا يبقى أثر.
            RAISE EXCEPTION 'taki_rollback' USING ERRCODE = 'query_canceled';
        EXCEPTION
            WHEN query_canceled        THEN RESET ROLE;   -- إشارة الإلغاء منّا
            WHEN insufficient_privilege THEN RESET ROLE; v_attack := '✅ صُدّ (permission denied)';
            WHEN OTHERS                 THEN RESET ROLE; v_attack := '✅ صُدّ (' || SQLSTATE || ')';
        END;

        SELECT u.bio INTO v_after FROM public.users u WHERE u.id = v_id;
    END IF;

    RETURN QUERY SELECT
        CASE WHEN v_no_rls   = 0 THEN '✅ نعم' ELSE '❌ لا — ' || v_no_rls   || ' جدول'  END,
        CASE WHEN v_unpinned = 0 THEN '✅ نعم' ELSE '❌ لا — ' || v_unpinned || ' دالة'  END,
        CASE WHEN v_wr_views = 0 THEN '✅ نعم' ELSE '🔴 لا — ' || v_wr_views || ' view!' END,
        CASE WHEN v_exposed  = 0 THEN '✅ نعم' ELSE '🔴 لا — ' || v_exposed  || ' جدول' END,
        CASE WHEN v_missing = '' THEN '✅ نعم (٩/٩)' ELSE '❌ ناقص: ' || v_missing END,
        CASE WHEN g_1375 THEN '✅ نعم' ELSE '❌ لا — طبّق migration_v13_75' END,
        CASE WHEN g_1367 THEN '✅ نعم' ELSE '⚠️ لا — طبّق migration_v13_67' END,
        coalesce(v_attack, '—'),
        CASE WHEN v_id IS NULL THEN '—'
             WHEN v_after IS NOT DISTINCT FROM v_before THEN '✅ نعم'
             ELSE '🔴 لا' END;
END;
$audit$;

SELECT * FROM pg_temp.taki_security_audit();
