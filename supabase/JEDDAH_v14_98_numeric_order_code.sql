-- ═══════════════════════════════════════════════════════════════════════════
-- v14.98 — رقم الطلب يصير أرقاماً فقط (جدّة)
-- ═══════════════════════════════════════════════════════════════════════════
-- طلبُ ناصر حرفياً: «أريد الكود أن يكون فقط أرقاماً وليس أرقاماً وحروفاً، عشان
-- عند استلام الطلب يكون كرقم الطلب، وأيضاً في لوحة الأدمن كرقم مرجع».
--
-- 🔴 وأخطرُ ما في هذه الهجرة هو ما **لا** تفعله:
--    **لا يُعاد كتابة أيّ رمزٍ قائم. ولا واحد.** والسببُ ليس حذراً عامّاً:
--      • `order_invoices` مستندٌ ضريبيّ **مجمَّد** مفتاحُه الرمز — وتعديلُه
--        تزويرُ فاتورة، لا «تحديث بيانات».
--      • مستودع `chat` الخاصّ يجعل **الرمزَ أوّلَ مقطعٍ في المسار**، وعضويّتُه
--        تُشتقّ منه (`taki_chat_member`). تغييرُ الرمز = يُتم كلّ مرفقات
--        المحادثة بلا استرجاع.
--      • والبوتان ورموزُ QR المطبوعة في جيوب العملاء تحمل الرموز القديمة.
--    فالرموز القديمة تبقى تعمل إلى الأبد، والأرقام تبدأ من الطلب القادم وحده.
--
-- 🪤 وسقفٌ لا يُتجاوز، مقيسٌ من الكود لا مفترَضاً: في `server/bot.js` زرّان
--    يتقاسمان بادئة `cd:` — واحدٌ لطابع الوقت `^cd:(\d{13,})$` وآخرُ للرمز
--    `^cd:([A-Za-z0-9]{4,12})$`. فرمزٌ رقميّ طولُه ١٣ أو أكثر **يُلتقط بالنمط
--    الخطأ** فيذهب العدّاد إلى `legacyCd` ويسقط بصمت. ولذلك الطولُ هنا ١٠،
--    ويحرسه `scripts/check-order-code.js` ليبقى داخل [٤، ١٢].
--
-- لماذا ١٠ خانةً بالضبط (حسابٌ لا ذوق):
--    الفضاء = ٩ × ١٠⁹ (أوّل خانة ١–٩ فلا صفرَ بادئ، وتسعٌ بعدها ٠–٩).
--    عددُ التصادمات المتوقَّع عند بلوغ المنصّة n طلباً ≈ n² ÷ (2 × الفضاء):
--      • ٨ خانات (٩×١٠⁷): عند ١٠٠٬٠٠٠ طلب ⇒ ‎~٥٥‎ تصادماً. مرفوض.
--      • ٩ خانات (٩×١٠⁸): عند ١٠٠٬٠٠٠ طلب ⇒ ‎~٥٫٦‎ تصادمات.
--      • ١٠ خانات (٩×١٠⁹): عند ١٠٠٬٠٠٠ طلب ⇒ ‎~٠٫٥٦‎ — أقلّ من واحد طوالَ العمر.
--    و١٠ خاناتٍ هي بالضبط طولُ رقم الجوّال السعودي: طولٌ يقرؤه الكاشير والعميل
--    على المكشوف كلّ يوم، ويُجزَّأ طبيعياً ٤-٣-٣.
--    🪤 والتصادم هنا ليس متساوياً في الطرفين: البوتان يمرّان بهذه الدالّة
--       فتدور حتى تجد رمزاً حرّاً (تصادمٌ = محاولةٌ ثانية، صامتة وسليمة). أمّا
--       الموقع فيولّد الرمز في المتصفّح ويُدرج به مباشرةً (واجهةٌ تفاؤلية)،
--       فلا حلقةَ له — ومن هنا جاء اشتراطُ فضاءٍ واسع لا حلقةٍ وحدها.
--
-- 🪤 والرمزُ **ليس سرّاً ولم يكن**، وقد قِيس ذلك قبل تقصيره لا بعده: كلُّ
--    مسارٍ يقرأ طلباً بالرمز مُقيَّدٌ بالطرف — `lookup_booking_by_code` و
--    `bot_lookup_booking` يردّان «غير موجود» نفسَه لمن ليس طرفاً (فلا عرّافة
--    تفرّق بين «لا وجود» و«ليس لك»)، و`taki_chat_member` تسأل صفّ الحجز لا
--    المسار، و`get_order_invoice` تسأل الهويّة، و`merchant-pay` يشترط
--    `booking.user_id = uid`. فتقصيرُ الفضاء من ٣٢⁸ إلى ٩×١٠⁹ **لا يفتح
--    بياناً لأحد** — يرفع احتمالَ التصادم وحده، وهو ما حُسب أعلاه.
--
-- 🪤 ولا استثناءَ «نظام» في الحارس عمداً: كلّ مسارِ إدراجٍ حيّ (الموقع،
--    `bot_book_deal`) صار رقمياً، فأيُّ استثناءٍ هنا ثقبٌ دائم مقابل راحةٍ
--    مرّةً في العمر. وإن لزم إصلاحُ بياناتٍ يدويّ يوماً فالبابُ صريح ومُدقَّق:
--    `ALTER TABLE public.bookings DISABLE TRIGGER tr_a0_order_code_numeric;`
--    ثمّ إعادةُ تفعيله — خطوةٌ يراها التدقيق، لا استثناءٌ صامت في الكود.
--
-- 🪤 وعيبٌ يخلقه الرقمُ نفسه ويُعالَج هنا (القسم ٣٫٥): لوحةُ المفاتيح العربية
--    تكتب «٤٨٢٧» لا «4827»، ودالّتا البحث بالرمز تقارنان حرفياً — فرقمٌ عربيّ
--    يردّ «لم يُعثر على الطلب» عن طلبٍ قائم. ما كان هذا ممكناً بالحروف اللاتينية.
--
-- الخادم المستهدف: **جدّة (الإنتاج)**. يرفض التنفيذ على مختبر طوكيو.
-- ═══════════════════════════════════════════════════════════════════════════

