-- ════════════════════════════════════════════════════════════════════════
-- TAKI · v15.80 — قناتا المراسلة تُطفآن إطفاءً **متّسقاً**: بلا بيانات، وبلا
--                 بابٍ خلفيٍّ يُشغّلهما بلا إفصاح
--
-- تُشغَّل على **جدة (الإنتاج)** بالدور `supabase_admin`. آمنةٌ للتكرار،
-- وكلُّها داخل معاملةٍ واحدة (لا `CONCURRENTLY` ولا `ALTER TYPE`).
--
-- ───────────────────────── لماذا، ومقيساً ─────────────────────────
-- قرارُ ناصر (٨ نوفمبر ٢٠٢٦): «احذف تيليجرام وواتساب من سياسة الخصوصية لأني
-- لن أستخدمهما في البداية». وأُزيلت المواضعُ السبعةُ من النصّ فعلاً
-- (`src/pages/legal/Privacy.tsx` + وصفُ التجّار في `index.html`).
--
-- 🔴 لكنّ إسقاطَ الإفصاح وحده **يَقلب العيبَ ولا يُصلحه**. قِيس قبل هذه
--    الهجرة على جدة:
--      • حسابان من ستّة يحملان `telegram_id` و`telegram_chat_id`
--      • ١٣ حجزاً من قناةٍ غير الويب
--      • `telegram_bot_enabled=false` · `whatsapp_bot_enabled=false`
--      • صفرُ رمزِ ربطٍ قائم
--    أي أنّ المعالجةَ **وقعت** وأثرُها باقٍ. ووثيقةٌ لا تذكر بياناً نحفظه
--    هي نفسُ خطأِ وثيقةٍ تَعِد بما لا نفعله — في الاتجاه المعاكس. فالاتّساقُ
--    يقتضي أمرين معاً: يُحذف النصُّ **وتُمحى البيانات**.
--
-- 🪤 والخطرُ الذي يبقى بعدهما: يومَ يُشغّل ناصرُ القناةَ (وهو قرارٌ مُرجَّح)
--    تعود المعالجةُ **بلا إفصاحٍ في الوثيقة**، ولا شيءَ يُنبّه. والتعليقُ لا
--    يحرس. فالحارسُ مشغّلٌ عند **مفتاح التشغيل نفسِه**: لا يُفتح إلّا بإقرارٍ
--    صريحٍ أنّ الإفصاحَ أُعيد.
--
-- ⚠️ وما لا تمسّه هذه الهجرة عن عمد:
--    • `bookings.source = 'telegram'` (١٣ صفّاً) — وسمُ قياسٍ لا بيانَ هويّةِ
--      قناة، ولا يَدلّ على حسابٍ بعينه. ومحوُه يُفسد تحليلاً صحيحاً.
--    • `whatsapp_bot_number` — رقمُ حسابٍ تجاريٍّ عندنا، لا بيانُ مستخدم.
--    • كودُ البوتين ودوالُّهما — مبنيّةٌ ومختبَرة، والإطفاءُ قرارُ تشغيلٍ لا حذف.
-- ════════════════════════════════════════════════════════════════════════

-- ① حارسُ المختبر — أوّلُ عبارةٍ دائماً
DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION '⛔ هذه هجرةُ إنتاج (جدة) — ومُنعت على مختبر طوكيو.';
  END IF;
END $guard$;

-- ② وشرطٌ مسبقٌ يُفشل الهجرةَ لا يُحذّر: القناتان يجب أن تكونا مُطفأتين
--    قبل محوِ الربط. محوُ مُعرِّفٍ وقناةٌ تعمل = مستخدمٌ يُقطع عنه البوتُ بصمت.
DO $pre$
DECLARE v_tg boolean; v_wa boolean;
BEGIN
  SELECT COALESCE((SELECT value::boolean FROM public.platform_settings WHERE key='telegram_bot_enabled'), false),
         COALESCE((SELECT value::boolean FROM public.platform_settings WHERE key='whatsapp_bot_enabled'), false)
    INTO v_tg, v_wa;
  IF v_tg OR v_wa THEN
    RAISE EXCEPTION '❌ قناةٌ تعمل (تيليجرام=% · واتساب=%) — أطفئهما أوّلاً، فمحوُ الربط مع قناةٍ عاملةٍ يقطع مستخدماً بصمت.', v_tg, v_wa;
  END IF;
