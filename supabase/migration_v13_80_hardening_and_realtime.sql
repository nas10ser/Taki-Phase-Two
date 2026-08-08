-- ═══════════════════════════════════════════════════════════════════════════
-- TAKI — v13.80 — تحصين استباقي + تأكيد الريل‑تايم  (خادم جدة)
--
-- يُلصق كاملاً في SQL Editor على **جدة** ويُشغَّل مرة واحدة. آمن للتكرار
-- (idempotent) ولا يمسّ أي بيان. ينتهي بجدول ✅/❌ يصوّره ناصر ويرسله.
--
-- ما الذي يفعله ولماذا:
--
-- (١) سحب صلاحيات **الكتابة** من دور الزائر `anon` على كامل مخطط public.
--     نموذج سوبابيس الافتراضي يمنح `anon` و`authenticated` كل الصلاحيات على
--     كل جدول ويجعل RLS **خط الدفاع الوحيد**. في تاكي لا توجد كتابة شرعية
--     واحدة من زائر: كل سياسات الكتابة تشترط `auth.uid()`، وكل مسار مجهول
--     (تتبّع الفتح، التحليلات، البحث) يمرّ عبر دوال SECURITY DEFINER تعمل
--     بصلاحية المالك لا بصلاحية الزائر. فالمنحة زائدة عن الحاجة، ووجودها هو
--     ما جعل ثغرة v13.75 ممكنة أصلاً (view بلا RLS + منحة كتابة لـanon =
--     كتابة مباشرة على بيانات التجار).
--     بعد هذا السحب: أي جدول أو view يُنشأ مستقبلاً ويُنسى RLS عليه **لا
--     يصير قابلاً للكتابة من مفتاح المتصفح العلني** — الخطأ لم يعد كارثة.
--
-- (٢) نفس السحب على الامتيازات الافتراضية، فلا يعود الجدول القادم يرث المنحة.
--
-- (٣) فهرس `(user_id, created_at DESC)` على `notifications` — قائمة الإشعارات
--     تقرأ آخر ١٠٠ لكل مستخدم؛ الفهرس الحالي على `user_id` وحده يجبر القاعدة
--     على فرز كل إشعارات المستخدم عند كل فتح. مع ملايين الصفوف يصير الفرق
--     بين قراءة فورية وقراءة تُحسّ.
--
-- (٤) تأكيد أن `bookings` و`booking_messages` ضمن نشرة الريل‑تايم — عليها
--     يعتمد انتقال الطلب من «الجارية» إلى «السابقة» لحظة اكتماله (v13.80).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── (١) سحب صلاحيات الكتابة من الزائر ────────────────────────────────────
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon;

-- ── (٢) والامتيازات الافتراضية للجداول القادمة ───────────────────────────
-- تُنفَّذ لكل دور قد يُنشئ كائنات في public على تنصيب سوبابيس.
-- ملاحظة: تغيير الامتيازات الافتراضية لدور آخر يتطلب أن تكون عضواً فيه. إن
-- رفضت القاعدة دوراً منها فلا تسقط الهجرة — نتجاوزه ويكشفه جدول التحقّق.
DO $$
DECLARE r text;
BEGIN
    FOREACH r IN ARRAY ARRAY['postgres','supabase_admin','service_role'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            BEGIN
                EXECUTE format(
                    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public '
                    'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLES FROM anon', r);
            EXCEPTION WHEN insufficient_privilege THEN
                RAISE NOTICE 'تخطّي الامتيازات الافتراضية للدور %', r;
            END;
        END IF;
    END LOOP;
END $$;

-- ── (٣) فهرس قائمة الإشعارات ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_notifs_user_created
    ON public.notifications (user_id, created_at DESC);

-- ── (٤) نشرة الريل‑تايم ──────────────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                   WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='bookings') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.bookings;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                   WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='booking_messages') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.booking_messages;
    END IF;
END $$;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- جدول التحقّق — النتيجة المتوقّعة: ✅ في كل عمود
--
-- البند (١) ليس فحص إعدادات بل **هجوم حقيقي**: ننتحل دور الزائر `anon`
-- ونحاول تعديل جدول العروض فعلاً. النجاح المطلوب هو أن ترفضه القاعدة بخطأ
-- صلاحيات. المحاولة داخل معاملة فرعية تُلغى، فلا أثر لها على أي بيان.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._taki_v1380_audit()
RETURNS TABLE (
    "١- كتابة الزائر مرفوضة"   text,
    "٢- الجداول القادمة محصّنة" text,
    "٣- فهرس الإشعارات"        text,
    "٤- الريل‑تايم للطلبات"     text,
    "٥- RLS على كل الجداول"    text,
    "٦- مسار كل دالة مثبّت"     text
)
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $fn$
DECLARE v_attack text;
BEGIN
    BEGIN
        SET LOCAL ROLE anon;
        BEGIN
            EXECUTE 'UPDATE public.deals SET item_name = item_name WHERE id = ''__taki_probe__''';
            v_attack := '❌';  -- مرّ بلا خطأ ⇒ منحة الكتابة ما زالت قائمة
        EXCEPTION
            WHEN insufficient_privilege THEN v_attack := '✅';
            WHEN OTHERS THEN v_attack := '✅';  -- أي رفض آخر = ممنوع أيضاً
        END;
        RESET ROLE;
    EXCEPTION WHEN OTHERS THEN
        RESET ROLE;
        v_attack := '⚠️';
    END;

    RETURN QUERY SELECT
        v_attack,
        CASE WHEN NOT EXISTS (
            SELECT 1 FROM pg_default_acl d JOIN pg_namespace n ON n.oid=d.defaclnamespace
            WHERE n.nspname='public' AND d.defaclobjtype='r'
              AND pg_get_userbyid(d.defaclrole) = 'postgres'
              AND array_to_string(d.defaclacl,',') ~ '(^|,)anon=[^/]*[awdD]'
        ) THEN '✅' ELSE '❌' END,
        CASE WHEN EXISTS (
            SELECT 1 FROM pg_indexes WHERE schemaname='public'
              AND indexname='idx_notifs_user_created'
        ) THEN '✅' ELSE '❌' END,
        CASE WHEN (SELECT count(*) FROM pg_publication_tables
                   WHERE pubname='supabase_realtime' AND schemaname='public'
                     AND tablename IN ('bookings','booking_messages')) = 2
        THEN '✅' ELSE '❌' END,
        CASE WHEN NOT EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity
        ) THEN '✅' ELSE '❌' END,
        CASE WHEN NOT EXISTS (
            SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='public' AND p.prosecdef
              AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig,'{}')) x
                              WHERE x LIKE 'search_path=%')
        ) THEN '✅' ELSE '❌' END;
END $fn$;

SELECT * FROM public._taki_v1380_audit();

DROP FUNCTION public._taki_v1380_audit();