-- TAKI_ORDER_CODE_LEN = 10
-- ↑ سطرٌ يقرؤه `scripts/check-order-code.js` آلياً. لا تُعدّله وحدَه: التوأم
--   في `src/utils/helpers.ts` (`ORDER_CODE_LEN`) يجب أن يتغيّر معه أو يسقط البناء.

-- 🪤 معاملةٌ واحدة عمداً: لو سقط التحقّق فلا دالّةَ تبقى ولا مشغّل — بدلاً من
--    خادمٍ يحمل مشغّلاً يرفض الحروف ومولّداً ما زال يُخرجها.
BEGIN;

-- ── ٠) حارس: هذه هجرة إنتاج (جدّة) ─────────────────────────────────────────
DO $guard$
BEGIN
  -- 🪤 بالبادئة لا بالمطابقة التامّة: وسمُ المختبر يحمل رقم نسخة، فمطابقةٌ
  --    تامّة تصير **حارساً عاطلاً** بصمت أوّل مرّةٍ يُبدَّل فيها الرقم — وهو
  --    بالضبط ما يُوقع هجرةَ إنتاجٍ على المختبر (درس ٢٢ أغسطس، و v14.96).
  IF COALESCE(obj_description('public'::regnamespace, 'pg_namespace'), '') LIKE 'TAKI_LAB_TOKYO%' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر (%). أوقِفت.',
      obj_description('public'::regnamespace, 'pg_namespace');
  END IF;
  IF to_regclass('public.bookings') IS NULL THEN
    RAISE EXCEPTION 'جدول bookings غير موجود — أوقِفت قبل أن أبني على فراغ.';
  END IF;
  IF to_regprocedure('public._bot_gen_barcode()') IS NULL THEN
    RAISE EXCEPTION '_bot_gen_barcode() غير موجودة — البوتان يناديانها، ولا أُنشئها من عدم هنا.';
  END IF;
  -- 🪤 الرمزُ المختار يجب أن يكون حرّاً فعلاً. P0001..P0025 مأخوذة في هذا
  --    المخطّط (قِيست من الكود والهجرات)، وP0026 حرّ — لكن «قِيس» لا «يُفترض»:
  IF EXISTS (
    SELECT 1 FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f'
       AND position('P0026' IN pg_get_functiondef(p.oid)) > 0
  ) THEN
    RAISE EXCEPTION 'الرمز P0026 مستعملٌ أصلاً في دالّةٍ على هذا الخادم — اختر رمزاً آخر قبل الشحن.';
  END IF;