END $pre$;

-- ③ محوُ أثر القناة من صفوف المستخدمين
--    🪤 ويُقاس العددُ قبل المحو وبعده: `UPDATE` بصفر صفوفٍ لا يُخطئ، فـ«تمّ»
--       بلا عددٍ ليس قياساً (درسُ `vault.update_secret` في v14.44).
DO $wipe$
DECLARE v_before int; v_after int; v_touched int;
BEGIN
  SELECT count(*) INTO v_before FROM public.users
   WHERE telegram_id IS NOT NULL OR telegram_chat_id IS NOT NULL
      OR whatsapp_chat_id IS NOT NULL OR telegram_link_otp IS NOT NULL;

  UPDATE public.users
     SET telegram_id                  = NULL,
         telegram_chat_id             = NULL,
         whatsapp_chat_id             = NULL,
         telegram_link_otp            = NULL,
         telegram_link_otp_expires_at = NULL,
         notify_via_telegram          = false,
         notify_via_whatsapp          = false
   WHERE telegram_id IS NOT NULL OR telegram_chat_id IS NOT NULL
      OR whatsapp_chat_id IS NOT NULL OR telegram_link_otp IS NOT NULL
      OR COALESCE(notify_via_telegram, false) OR COALESCE(notify_via_whatsapp, false);
  GET DIAGNOSTICS v_touched = ROW_COUNT;

  SELECT count(*) INTO v_after FROM public.users
   WHERE telegram_id IS NOT NULL OR telegram_chat_id IS NOT NULL
      OR whatsapp_chat_id IS NOT NULL OR telegram_link_otp IS NOT NULL;

  IF v_after <> 0 THEN
    RAISE EXCEPTION '❌ بقي % صفّاً يحمل مُعرِّفَ قناة بعد المحو', v_after;
  END IF;
  RAISE NOTICE '✅ ② مُعرِّفاتُ القناة: % صفّاً كان يحملها · % صفّاً مُسّ · صفرٌ باقٍ', v_before, v_touched;
END $wipe$;

-- وأيُّ رمزِ ربطٍ معلّقٍ لم يُستعمل (قِيس صفراً، والعبارةُ للاتّساق لا للأثر)
DELETE FROM public.telegram_link_tokens;

-- ④ البابُ الخلفيّ: لا تُفتح قناةٌ بلا إقرارٍ أنّ الإفصاحَ أُعيد
--
-- 🪤 والمميِّزُ يتبع وضعَ الأمان: هذا المشغّلُ **`SECURITY INVOKER`** عمداً،
--    فـ`current_user` فيه هو المنادي الحقيقيّ (درسُ v14.93 مقلوباً: الحرّاسُ
--    التي انكسرت كانت DEFINER). ولا إعفاءَ لأحدٍ هنا — ولا حتى للنظام: فتحُ
--    القناة قرارُ إفصاحٍ لا عمليّةُ صيانة، والكرونُ لا يفتحها.
CREATE OR REPLACE FUNCTION public.tr_guard_bot_channel_disclosure()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
DECLARE v_on boolean; v_disclosed boolean;
BEGIN
  IF NEW.key NOT IN ('telegram_bot_enabled', 'whatsapp_bot_enabled') THEN
    RETURN NEW;
  END IF;

  -- قيمةٌ ليست بوليانيّةً تُعَدّ إطفاءً فلا تُحرَس (وتُرفض لاحقاً عند القراءة)
  BEGIN
    v_on := COALESCE(NEW.value::boolean, false);
  EXCEPTION WHEN others THEN
    RETURN NEW;
  END;
  IF NOT v_on THEN RETURN NEW; END IF;                 -- الإطفاءُ حرٌّ دائماً

  v_disclosed := COALESCE(
    (SELECT value::boolean FROM public.platform_settings WHERE key = 'bot_channels_disclosed'),
    false);

  IF NOT v_disclosed THEN
    RAISE EXCEPTION
      'BOT_CHANNEL_NOT_DISCLOSED'
      USING HINT = 'BOT_CHANNEL_NOT_DISCLOSED',
            DETAIL = 'تشغيلُ «' || NEW.key || '» يُعيد معالجةَ بياناتٍ شخصيةٍ عبر قناةٍ '
                   || 'أُسقط إفصاحُها من سياسة الخصوصية في v15.80 بقرار المالك. '
                   || 'أعِد الإفصاحَ أوّلاً في src/pages/legal/Privacy.tsx (نطاقُ السياسة · '
                   || 'ما نجمعه · مصادرُ الجمع · النقلُ خارج المملكة) ووصفَ التجّار في '
                   || 'index.html، وارفع LEGAL_VERSION، ثمّ اضبط '
                   || 'platform_settings.bot_channels_disclosed = true وأعِد المحاولة.';
  END IF;
  RETURN NEW;
