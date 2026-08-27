-- ═══════════════════════════════════════════════════════════════════════════
-- TAKI — v13.84 — سدّ آخر ثغرة في سطح البوت: تخصيص bot_get_deal  (خادم جدة)
--
-- ما الثغرة: `bot_get_deal(p_deal_id, p_telegram_id)` كانت الدالّة **الوحيدة**
-- من ٧٩ دالّة متاحة للزائر التي تأخذ هويّة مستخدم ولا تمرّ بأيّ من طبقتَي
-- الحماية (لا تستدعي `_bot_gate_ok()` ولا `_bot_uid()`). أُثبت ذلك على جدة:
--     محميّة ٦٤ · 🚨 مكشوفة وتأخذ هويّة ١ · عامة مقصودة ١٤
--
-- الأثر الحقيقي — بلا تهويل: بيانات العرض نفسها **عامة أصلاً**. المُسرَّب هو
-- عَلَمان فقط: هل هذا المستخدم يتابع المتجر؟ وهل حظره؟ فمن يعرف رقم تيليجرام
-- شخصٍ كان يستطيع معرفة ذلك. لا بيانات شخصية، ولا حجوزات، ولا كتابة.
-- خطورة منخفضة — لكنها تُسدّ لأن «منخفض» ليس «صفر».
--
-- الإصلاح: شرط واحد. فرع التخصيص لا يعمل إلا خلف بوّابة البوت:
--     IF p_telegram_id IS NOT NULL  →  IF p_telegram_id IS NOT NULL AND _bot_gate_ok()
-- وحين لا تُستوفى البوّابة يعود العرض كاملاً و`following`/`blocked` = false.
--
-- لماذا لا يكسر البوت: مناداتا الدالّة الوحيدتان في `server/bot.js` و
-- `server/flows/whatsapp.js` تمرّان بغلاف `rpc()` الذي يرسل `x-bot-secret`
-- في كل طلب، وواتساب تمرّر `p_telegram_id: null` فلا تدخل الفرع أصلاً. ولا
-- يناديها الموقع ولا الـMini App إطلاقاً (فُحص المصدر كلّه).
--
-- لماذا نُرقّع النصّ الحيّ بدل إعادة كتابة الدالّة: إعادة كتابتها تعني نسخ
-- جسمها من مكان آخر، وأي فارق بين النسختين يُكتب فوق الحيّة بصمت. هنا نقرأ
-- **تعريفها الفعلي على هذا الخادم** ونغيّر فيه شرطاً واحداً، ونرفض التنفيذ
-- إن لم يكن موضع الشرط واحداً بالضبط.
--
-- آمن للتكرار: تشغيلٌ ثانٍ يكتشف الترقيع ويخرج بلا تغيير (جُرِّب: البصمة
-- بقيت نفسها f55b0ada… بعد تشغيلين).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── حارس: يرفض التنفيذ على مختبر طوكيو ──────────────────────────────────
DO $guard$
BEGIN
    IF COALESCE(obj_description('public'::regnamespace, 'pg_namespace'), '')
       LIKE '%TAKI_LAB_TOKYO%' THEN
        RAISE EXCEPTION 'توقّف: هذا مختبر طوكيو لا خادم جدة. لا تُطبَّق الهجرات هنا.';
    END IF;
END $guard$;

BEGIN;

DO $mig$
DECLARE v_src text; v_new text; v_n int;
BEGIN
    SELECT pg_get_functiondef(p.oid) INTO v_src
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'bot_get_deal';

    IF v_src IS NULL THEN
        RAISE EXCEPTION 'bot_get_deal غير موجودة على هذا الخادم — أُلغيت الهجرة';
    END IF;

    -- مطبَّقة سابقاً؟ اخرج بلا لمس شيء.
    IF position('_bot_gate_ok' in v_src) > 0 THEN
        RAISE NOTICE 'مطبَّقة سابقاً — لا تغيير';
        RETURN;
    END IF;

    -- موضع الشرط يجب أن يكون واحداً بالضبط، وإلا فالجسم ليس ما نتوقّعه.
    v_n := (length(v_src) - length(replace(v_src, 'IF p_telegram_id IS NOT NULL THEN', '')))
           / length('IF p_telegram_id IS NOT NULL THEN');
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'مواضع الشرط = % (المتوقّع ١) — أُلغيت الهجرة بلا أي تغيير', v_n;
    END IF;

    v_new := replace(v_src,
        'IF p_telegram_id IS NOT NULL THEN',
        'IF p_telegram_id IS NOT NULL AND public._bot_gate_ok() THEN');

    EXECUTE v_new;
    RAISE NOTICE 'سُدّت: تخصيص bot_get_deal صار خلف بوّابة البوت';
END $mig$;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- التحقّق — المتوقّع: اسم الخادم «جدة»، ثم ✅، ثم صفر مكشوفة
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
    CASE WHEN COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'') LIKE '%TAKI_LAB_TOKYO%'
         THEN '⚠️ مختبر طوكيو' ELSE '🇸🇦 خادم جدة' END AS "الخادم",
    CASE WHEN position('_bot_gate_ok' in
            (SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND p.proname='bot_get_deal')) > 0
         THEN '✅ bot_get_deal محميّة' ELSE '❌ لم تُطبَّق' END AS "الإصلاح",
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname='public' AND p.proname LIKE 'bot\_%'
        AND has_function_privilege('anon', p.oid, 'EXECUTE')
        AND pg_get_functiondef(p.oid) NOT ILIKE '%\_bot\_gate\_ok%'
        AND pg_get_functiondef(p.oid) NOT ILIKE '%\_bot\_uid%'
        AND (pg_get_function_identity_arguments(p.oid) ILIKE '%p\_telegram\_id%'
          OR pg_get_function_identity_arguments(p.oid) ILIKE '%p\_whatsapp\_id%')
    ) AS "مكشوفة وتأخذ هويّة (المتوقّع ٠)";
