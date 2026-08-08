-- ═══════════════════════════════════════════════════════════════════════════
-- TAKI — تحقّق مختصر بعد v13.80–82  (سطر واحد، سهل التصوير)
--
-- شغّله على **جدة** وصوّر الصفّ الواحد الناتج. عمودا «حسابات» و«رسائل»
-- يكشفان أي خادم شغّلتَه فعلاً (أرقام جدة الحقيقية ≠ أرقام مختبر طوكيو).
-- ═══════════════════════════════════════════════════════════════════════════

SELECT
    (SELECT count(*) FROM public.users)            AS "حسابات",
    (SELECT count(*) FROM public.booking_messages) AS "رسائل",

    CASE WHEN NOT EXISTS (
        SELECT 1 FROM information_schema.role_table_grants
        WHERE grantee='anon' AND table_schema='public'
          AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')
    ) THEN '✅' ELSE '❌' END AS "٨٠ حماية",

    CASE WHEN EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='adjust_deal_quantity'
          AND pg_get_functiondef(p.oid) LIKE '%quantity >= v_need%'
    ) THEN '✅' ELSE '❌' END AS "٨١ ذرّية",

    CASE WHEN EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='tr_reserve_booking_stock'
          AND pg_get_functiondef(p.oid) NOT LIKE '%FOR UPDATE%'
    ) THEN '✅' ELSE '❌' END AS "٨١ بلا طابور",

    CASE WHEN EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='booking_messages'
          AND column_name='recipient_id'
    ) THEN '✅' ELSE '❌' END AS "٨٢ المستلم";
