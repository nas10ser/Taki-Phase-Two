-- ═══════════════════════════════════════════════════════════════════════════
-- TAKI — أي خادم أنا؟ + تحقّق دقيق من v13.80–82
--
-- سبب هذا الملف: نتيجة الفحص السابق أعطت «حسابات = ٤» و«رسائل = ١٠٧» —
-- وهذان **رقما مختبر طوكيو بالضبط**. والخانة الحمراء فيه كانت **خطأ في
-- فحصي أنا** لا في الكود: كنت أبحث عن غياب عبارة `FOR UPDATE` من الدالة،
-- فطابقَتْها كلمةٌ داخل **تعليق** كتبته بنفسي («قراءة بلا FOR UPDATE»).
-- الفحص هنا يعتمد على **علامات إيجابية** ويتجاهل أسطر التعليقات.
--
-- عمود «الخادم»:
--     TAKI_LAB_TOKYO_MARKER_v1382  ⇒ أنت على **طوكيو (المختبر)** — الهجرات
--                                    لم تصل الإنتاج، أعد تشغيل الملفات على جدة.
--     فارغ / أي قيمة أخرى          ⇒ أنت على **جدة (الإنتاج)** ✅
-- ═══════════════════════════════════════════════════════════════════════════

SELECT
    COALESCE(obj_description('public'::regnamespace, 'pg_namespace'), '— جدة —') AS "الخادم",
    (SELECT count(*) FROM public.users)    AS "حسابات",
    (SELECT count(*) FROM public.deals)    AS "عروض",
    (SELECT count(*) FROM public.bookings) AS "حجوزات",

    CASE WHEN NOT EXISTS (
        SELECT 1 FROM information_schema.role_table_grants
        WHERE grantee='anon' AND table_schema='public'
          AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')
    ) THEN '✅' ELSE '❌' END AS "٨٠",

    CASE WHEN EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='adjust_deal_quantity'
          AND pg_get_functiondef(p.oid) LIKE '%quantity >= v_need%'
    ) AND EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='tr_reserve_booking_stock'
          AND pg_get_functiondef(p.oid) LIKE '%SET LOCAL lock_timeout%'
          -- «لا قفل» تُفحص على أسطر الكود وحدها، لا على التعليقات
          AND NOT EXISTS (
              SELECT 1 FROM regexp_split_to_table(pg_get_functiondef(p.oid), E'\n') AS ln
              WHERE ln !~ '^\s*--' AND ln ILIKE '%FOR UPDATE%'
          )
    ) THEN '✅' ELSE '❌' END AS "٨١",

    CASE WHEN EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='booking_messages'
          AND column_name='recipient_id'
    ) AND EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname='tr_booking_message_recipient' AND NOT tgisinternal
    ) THEN '✅' ELSE '❌' END AS "٨٢";
