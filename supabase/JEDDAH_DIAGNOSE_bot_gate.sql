-- ═══════════════════════════════════════════════════════════════════════════
-- TAKI — تشخيص بوّابة البوت  (خادم جدة)  —  للقراءة فقط، لا يغيّر شيئاً
--
-- الخلفية: أثبت فحص حيّ من الإنترنت (٢٠٢٦-٠٨-٢٧) أن دوال `bot_*` تستجيب
-- لأي شخص يملك مفتاح المتصفح العلني **حتى مع سرّ بوّابة خاطئ**:
--
--     curl -H 'x-bot-secret: deliberately-wrong'  …/rpc/bot_geo_regions
--     ⇒ HTTP 200 + قائمة المناطق كاملة
--
--     …/rpc/bot_booking_contact  {"p_telegram_id":"123456789", …}
--     ⇒ {"error":"not_linked"}   ← هذا ردّ **جسم الدالة** (رقم غير مرتبط)،
--                                   لا ردّ البوّابة. أي أن الدالة اشتغلت.
--
-- المعنى: الحاجز الوحيد المتبقّي هو «هل رقم تيليجرام مرتبط بحساب؟» — وأرقام
-- تيليجرام ليست سرّاً. من يعرف رقم مستخدمٍ يستطيع أن ينتحل شخصيته على كامل
-- سطح البوت: يقرأ حجوزاته وبيانات تواصله، ويكتب ويلغي بالنيابة عنه.
--
-- التصميم المقصود (تعليق مكتوب في server/bot.js سطر ٧٨):
--     «لا يستطيع أحد آخر يملك المفتاح العلني استدعاءها — انتحال/سحب بيانات»
-- فالحماية مُصمَّمة وموجودة في النيّة، لكنها **لا تُنفَّذ** على خادم جدة.
--
-- قبل الإصلاح يجب أن نعرف أيّ العطبين هو: هل البوّابة لا تُنادى أصلاً من
-- أجسام الدوال؟ أم تُنادى لكنها تُرجع «مسموح» لأن السرّ غير مضبوط على جدة؟
-- الفرق يغيّر الإصلاح كلياً، والتخمين هنا يعني إسقاط البوت أو ترك الثغرة.
--
-- الاستعمال: الصقه كاملاً في SQL Editor على جدة ← Run ← صوّر النتيجة.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── ١) هل حارس البوّابة موجود؟ وما نصّه بالضبط؟ ─────────────────────────
SELECT
    CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                       WHERE n.nspname='public' AND p.proname='_bot_gate_ok')
         THEN '✅ موجود' ELSE '❌ مفقود' END                       AS "١· حارس البوّابة",
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname LIKE 'bot\_%')        AS "٢· عدد دوال البوت",
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname LIKE 'bot\_%'
        AND pg_get_functiondef(p.oid) ILIKE '%\_bot\_gate\_ok%')   AS "٣· منها يستدعي الحارس",
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname LIKE 'bot\_%'
        AND has_function_privilege('anon', p.oid, 'EXECUTE'))      AS "٤· متاحة للزائر";

-- ── ٢) نصّ الحارس حرفياً — منه نعرف أين يبحث عن السرّ ───────────────────
SELECT COALESCE(
    (SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='_bot_gate_ok' LIMIT 1),
    '— الحارس غير موجود إطلاقاً —') AS "نصّ حارس البوّابة";

-- ── ٣) الدوال المكشوفة: تعمل للزائر بلا استدعاء الحارس ─────────────────
--     هذه بالضبط هي سطح الانتحال.
SELECT p.proname AS "دالة مكشوفة", pg_get_function_identity_arguments(p.oid) AS "معاملاتها"
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname LIKE 'bot\_%'
   AND has_function_privilege('anon', p.oid, 'EXECUTE')
   AND pg_get_functiondef(p.oid) NOT ILIKE '%\_bot\_gate\_ok%'
 ORDER BY 1;

-- ── ٤) هل السرّ مضبوط على هذا الخادم؟ (لا يطبع السرّ — فقط هل هو موجود) ─
SELECT
    CASE WHEN COALESCE(NULLIF(current_setting('app.bot_gateway_secret', true), ''), '') <> ''
         THEN '✅ مضبوط كإعداد قاعدة' ELSE '— غير مضبوط كإعداد قاعدة —' END AS "app.bot_gateway_secret",
    CASE WHEN EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                       WHERE n.nspname='public' AND c.relname='platform_settings')
         THEN (SELECT CASE WHEN count(*) > 0 THEN '✅ يوجد صفّ للسرّ في platform_settings'
                           ELSE '— لا صفّ للسرّ في platform_settings —' END
                 FROM public.platform_settings
                WHERE key ILIKE '%bot%secret%' OR key ILIKE '%gateway%')
         ELSE '— لا جدول platform_settings —' END AS "مصدر بديل للسرّ";