END
$guard$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ١) المولّد: مصدرٌ واحد لرقم الطلب
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 SECURITY DEFINER ليست زينة: الدالّة تتحقّق من عدم استعمال الرمز بقراءة
--    `bookings`، وسياسةُ RLS تُخفي عن أيّ دورٍ غير النظام صفوفَ غيره. فبلا
--    DEFINER تكون الحلقةُ **عمياء**: ترى صفوفَ المنادي وحدها فتُقسم أن الرمز
--    حرٌّ وهو مشغولٌ عند مشترٍ آخر. (وهذا بالضبط شكلُ العيب الذي لا يظهر في
--    الاختبار ويظهر في الإنتاج.)
CREATE OR REPLACE FUNCTION public.taki_new_order_code()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_len   CONSTANT int := 10;   -- ← يطابق TAKI_ORDER_CODE_LEN أعلاه وORDER_CODE_LEN في الموقع
  v_pool  text;
  v_code  text;
  v_tries int := 0;
BEGIN
  LOOP
    v_tries := v_tries + 1;

    -- 🪤 مصدرُ العشوائية `gen_random_uuid()` لا `random()`: الأخيرة تُبذَر
    --    لكلّ جلسةٍ على حدة، وأسوأُ لحظةٍ لتشابه بذرتين هي أشدُّ لحظات الضغط
    --    (موجةُ حجزٍ تفتح اتصالاتٍ متزامنة). والـuuid هنا مصدرٌ قويّ مدمج،
    --    فيوازي `crypto.getRandomValues` في الموقع.
    -- وخاناتُ الـuuid الستّ عشرية موزَّعة بانتظام، فترشيحُ ما كان منها ٠–٩
    -- يُخرج أرقاماً **منتظمة** لا منحازة.
    v_pool := '';
    WHILE length(v_pool) < v_len LOOP
      -- و`ltrim` تضمن ألّا يبدأ الرمز بصفر: صفرٌ بادئ يضيع في أوّل لحظة
      -- يُكتب فيها الرقم في جدول بيانات أو حقلٍ رقميّ، فيعود العميل برمزٍ
      -- أقصرَ بخانة ولا يجده أحد.
      v_pool := ltrim(v_pool || regexp_replace(gen_random_uuid()::text, '[^0-9]', '', 'g'), '0');
    END LOOP;
    v_code := substr(v_pool, 1, v_len);

    -- الرمزُ يجب أن يكون حرّاً في العمودين معاً: الماسحُ يقبل أيّهما
    -- (`upper(barcode) = v_code OR upper(backup_code) = v_code`)، فرمزٌ
    -- يصادم رمزاً احتياطياً قديماً يجعل المسحَ يفتح الطلب الخطأ.
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.bookings b
       WHERE b.barcode = v_code OR b.backup_code = v_code
    );

    IF v_tries >= 50 THEN
      -- عند ٩×١٠⁹ احتمالاً هذا مستحيلٌ عملياً — فوقوعُه يعني عطلاً في مصدر
      -- العشوائية لا سوءَ حظّ. نرفع بدل أن ندور إلى الأبد داخل معاملة حجز.
      RAISE EXCEPTION 'تعذّر توليد رقم طلبٍ حرّ بعد % محاولة — افحص مصدر العشوائية.', v_tries;
    END IF;
  END LOOP;

  RETURN v_code;
END
$fn$;

COMMENT ON FUNCTION public.taki_new_order_code() IS
  'v14.98 — رقم الطلب: ١٠ أرقام، بلا صفرٍ بادئ، حرٌّ في barcode وbackup_code معاً. '
  'توأمُه في الموقع src/utils/helpers.ts::generateBarcode، ويحرس تطابقَهما scripts/check-order-code.js.';