END $fn$;

COMMENT ON FUNCTION public.tr_guard_bot_channel_disclosure() IS
  'v15.80 — لا تُشغَّل قناةُ مراسلةٍ قبل إعادة إفصاحها في سياسة الخصوصية. يُفتح بـbot_channels_disclosed.';

DROP TRIGGER IF EXISTS tr_a0_guard_bot_channel_disclosure ON public.platform_settings;
CREATE TRIGGER tr_a0_guard_bot_channel_disclosure
  BEFORE INSERT OR UPDATE ON public.platform_settings
  FOR EACH ROW EXECUTE FUNCTION public.tr_guard_bot_channel_disclosure();

-- ومفتاحُ الإفصاح يوجد صريحاً بقيمة «لا»، فغيابُه لا يُفسَّر تفسيراً
INSERT INTO public.platform_settings (key, value)
VALUES ('bot_channels_disclosed', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ⑤ القياس: المشغّلُ يَعضُّ فعلاً — سالبان وموجبان، داخل معاملةٍ فرعيّةٍ تُلغى
-- 🪤 ولا يُقبل «أيُّ استثناء»: يُشترط الرمزُ بعينه (درسُ v14.96).
DO $verify$
DECLARE v_err text; v_hint text; v_blocked boolean;
BEGIN
  -- (أ) سالب: تشغيلُ تيليجرام يجب أن يُرفض بـBOT_CHANNEL_NOT_DISCLOSED
  v_blocked := false;
  BEGIN
    UPDATE public.platform_settings SET value = 'true'::jsonb WHERE key = 'telegram_bot_enabled';
    RAISE EXCEPTION 'SENTINEL_NOT_BLOCKED';
  EXCEPTION
    WHEN others THEN
      v_err := SQLERRM; v_hint := NULLIF(current_setting('x', true), '');
      IF v_err = 'SENTINEL_NOT_BLOCKED' THEN
        RAISE EXCEPTION '❌ 🔴 المشغّلُ لم يمنع تشغيلَ تيليجرام — البابُ الخلفيُّ مفتوح';
      END IF;
      IF v_err <> 'BOT_CHANNEL_NOT_DISCLOSED' THEN
        RAISE EXCEPTION '❌ رُفض لسببٍ آخر لا للسبب المقصود: %', v_err;
      END IF;
      v_blocked := true;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION '❌ فحصُ (أ) لم يبتّ'; END IF;

  -- (ب) سالب: وواتساب كذلك
  v_blocked := false;
  BEGIN
    UPDATE public.platform_settings SET value = 'true'::jsonb WHERE key = 'whatsapp_bot_enabled';
    RAISE EXCEPTION 'SENTINEL_NOT_BLOCKED';
  EXCEPTION WHEN others THEN
    IF SQLERRM = 'SENTINEL_NOT_BLOCKED' THEN
      RAISE EXCEPTION '❌ 🔴 المشغّلُ لم يمنع تشغيلَ واتساب';
    END IF;
    IF SQLERRM <> 'BOT_CHANNEL_NOT_DISCLOSED' THEN
      RAISE EXCEPTION '❌ واتساب رُفض لسببٍ آخر: %', SQLERRM;
    END IF;
    v_blocked := true;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION '❌ فحصُ (ب) لم يبتّ'; END IF;

  -- (ج) موجب: الإطفاءُ حرٌّ — وإلّا صار الحارسُ قُفلاً على إيقاف الخدمة
  UPDATE public.platform_settings SET value = 'false'::jsonb WHERE key = 'telegram_bot_enabled';

  -- (د) موجب: ومفتاحٌ آخرُ لا يُمَسّ — الحارسُ ضيّقٌ لا شامل
  UPDATE public.platform_settings SET value = value WHERE key = 'whatsapp_bot_number';

  RAISE NOTICE '✅ ④ الحارس: سالبان بالرمز المقصود · والإطفاءُ حرٌّ · ومفاتيحُ غيرِه لا تُمَسّ';
END $verify$;

-- ⑥ وجدولٌ للقراءة البشرية — **بعد** كلّ تحقّقٍ رافع، لأنّ جدولاً لا يُفشل psql
SELECT 'الخادم' AS بند,
       CASE WHEN obj_description('public'::regnamespace,'pg_namespace') IS NULL
            THEN 'جدة — الإنتاج' ELSE 'مختبر ⚠️' END AS قيمة
UNION ALL SELECT 'حسابات تحمل مُعرِّفَ قناة',
       (SELECT count(*)::text FROM public.users
         WHERE telegram_id IS NOT NULL OR telegram_chat_id IS NOT NULL OR whatsapp_chat_id IS NOT NULL)
UNION ALL SELECT 'رموزُ ربطٍ معلّقة', (SELECT count(*)::text FROM public.telegram_link_tokens)
UNION ALL SELECT 'تيليجرام مُفعَّل',
       (SELECT COALESCE(value::text,'(غائب)') FROM public.platform_settings WHERE key='telegram_bot_enabled')
UNION ALL SELECT 'واتساب مُفعَّل',
       (SELECT COALESCE(value::text,'(غائب)') FROM public.platform_settings WHERE key='whatsapp_bot_enabled')
UNION ALL SELECT 'الإفصاحُ مُقَرٌّ به',
       (SELECT COALESCE(value::text,'(غائب)') FROM public.platform_settings WHERE key='bot_channels_disclosed')
UNION ALL SELECT 'حارسُ الإفصاح مُركَّب',
       (SELECT CASE WHEN count(*)=1 THEN '✅' ELSE '❌' END FROM pg_trigger
         WHERE tgrelid='public.platform_settings'::regclass
           AND tgname='tr_a0_guard_bot_channel_disclosure')
UNION ALL SELECT 'حجوزاتٌ موسومةٌ بقناة (لا تُمَسّ عمداً)',
       (SELECT count(*)::text FROM public.bookings WHERE COALESCE(source,'web') <> 'web');

-- ════════════════════════════════════════════════════════════════════════
-- -- ROLLBACK
-- DROP TRIGGER IF EXISTS tr_a0_guard_bot_channel_disclosure ON public.platform_settings;
-- DROP FUNCTION IF EXISTS public.tr_guard_bot_channel_disclosure();
-- DELETE FROM public.platform_settings WHERE key = 'bot_channels_disclosed';
-- 🪤 ولا رجعةَ لمُعرِّفات القناة: مُحيت عمداً. يُعيد المستخدمُ الربطَ برمزٍ
--    من التطبيق في ثوانٍ — وهذا هو المسارُ المصمَّم أصلاً.
-- ════════════════════════════════════════════════════════════════════════
