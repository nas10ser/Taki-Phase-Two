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

-- ── ٤) مصدر السرّ ومفتاح الإيقاف — الاشتباه الأول ───────────────────────
--     الحارس يقارن ترويسة `x-bot-secret` بصفّ `app_secrets.bot_gateway_secret`،
--     ويُرجع «مسموح» دائماً حين يكون `app_secrets.bot_gate_enforced` = '0'.
--     فلو ضاع أيّ من الصفّين في الهجرة إلى جدة، سقطت البوّابة **بصمت**.
--     نستعلم بـSQL ديناميكي داخل دالّة مؤقّتة، فغياب الجدول يُبلَّغ عنه ولا
--     يُسقط الفحص بخطأ. ولا يُطبع السرّ نفسه أبداً — فقط هل هو موجود وغير فارغ.
CREATE OR REPLACE FUNCTION pg_temp._taki_gate_src()
RETURNS TABLE ("جدول app_secrets" text, "صفّ السرّ" text, "مفتاح الإنفاذ" text)
LANGUAGE plpgsql AS $fn$
DECLARE v_sec text; v_enf text;
BEGIN
    IF to_regclass('public.app_secrets') IS NULL THEN
        RETURN QUERY SELECT '❌ غير موجود'::text,
                            '— لا يمكن الفحص —'::text,
                            '— لا يمكن الفحص —'::text;
        RETURN;
    END IF;
    BEGIN
        EXECUTE 'SELECT value FROM public.app_secrets WHERE key = $1'
           INTO v_sec USING 'bot_gateway_secret';
        EXECUTE 'SELECT value FROM public.app_secrets WHERE key = $1'
           INTO v_enf USING 'bot_gate_enforced';
    EXCEPTION WHEN undefined_column THEN
        RETURN QUERY SELECT '⚠️ موجود بأعمدة مختلفة'::text,
                            '— راجع بنيته —'::text, '— راجع بنيته —'::text;
        RETURN;
    END;
    RETURN QUERY SELECT
        '✅ موجود'::text,
        CASE WHEN COALESCE(v_sec,'') <> '' THEN '✅ مضبوط'
             ELSE '❌ مفقود أو فارغ ⇒ البوّابة بلا سرّ تقارن به' END,
        CASE WHEN v_enf IS NULL THEN '⚠️ الصفّ مفقود — راجع سلوك الحارس عند NULL'
             WHEN v_enf = '1'   THEN '✅ مفعّل (1)'
             ELSE '🚨 معطّل (' || v_enf || ') ⇒ الحارس يُمرّر الجميع' END;
END $fn$;

SELECT * FROM pg_temp._taki_gate_src();

-- ── ٥) هل تُنادى البوّابة من قلب الهوية `_bot_uid`؟ ─────────────────────
--     هو الذي يغطّي ~٥٠ دالّة؛ لو لم يستدعِ الحارس سقط سطح البوت كلّه.
SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                      WHERE n.nspname='public' AND p.proname='_bot_uid')
        THEN '❌ _bot_uid غير موجود'
    WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='_bot_uid'
                    AND pg_get_functiondef(p.oid) ILIKE '%\_bot\_gate\_ok%')
        THEN '✅ _bot_uid يستدعي الحارس'
    ELSE '🚨 _bot_uid لا يستدعي الحارس ⇒ سطح البوت كله بلا حماية'
END AS "٥· الحارس داخل _bot_uid";