REVOKE ALL ON FUNCTION public.taki_new_order_code() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_new_order_code() FROM anon;
GRANT EXECUTE ON FUNCTION public.taki_new_order_code() TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٢) البوتان يمرّان بالمولّد نفسه — فلا انحرافَ ممكن
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 `CREATE OR REPLACE` لا `DROP`: الإسقاط يُضيّع المنح، ونوعُ الإرجاع لم
--    يتغيّر (`text`) فالاستبدال مشروع. وتبقى الدالّة `LANGUAGE sql` كما كانت.
-- 🪤 وتُصبح هذه الدالّة تتحقّق من التفرّد بنفسها، فحلقةُ `bot_book_deal`
--    (`LOOP … EXIT WHEN NOT EXISTS …`) صارت زائدةً لا ضارّة — وتُركت كما هي
--    عمداً: تعديلُ `bot_book_deal` هنا بلا داعٍ يخاطر بدالّةٍ تحجز فعلياً.
--    والأهمّ أنّ `v_backup := _bot_gen_barcode()` كان **بلا حلقة أصلاً**،
--    فصار الآن متفرّداً مجّاناً.
CREATE OR REPLACE FUNCTION public._bot_gen_barcode()
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT public.taki_new_order_code();
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٣) الحارس: لا يدخل الجدولَ رمزٌ فيه حرف
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 `BEFORE INSERT` وحدها — لا `UPDATE`. ولو حملت `OR UPDATE` لصار كلُّ
--    تعديلٍ على طلبٍ قديمٍ (إقرار · إكمال · إلغاء · ردُّ مبلغ · رسالة) يسقط،
--    لأنّ ٨٩ طلباً قائماً تحمل رموزاً بحروف ولن تتغيّر أبداً.
--
-- 🪤 والنمط `^[1-9][0-9]{5,}$` لا `^[1-9][0-9]{9}$`: طولُ الرمز قرارُ منتجٍ
--    يثبّته حارسُ البناء بين الموقع والقاعدة، أمّا الثابتُ في القاعدة فهو أنّ
--    «رقم الطلب رقم»: لا حرفَ فيه ولا صفرَ بادئ ولا خانتان تافهتان. فلو
--    غُيّر الطولُ يوماً بقرارٍ واعٍ لم تلزم هجرةٌ ثانية، ويبقى الحرفُ مرفوضاً.
CREATE OR REPLACE FUNCTION public.tr_guard_order_code_numeric()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NEW.barcode IS NULL OR NEW.barcode !~ '^[1-9][0-9]{5,}$' THEN
    -- الرسالة مكتوبةٌ للمشتري لا للمطوّر: أكثرُ من سيصطدم بها هو متصفّحٌ
    -- عالقٌ على نسخةٍ قديمة من التطبيق (iOS يثبت على البناء القديم)، وما
    -- يحتاجه ليس تشخيصاً بل فعلاً واحداً واضحاً.
    RAISE EXCEPTION 'رقم الطلب يجب أن يكون أرقاماً فقط. حدِّث التطبيق ثم أعد المحاولة.'
      USING ERRCODE = 'P0026';
  END IF;
  RETURN NEW;
END
$fn$;

-- 🪤 الاسم `tr_a0_` متعمَّد: مشغّلات `BEFORE` تعمل بترتيب الاسم أبجدياً، و
--    `a0` يسبق `tr_aa_rate_limit_booking`. فرمزٌ مشوّه يُرفض **قبل** أن يمسّ
--    شيءٌ المخزونَ أو الحدودَ أو الرسوم — وقبل أن يُستهلك عدّادُ التحديد.
DROP TRIGGER IF EXISTS tr_a0_order_code_numeric ON public.bookings;
CREATE TRIGGER tr_a0_order_code_numeric
  BEFORE INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.tr_guard_order_code_numeric();

