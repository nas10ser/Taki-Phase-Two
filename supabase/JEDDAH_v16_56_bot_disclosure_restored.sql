-- ════════════════════════════════════════════════════════════════════════════
-- v16.56 — فتحُ قفل قناتَي المراسلة بعد عودة الإفصاح فعلاً
-- ════════════════════════════════════════════════════════════════════════════
-- بلاغُ ناصر (٢٤ نوفمبر ٢٠٢٦، بصورة): تفعيلُ بوتَي تيليجرام وواتساب يُظهر
-- `BOT_CHANNEL_NOT_DISCLOSED` — رمزاً إنجليزياً خاماً بزرّ «موافق».
--
-- ── التشخيص: ليس عطلاً بل قفلاً وُضع عمداً ────────────────────────────────
-- في v15.80 (٨ نوفمبر) أُسقط إفصاحُ القناتين من سياسة الخصوصية بقرار المالك،
-- ومُحيت بياناتُ الربط. ولئلّا تعود المعالجةُ بلا إفصاح، وُضع
-- `tr_guard_bot_channel_disclosure` على `platform_settings` يرفض تشغيلَ أيّ
-- قناةٍ حتى يُعاد. والمشغّلُ يحمل الخطواتِ كاملةً في `DETAIL` — **لكنّ
-- PostgREST لا يُمرّره إلى `error.message`**، فلا يصل الشاشةَ أبداً.
--
-- ── وما سبق هذه الهجرة — ولا تصحّ بدونه ───────────────────────────────────
-- ① **الإفصاحُ عاد إلى النصّ**: المواضعُ السبعةُ في `src/pages/legal/Privacy.tsx`
--    (نطاقُ السياسة · ما نجمعه · مصادرُ الجمع · النقلُ خارج المملكة — عربيّةً
--    وإنجليزيّة) ووصفُ التجّار في `index.html`. وعُكست من الـdiff الأصليّ
--    نفسِه لا بإعادة كتابةٍ باليد.
-- ② **ورُفع `LEGAL_VERSION`** إلى `2026-11-24` فيُسأل كلُّ مستخدمٍ موافقةً
--    جديدة — نصٌّ تغيّر جوهرياً لا تُجزئ عنه موافقةٌ على نصٍّ سابق.
-- ③ **وتُتُبّع كلُّ وعدٍ في النصّ إلى الكود الذي ينفّذه**: `/logout` ·
--    «تسجيل الخروج» في واتساب · رمزُ الربط المؤقّت (`bot_create_link_token`) ·
--    مشاركةُ الموقع · اللغةُ المفضّلة. وحارسٌ في `npm test` يحفظ ذلك.
-- ④ **والنصُّ وصل الإنتاجَ فعلاً** — يُتحقَّق منه قبل تشغيل هذه الهجرة لا
--    بعدها: مفتاحٌ يقول «أُفصح» ونصٌّ لم يُنشر هو نفسُ العيب الذي يحرسه.
--
-- 🪤 **ولا يُبنى لهذا المفتاح زرٌّ في لوحة الإدارة** عمداً: زرٌّ يرفع
--    «أُفصح» بضغطةٍ يُعيد البابَ الخلفيَّ الذي أُغلق في v15.80 — إذ يصير
--    بالإمكان تشغيلُ القناة بلا أن يَلمس أحدٌ نصَّ السياسة. ويبقى فتحُه
--    هجرةً تُكتب ويُقاس ما قبلها.
--
-- 🪤 ولا تُشغَّل القناتان هنا: هذه الهجرةُ تفتح القفلَ وحده، والتشغيلُ يبقى
--    قرارَ ناصر بزرّه في «لوحة المدير ← الأدوات».
-- ════════════════════════════════════════════════════════════════════════════

-- ── ⓪ حارسُ الخادم: لا تُنفَّذ على المختبر (طوكيو) ─────────────────────────
DO $guard$
BEGIN
    IF obj_description('public'::regnamespace, 'pg_namespace')
       = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
        RAISE EXCEPTION 'هذه هجرةُ إنتاج — الخادمُ أمامها هو المختبر (طوكيو). أوقِف.';
    END IF;
END $guard$;

-- ── ① شرطٌ مسبقٌ يُفشل الهجرةَ لا يُحذّر: المشغّلُ يجب أن يكون قائماً ──────
-- 🪤 فتحُ القفل على خادمٍ بلا حارسٍ لا معنى له، ويُخفي أن الحارسَ سقط.
DO $pre$
DECLARE v_n integer;
BEGIN
    SELECT count(*) INTO v_n FROM pg_trigger
     WHERE tgrelid = 'public.platform_settings'::regclass
       AND NOT tgisinternal
       AND tgfoid = 'public.tr_guard_bot_channel_disclosure'::regproc;
    IF v_n = 0 THEN
        RAISE EXCEPTION '❌ حارسُ الإفصاح غيرُ مربوطٍ على `platform_settings` — أوقِف. فتحُ قفلٍ لا حارسَ له لا معنى له.';
    END IF;
END $pre$;

-- ── ② فتحُ القفل ───────────────────────────────────────────────────────────
INSERT INTO public.platform_settings (key, value, description, updated_at)
VALUES ('bot_channels_disclosed', 'true'::jsonb,
        'إفصاحُ قناتَي تيليجرام وواتساب موجودٌ في سياسة الخصوصية (أُعيد في v16.56). يحرسه tr_guard_bot_channel_disclosure.',
        now())
ON CONFLICT (key) DO UPDATE
   SET value = 'true'::jsonb,
       description = EXCLUDED.description,
       updated_at = now();

-- ════════════════════════════════════════════════════════════════════════════
-- ③ التحقّق — `DO` يرفع استثناءً، ويُجرَّب **السلوكُ** لا القيمةُ وحدها
-- ════════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE v_was boolean; v_err text; v_ok boolean := false;
BEGIN
    -- (أ) القيمةُ صارت true
    SELECT value::boolean INTO v_was FROM public.platform_settings
     WHERE key = 'bot_channels_disclosed';
    IF v_was IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'الفحص ①: القفلُ لم يُفتح (القيمة = %)', v_was;
    END IF;

    -- (ب) 🔴 والسلوكُ يُجرَّب فعلاً: تشغيلُ تيليجرام يمرّ الآن — ثمّ يُعاد كما كان.
    --     فحصُ القيمة وحده لا يُثبت أن المشغّلَ يقرؤها (وهو ما يقرؤه فعلاً).
    BEGIN
        UPDATE public.platform_settings SET value = 'true'::jsonb
         WHERE key = 'telegram_bot_enabled';
        v_ok := true;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        RAISE EXCEPTION 'الفحص ②: القفلُ ما زال يمنع التشغيل — %', v_err;
    END;
    IF NOT v_ok THEN RAISE EXCEPTION 'الفحص ②ب: لم يقع التشغيلُ التجريبيّ'; END IF;
    -- يُعاد الإطفاءُ فوراً: التشغيلُ قرارُ ناصر بزرّه لا أثرٌ جانبيٌّ لهجرة.
    UPDATE public.platform_settings SET value = 'false'::jsonb
     WHERE key = 'telegram_bot_enabled';

    -- (ج) والحارسُ ما زال يعمل في الاتجاه الآخر: لو أُغلق القفل لمُنع التشغيل.
    UPDATE public.platform_settings SET value = 'false'::jsonb
     WHERE key = 'bot_channels_disclosed';
    BEGIN
        UPDATE public.platform_settings SET value = 'true'::jsonb
         WHERE key = 'telegram_bot_enabled';
        RAISE EXCEPTION 'الفحص ③: الحارسُ لم يمنع التشغيلَ والقفلُ مغلق — الحارسُ عاطل';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        IF v_err IS DISTINCT FROM 'BOT_CHANNEL_NOT_DISCLOSED' THEN
            RAISE EXCEPTION 'الفحص ③ب: مُنع لسببٍ آخر — %', v_err;
        END IF;
    END;
    -- وتُعاد الحالةُ المقصودة
    UPDATE public.platform_settings SET value = 'true'::jsonb
     WHERE key = 'bot_channels_disclosed';
    UPDATE public.platform_settings SET value = 'false'::jsonb
     WHERE key = 'telegram_bot_enabled';

    RAISE NOTICE '✅ v16.56 — القفلُ مفتوحٌ والحارسُ يعمل في الاتجاهين';
END $verify$;

SELECT 'الإفصاح'        AS "البند", (SELECT value::text FROM public.platform_settings WHERE key='bot_channels_disclosed') AS "القيمة"
UNION ALL SELECT 'بوت تيليجرام', (SELECT value::text FROM public.platform_settings WHERE key='telegram_bot_enabled')
UNION ALL SELECT 'بوت واتساب',   (SELECT value::text FROM public.platform_settings WHERE key='whatsapp_bot_enabled');