-- ═══════════════════════════════════════════════════════════════════════════
-- ٣٫٥) 🔴 عيبٌ يخلقه الرقمُ نفسه: لوحةُ المفاتيح العربية
-- ═══════════════════════════════════════════════════════════════════════════
-- ما دام الرمز حروفاً لاتينية لم يكن لهذا وجود. أمّا وقد صار أرقاماً، فلوحةُ
-- المفاتيح العربية على آيفون تكتب «٤٨٢٧١٩٣٠٦٥» لا «4827193065» — ودالّتا
-- البحث تقارنان بـ`upper(btrim(…))` لا بـ`taki_norm`، فيردّ الخادم «غير
-- موجود» عن طلبٍ قائم. والتاجر واقفٌ أمام العميل. (و`search_norm` في لوحة
-- الأدمن سليمةٌ أصلاً: `taki_norm` تحوّل الأرقام العربية بنفسها.)
--
-- 🪤 والموضع هو القاعدة لا الواجهات: ثلاثةُ منادين (الموقع · تيليجرام ·
--    واتساب) وأيُّ رابعٍ قادم. إصلاحُ الموقع وحده يترك البوتين مكسورين.
-- 🪤 وتُعاد بناؤها **من نصّها الحيّ** (`pg_get_functiondef`) باستبدال السطر
--    الواحد — لا من نسخةٍ مكتوبة هنا، وإلا دهستُ ما لا أعلم به. ويُتحقَّق من
--    **وقوع** الاستبدال: `replace` على نصٍّ غائب لا يُخطئ، فيبدو الإصلاح واقعاً.
DO $digits$
DECLARE
  v_names text[] := ARRAY['lookup_booking_by_code', 'bot_lookup_booking'];
  v_name  text;
  v_src   text;
  v_new   text;
  v_old   CONSTANT text := 'upper(btrim(COALESCE(p_code, '''')))';
  -- ٠١٢٣٤٥٦٧٨٩ عربية + ۰۱۲۳۴۵۶۷۸۹ فارسية ⇒ لاتينية
  v_fix   CONSTANT text :=
    'upper(btrim(translate(COALESCE(p_code, ''''), ''٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹'', ''01234567890123456789'')))';
BEGIN
  FOREACH v_name IN ARRAY v_names LOOP
    SELECT pg_get_functiondef(p.oid) INTO v_src
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.prokind = 'f' AND p.proname = v_name;

    IF v_src IS NULL THEN
      RAISE EXCEPTION '❌ % غير موجودة — أوقِفت قبل أن أبني على فراغ.', v_name;
    END IF;

    IF position('translate(COALESCE(p_code' IN v_src) > 0 THEN
      RAISE NOTICE 'ℹ️ % تقبل الأرقام العربية أصلاً.', v_name;
      CONTINUE;
    END IF;

    v_new := replace(v_src, v_old, v_fix);
    IF v_new = v_src THEN
      RAISE EXCEPTION '❌ لم أجد السطر المتوقَّع في % — نصُّها الحيّ لا يطابق ما بُني عليه هذا الإصلاح. أوقِفت بلا تغيير.', v_name;
    END IF;

    EXECUTE v_new;

    -- والقياس بعد الكتابة لا الثقة بها
    SELECT pg_get_functiondef(p.oid) INTO v_src
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.prokind = 'f' AND p.proname = v_name;
    IF position('translate(COALESCE(p_code' IN v_src) = 0 THEN
      RAISE EXCEPTION '❌ % لم تُستبدل رغم نجاح EXECUTE.', v_name;
    END IF;
    RAISE NOTICE '✅ % صارت تقبل الأرقام العربية والفارسية.', v_name;
  END LOOP;
END
$digits$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٤) التحقّق — قياسٌ يرفع استثناءً، لا جدولُ ✅/❌ يُقرأ ويُصدَّق
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 وكلُّ إدراجٍ تجريبيّ هنا يُلغى بكتلة استثناءٍ داخلية، فلا يمسّ الفحصُ
--    صفّاً حقيقياً ولا يترك أثراً.
DO $verify$
DECLARE
  v_codes text[] := '{}';
  v_c     text;
  v_src   text;
  v_type  int;
  v_old   text;
  n       int;
BEGIN
  -- ── ٤٫١ المولّد: مئةُ رمزٍ، كلُّها أرقام · بلا صفرٍ بادئ · بلا تكرار ──────
  FOR i IN 1..100 LOOP
    v_c := public.taki_new_order_code();
    IF v_c !~ '^[1-9][0-9]{9}$' THEN
      RAISE EXCEPTION '❌ المولّد أخرج «%» — والمتوقَّع ١٠ أرقامٍ بلا صفرٍ بادئ.', v_c;
    END IF;
    -- 🪤 الدمج بقيمةٍ مكتوبة النوع صراحةً — `text[] || 'literal'` ملتبسٌ في PL/pgSQL.
    v_codes := v_codes || v_c::text;
  END LOOP;
  SELECT count(DISTINCT x) INTO n FROM unnest(v_codes) AS x;
  IF n <> 100 THEN
    RAISE EXCEPTION '❌ مئةُ نداءٍ أعطت % رمزاً متمايزاً فقط — مصدرُ العشوائية معطوب.', n;
  END IF;

  -- ── ٤٫٢ البوتان يمرّان بالمولّد نفسه ─────────────────────────────────────
  SELECT pg_get_functiondef('public._bot_gen_barcode()'::regprocedure) INTO v_src;
  IF position('taki_new_order_code' IN v_src) = 0 THEN
    RAISE EXCEPTION '❌ _bot_gen_barcode لا تنادي المولّد — البوتان سيولّدان حروفاً ويرفضهما الحارس.';
  END IF;
  FOR i IN 1..20 LOOP
    v_c := public._bot_gen_barcode();
    IF v_c !~ '^[1-9][0-9]{9}$' THEN
      RAISE EXCEPTION '❌ _bot_gen_barcode أخرجت «%» — ليست رقماً.', v_c;
    END IF;
  END LOOP;
  -- و`bot_book_deal` ما زالت تمرّ بها (لا تولّد رمزاً بنفسها).
  -- 🪤 بالاسم لا بالتوقيع: توقيعُها تغيّر أكثر من مرّة (v14.06 · v14.08)،
  --    وفحصٌ بتوقيعٍ محفوظ يمرّ أخضرَ على خادمٍ لا تُوجد فيه الدالّة أصلاً.
  SELECT count(*) INTO n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.prokind = 'f' AND p.proname = 'bot_book_deal'
     AND position('_bot_gen_barcode' IN pg_get_functiondef(p.oid)) > 0;
  IF n = 0 THEN
    RAISE EXCEPTION '❌ bot_book_deal لا تمرّ بـ_bot_gen_barcode — البوتان خارج المولّد الموحَّد.';
  END IF;

  -- ── ٤٫٣ المشغّل موجود، وعلى الإدراج وحده ─────────────────────────────────
  SELECT t.tgtype INTO v_type
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.bookings'::regclass
     AND t.tgname  = 'tr_a0_order_code_numeric'
     AND NOT t.tgisinternal;
  IF v_type IS NULL THEN
    RAISE EXCEPTION '❌ المشغّل tr_a0_order_code_numeric غير موجود.';
  END IF;
  -- ١=صفّ · ٢=قبل · ٤=إدراج · ٨=حذف · ١٦=تحديث  ⇒  BEFORE INSERT FOR EACH ROW = 7
  IF v_type <> 7 THEN
    RAISE EXCEPTION '❌ المشغّل ليس «BEFORE INSERT FOR EACH ROW» (tgtype=%) — لو مسّ UPDATE لسقط كلُّ تعديلٍ على طلبٍ قديم.', v_type;
  END IF;

  -- ── ٤٫٤ 🔴 القياس الحاسم: حرفٌ يُرفض فعلاً ───────────────────────────────
  BEGIN
    INSERT INTO public.bookings
      (barcode, backup_code, deal_id, user_id, store_id, booked_at, expiry_time)
    VALUES ('ABC12345', 'ABC12345', '__taki_probe__', '__taki_probe__', '__taki_probe__', 0, 0);
    RAISE EXCEPTION 'TAKI_LETTERS_ACCEPTED';
  EXCEPTION
    WHEN sqlstate 'P0026' THEN
      RAISE NOTICE '✅ رمزٌ بحروف مرفوضٌ بـP0026 — مقيسٌ بإدراجٍ حقيقيّ أُلغي.';
    WHEN OTHERS THEN
      IF SQLERRM = 'TAKI_LETTERS_ACCEPTED' THEN
        RAISE EXCEPTION '❌ قُبل رمزٌ بحروف. الحارس لا يعمل.';
      END IF;
      RAISE EXCEPTION '❌ رُفض الإدراجُ بسببٍ آخر (% / %) — أي أنّ حارسي لم يُقَس أصلاً. رتّب المشغّلات.', SQLSTATE, SQLERRM;
  END;

  -- ── ٤٫٥ والرقمُ يمرّ من حارسي (ثمّ يسقط لاحقاً لسببٍ آخر، وهذا المطلوب) ──
  BEGIN
    INSERT INTO public.bookings
      (barcode, backup_code, deal_id, user_id, store_id, booked_at, expiry_time)
    VALUES ('4827193065', '4827193065', '__taki_probe__', '__taki_probe__', '__taki_probe__', 0, 0);
    RAISE EXCEPTION 'TAKI_PROBE_INSERTED';
  EXCEPTION
    WHEN sqlstate 'P0026' THEN
      RAISE EXCEPTION '❌ رُفض رمزٌ رقميّ سليم بـP0026 — الحارس يمنع الحجز كلَّه.';
    WHEN OTHERS THEN
      IF SQLERRM = 'TAKI_PROBE_INSERTED' THEN
        RAISE NOTICE 'ℹ️ الرمز الرقميّ مرّ من الحارس (وأُلغي الإدراج).';
      ELSE
        RAISE NOTICE '✅ الرمز الرقميّ مرّ من حارسي، ثمّ رُفض لاحقاً كما يجب (%).', SQLSTATE;
      END IF;
  END;

  -- ── ٤٫٦ 🔴 والطلباتُ القديمة بحروفها ما زالت تُعدَّل ──────────────────────
  SELECT barcode INTO v_old FROM public.bookings
   WHERE barcode !~ '^[1-9][0-9]{5,}$' LIMIT 1;
  IF v_old IS NULL THEN
    RAISE NOTICE 'ℹ️ لا طلبَ قائماً برمزٍ فيه حرف — فحصُ التعديل بلا موضوع على هذا الخادم.';
  ELSE
    BEGIN
      UPDATE public.bookings SET expiry_warned = expiry_warned WHERE barcode = v_old;
      GET DIAGNOSTICS n = ROW_COUNT;
      IF n <> 1 THEN
        RAISE EXCEPTION '❌ تعديلُ طلبٍ قديم لمس % صفّاً بدل واحد.', n;
      END IF;
      RAISE EXCEPTION 'TAKI_UPDATE_OK';
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLERRM = 'TAKI_UPDATE_OK' THEN
          RAISE NOTICE '✅ طلبٌ قديم برمزٍ فيه حرف (%) ما زال يُعدَّل — والتعديل أُلغي.', v_old;
        ELSIF SQLSTATE = 'P0026' THEN
          RAISE EXCEPTION '❌ الحارس يمسّ UPDATE: كلُّ طلبٍ قديم صار غيرَ قابلٍ للإقرار أو الإكمال. لا تُشحن.';
        ELSE
          RAISE EXCEPTION '❌ فحصُ تعديل الطلب القديم انفجر (% / %).', SQLSTATE, SQLERRM;
        END IF;
    END;
  END IF;

  -- ── ٤٫٧ وأثرُ الهبوط صفر: لا صفّ حجزٍ أُضيف ولا رمزٌ تغيّر ────────────────
  SELECT count(*) INTO n FROM public.bookings WHERE store_id = '__taki_probe__';
  IF n <> 0 THEN
    RAISE EXCEPTION '❌ بقي % صفَّ فحصٍ في الجدول — الإلغاء لم يقع.', n;
  END IF;

  RAISE NOTICE '✅ v14.98: رقم الطلب ١٠ أرقام · البوتان على المولّد نفسه · الحرف مرفوضٌ بقياس · الطلبات القديمة سليمة وقابلة للتعديل.';
END
$verify$;

COMMIT;
