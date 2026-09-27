-- ═══════════════════════════════════════════════════════════════════════════
-- v14.97 — ردّ المبلغ بضغطة واحدة من التاجر · ونافذةُ ضمانٍ يضبطها ناصر (جدّة)
-- ═══════════════════════════════════════════════════════════════════════════
-- طلبُ ناصر حرفياً: «يستطيع التاجر بنقرة زر أن يردّ المبلغ للمشتري، ولا يُشترط
-- ساعتان — واجعلني أنا أحدّد المدّة من الإدارة، وأضِفها إلى الشروط والأحكام».
--
-- 🔴 وما **لا** تفعله هذه الهجرة، وهو أهمّ ما فيها:
--    **تاكي لا تحتجز المال ولم تحتجزه يوماً.** المشتري يدفع إلى بوّابة التاجر
--    مباشرةً (٠٪ عمولة، لا يمرّ ريال واحد بالمنصّة)، فلا وجود لـ«حجزٍ ساعتين»
--    تملكه تاكي أصلاً ولا تستطيع اختراعه. فما تبنيه هذه الهجرة شيئان اثنان:
--      (١) **تنفيذٌ حقيقيّ**: زرٌّ يأمر بوّابة التاجر نفسها بردّ المبلغ، بقفلٍ
--          يمنع الردّ مرّتين — لا «تسجيلاً» ولا «إقراراً» كما في v14.18.
--      (٢) **وعدٌ زمنيّ يضبطه ناصر**: خلال `refund_window.hours` من الدفع،
--          تضمن تاكي أن الطلب يصل التاجر فوراً ويُنفَّذ **بلا خطوة موافقة**.
--          وهذا وعدٌ يستطيع الكود أن يفي به، خلافاً لـ«نحتجز مالك ساعتين».
--
-- 🔴 ولا تُمسّ `store_can_sell` ولا بحرف: قِيس (v14.94) أنها دالّة **بيع** لا
--    دالّة سياسة — يناديها مشغّلٌ على جدول الحجوزات و`bot_create_booking`
--    وصفحةُ العرض. أيُّ شرطٍ يدخلها يُطفئ الحجز على كلّ عرضٍ حيّ في اللحظة.
--
-- 🪤 والفخّ الذي كشفه القياس أثناء كتابة هذه الهجرة، ولولاه لشُحنت ثغرة:
--    سياسةُ `bookings_update_auth` تسمح للمشتري **وللتاجر** بتعديل صفّ الحجز
--    مباشرةً من المتصفّح، والذي يمنعهما من الكذب هو قائمةُ الأعمدة المجمَّدة
--    داخل `tr_guard_booking_integrity` وحدها. فعمودٌ جديد لا يُدرَج فيها =
--    عمودٌ يكتبه أيّ طرفٍ بنداء PostgREST واحد. وهنا كان ذلك يعني:
--      • تاجرٌ يكتب `refund_state='refunded'` فيرى المشتري «رُدّ مبلغك» ولا ريال.
--      • أو مشترٍ يكتب `refund_state='claiming'` فيُقفل زرُّ التاجر إلى الأبد.
--    ولذلك القسم ٣ أدناه ليس تحسيناً — هو شرطُ أمانٍ لهذه الميزة.
-- ═══════════════════════════════════════════════════════════════════════════

-- 🪤 وكلُّ الملفّ معاملةٌ واحدة عمداً: هجرةٌ تمسّ المال لا تهبط **نصفَ هابطة**.
--    لو سقط التحقّق في القسم ٧ فلا عمودَ يبقى ولا دالّة ولا سياسةٌ معدَّلة —
--    بدلاً من خادمٍ يحمل زرّاً بلا حارسٍ يُجمّد أعمدته.
--    (ولا `CREATE INDEX CONCURRENTLY` هنا ولا `cron.schedule`، فلا شيء يمنع اللفّ.)
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
  IF to_regprocedure('public.taki_is_system_caller()') IS NULL
     OR to_regprocedure('public.taki_admin_perm(text)') IS NULL
     OR to_regprocedure('public._refund_notify(text,text,text,text,text,text,text,text)') IS NULL
     OR to_regprocedure('public.tr_guard_booking_integrity()') IS NULL THEN
    RAISE EXCEPTION 'خادمٌ ينقصه taki_is_system_caller/taki_admin_perm/_refund_notify/tr_guard_booking_integrity — أوقِفت قبل أن أبني على فراغ.';
  END IF;
  IF to_regclass('public.booking_refunds') IS NULL
     OR to_regclass('public.store_invoice_counters') IS NULL THEN
    RAISE EXCEPTION 'جداول v14.18 غير موجودة — أوقِفت.';
  END IF;
END
$guard$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ١) الإعداد + مصدرُه الواحد
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 `hours` ليست مهلةَ احتجازٍ — لا شيء محتجَز. هي **نافذةُ ضمانٍ إجرائيّ**:
--    خلالها لا يمرّ طلبُ الاسترداد بأيّ موافقةٍ أو مراجعة، بل يصل التاجر فوراً
--    ويُنفَّذ بضغطة. وبعدها يبقى الزرّ عاملاً — لكن وفق سياسة التاجر المعلنة.
--    وهذا هو الفرق بين وعدٍ يفي به الكود ووعدٍ يكذب (درس v14.82).
-- 🪤 و`merchant_button` مفتاحُ إطفاءٍ فوريّ: لو انكشف عيبٌ في مزوّدٍ ما، يُطفأ
--    الزرّ من اللوحة بلا نشرٍ ولا انتظار بناء.
INSERT INTO public.platform_settings (key, value, description)
VALUES ('refund_window',
        '{"hours":2,"merchant_button":true}'::jsonb,
        'نافذة الاسترداد المضمون: خلال hours ساعة من الدفع يصل طلب الاسترداد التاجر فوراً ويُنفَّذ بلا موافقة. merchant_button يُظهر/يُخفي زرّ «ردّ المبلغ» في لوحة التاجر. تاكي لا تحتجز المال — الدفع يذهب لحساب التاجر مباشرة والردّ ينفّذه مزوّده.')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.taki_refund_policy()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT jsonb_build_object(
    -- ٠ ساعة = لا نافذة ضمان معلنة (الزرّ يبقى عاملاً). و٧٢٠ = ٣٠ يوماً سقفاً.
    -- 🪤 `jsonb_typeof = 'number'` لا `::numeric` على نصّ: `Number(null)` صفرٌ
    --    صالح في الواجهة، ونظيرُه هنا كان يُحوّل قيمةً تالفة إلى ٠ ساعة بصمت
    --    بدل الارتداد إلى الافتراضي (درس v14.92 في قارئ نسبة الضريبة).
    'hours', GREATEST(0, LEAST(720, COALESCE((
        SELECT floor((value->>'hours')::numeric)::int FROM public.platform_settings
         WHERE key = 'refund_window' AND jsonb_typeof(value->'hours') = 'number'), 2))),
    -- بولياني حقيقيّ وحده يُحسب؛ أيّ شيءٍ آخر يرتدّ إلى الافتراضي (مفتوح).
    'merchant_button', COALESCE((
        SELECT CASE WHEN jsonb_typeof(value->'merchant_button') = 'boolean'
                    THEN (value->>'merchant_button')::boolean END
          FROM public.platform_settings WHERE key = 'refund_window'), true)
  );
$fn$;
REVOKE ALL ON FUNCTION public.taki_refund_policy() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_refund_policy() FROM anon;
GRANT EXECUTE ON FUNCTION public.taki_refund_policy() TO authenticated, service_role;

COMMENT ON FUNCTION public.taki_refund_policy() IS
  'سياسة الاسترداد الفوري: hours (نافذة الضمان الإجرائي) + merchant_button. مقروءةٌ مقصوصة، ولا تُحسب في مكانٍ ثانٍ.';

-- ═══════════════════════════════════════════════════════════════════════════
-- ٢) حالةُ الاسترداد على صفّ الحجز نفسه
-- ═══════════════════════════════════════════════════════════════════════════
-- ولماذا على `bookings` لا على `booking_refunds` وحده: القفلُ يجب أن يكون على
-- **الصفّ الذي يمثّل المال** — وهو صفّ الحجز الذي يحمل `paid_at`. قفلُ صفٍّ في
-- جدولٍ ثانٍ لا يمنع مساراً لا يمرّ به (والمسار الفوريّ قد لا يُنشئ صفّ طلبٍ
-- إطلاقاً: التاجر يردّ بمبادرته بلا أن يطلب المشتري شيئاً).
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS refund_state      text;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS refund_claimed_at timestamptz;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS refunded_at       timestamptz;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS refund_ref        text;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS refund_amount     numeric;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS refund_reason     text;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS refund_by         text;

-- 🪤 قيدٌ يسمح بما يكتبه الكود بالضبط، لا أكثر ولا أقلّ (درس v14.78:
--    `notifications_type_check` سمح بستّةٍ والكود يكتب تسعة، فثلاثة مسارات
--    لم تنجح ولا مرّة وبلا أيّ صوت). والحالات أربعٌ لا خامس لها:
--      NULL      — لم يُطلب ردٌّ قطّ (وهي حالةُ كلّ صفٍّ قائم اليوم)
--      claiming  — نداءُ ردٍّ جارٍ عند المزوّد. القفل. لا ثانيَ له.
--      refunded  — تمّ فعلاً، ومعه مرجع المزوّد.
--      failed    — ردَّ المزوّد بالرفض. تُعاد المحاولة من هنا وحدها.
DO $chk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.bookings'::regclass
                    AND conname  = 'bookings_refund_state_chk') THEN
    ALTER TABLE public.bookings ADD CONSTRAINT bookings_refund_state_chk
      CHECK (refund_state IS NULL OR refund_state IN ('claiming','refunded','failed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.bookings'::regclass
                    AND conname  = 'bookings_refund_sane_chk') THEN
    ALTER TABLE public.bookings ADD CONSTRAINT bookings_refund_sane_chk
      CHECK ((refund_amount IS NULL OR (refund_amount >= 0 AND refund_amount <= 1000000))
         AND (refund_reason IS NULL OR length(refund_reason) <= 600)
         AND (refund_ref    IS NULL OR length(refund_ref)    <= 120)
         AND (refund_by     IS NULL OR length(refund_by)     <= 40));
  END IF;
END
$chk$;

-- فهرسٌ جزئيّ: صفوفُ الاسترداد قلّةٌ بين آلاف الحجوزات، والمسحُ عنها
-- (شاشة الإدارة · كشفُ نداءٍ عالق) يجب ألّا يقرأ الجدول كلّه.
CREATE INDEX IF NOT EXISTS idx_bookings_refund_state
  ON public.bookings (refund_state, refund_claimed_at)
  WHERE refund_state IS NOT NULL;

COMMENT ON COLUMN public.bookings.refund_state IS
  'NULL | claiming (قفلُ نداءٍ جارٍ) | refunded | failed. يكتبها الخادمُ وحده — انظر tr_guard_booking_integrity.';

-- ═══════════════════════════════════════════════════════════════════════════
-- ٣) 🔴 تجميدُ الأعمدة الجديدة على جلسة العميل — ترقيعٌ من النصّ **الحيّ**
-- ═══════════════════════════════════════════════════════════════════════════
-- انظر ديباجة الملفّ: بدون هذا القسم يستطيع التاجر أن يكتب «رُدّ المبلغ» بلا
-- ريال، ويستطيع المشتري أن يُقفل الزرّ إلى الأبد — كلاهما بنداء PostgREST
-- واحد على `bookings`، لأن `bookings_update_auth` تسمح لهما بالتعديل وقائمةُ
-- الأعمدة المجمَّدة هي الحارس الوحيد.
--
-- 🪤 ويُقرأ التعريفُ الحيّ ولا يُعاد كتابته من الذاكرة: الحارس يحمل منطقاً
--    تراكم عبر v14.06 و v14.10 و v14.11، وإعادةُ كتابته هنا تُضيّع ما لا أعرفه.
DO $freeze$
DECLARE
  v_src    text;
  v_anchor text := 'OR NEW.delivery_fee';
BEGIN
  v_src := pg_get_functiondef('public.tr_guard_booking_integrity()'::regprocedure);
  IF position('refund_state' IN v_src) > 0 THEN
    RAISE NOTICE 'ℹ️ أعمدة الاسترداد مجمّدةٌ أصلاً — لا تغيير.'; RETURN; END IF;
  IF position(v_anchor IN v_src) = 0 THEN
    RAISE EXCEPTION '❌ مرساةُ tr_guard_booking_integrity غير موجودة — أوقِفت بلا تغيير. (لا تُجمَّد الأعمدة الجديدة ⇒ لا تُشحن الميزة.)'; END IF;
  -- تُدرَج قبل سطر `delivery_fee` داخل سلسلة الـOR نفسها التي تنتهي بـTHEN.
  v_src := replace(v_src, v_anchor,
      'OR NEW.refund_state     IS DISTINCT FROM OLD.refund_state'      || E'\n' ||
      '  OR NEW.refund_claimed_at IS DISTINCT FROM OLD.refund_claimed_at' || E'\n' ||
      '  OR NEW.refunded_at      IS DISTINCT FROM OLD.refunded_at'      || E'\n' ||
      '  OR NEW.refund_ref       IS DISTINCT FROM OLD.refund_ref'       || E'\n' ||
      '  OR NEW.refund_amount    IS DISTINCT FROM OLD.refund_amount'    || E'\n' ||
      '  OR NEW.refund_reason    IS DISTINCT FROM OLD.refund_reason'    || E'\n' ||
      '  OR NEW.refund_by        IS DISTINCT FROM OLD.refund_by'        || E'\n' ||
      '  ' || v_anchor);
  EXECUTE v_src;
  RAISE NOTICE '✅ أعمدة الاسترداد السبعة مجمّدة على جلسة العميل.';
END
$freeze$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٤) 🔴 القفل — أخطرُ دالّةٍ في هذا الإصدار
-- ═══════════════════════════════════════════════════════════════════════════
-- عقدُها: **ok:true مرّةً واحدة لا غير** لكلّ ردّ. من يحصل عليها هو وحده من
-- يُسمح له أن يُنادي مزوّد الدفع. ومن لم يحصل عليها لا يُنادي شيئاً.
--
-- 🔴 كيف يضمن قفلُ الصفّ ذلك — بالتفصيل، لأن هذا موضع الخطأ الشائع:
--    `SELECT … FOR UPDATE` يأخذ قفلاً على **صفّ الحجز** (لا على الجدول). فلو
--    وصل نداءان في اللحظة نفسها — ضغطتان على الزرّ، أو تبويبان، أو إعادةُ
--    إرسالٍ من الشبكة — فإن أحدهما يأخذ القفل والثاني **يتوقّف منتظراً**
--    (لا يقرأ صفّاً قديماً ولا يمضي). وحين يُنهي الأوّل معاملته (وكلّ نداء
--    PostgREST معاملةٌ مستقلّة تُختم بالـCOMMIT)، يستيقظ الثاني و`FOR UPDATE`
--    تحت `READ COMMITTED` **تُعيد قراءة أحدث نسخةٍ مثبَّتة** من الصفّ لا نسخةَ
--    لقطتِه الأولى — فيرى `refund_state = 'claiming'` ويردّ `ALREADY_CLAIMING`.
--    أي: ok:true واحدة، بالضبط. (ولو رُفع مستوى العزل إلى REPEATABLE READ
--    لانفجر الثاني بخطأ تسلسل بدل أن يردّ بلطف — وهو أيضاً ليس ردّاً مزدوجاً.)
-- 🪤 ولا يُستبدل هذا بـ`UPDATE … WHERE refund_state IS NULL` وفحصِ عدد الصفوف:
--    ذاك يصحّ للقفل وحده، لكنّنا نحتاج قراءة `paid_at` و`payment_ref` والمبلغ
--    من **نفس** اللقطة المقفولة؛ فصلُهما يفتح نافذةً بينهما.
DROP FUNCTION IF EXISTS public.taki_claim_booking_refund(text, text);
CREATE FUNCTION public.taki_claim_booking_refund(p_barcode text, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_me     text := (SELECT auth.uid()::text);
  v_system boolean := public.taki_is_system_caller();
  v_b      public.bookings%ROWTYPE;
  v_amt    numeric;
  v_actor  text;
BEGIN
  IF p_barcode IS NULL OR btrim(p_barcode) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'BARCODE_REQUIRED');
  END IF;
  -- 🔴 `current_user` هنا هو **مالكُ الدالّة** لا المنادي (درس v14.96: أربعة
  --    حرّاس كانت عاطلةً تماماً بسببه). التمييزُ الوحيد الصحيح للنظام هو
  --    `taki_is_system_caller()`.
  IF v_me IS NULL AND NOT v_system THEN
    RETURN jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED');
  END IF;

  SELECT * INTO v_b FROM public.bookings
   WHERE barcode = upper(btrim(p_barcode))
   FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;

  -- الصلاحية: صاحبُ المتجر، أو النظام (دالّة الحافة تنادي بـservice_role حين
  -- تُتمّ مساراً بدأه التاجر)، أو أدمنٌ يملك تبويب المدفوعات صراحةً.
  -- 🪤 ولا تُستعمل `is_admin()`: تُرجع TRUE لأيّ أدمن عند النداء المباشر (v14.38).
  IF v_system THEN
    v_actor := 'system';
  ELSIF v_me = v_b.store_id THEN
    v_actor := 'merchant';
  ELSIF public.taki_admin_perm('tab_launch') THEN
    v_actor := 'admin';
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_MERCHANT');
  END IF;

  IF v_b.paid_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_PAID');
  END IF;
  IF v_b.refund_state = 'refunded' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ALREADY_REFUNDED',
                              'refunded_at', v_b.refunded_at, 'ref', v_b.refund_ref);
  END IF;
  IF v_b.refund_state = 'claiming' THEN
    -- 🔴 النصّ محلُّ عقدٍ: تُفحص هذه القيمةُ حرفياً في القسم ٧ وفي دالّة الحافة.
    RETURN jsonb_build_object('ok', false, 'error', 'ALREADY_CLAIMING',
                              'claimed_at', v_b.refund_claimed_at);
  END IF;

  -- 🔴 وهذا الفحصُ يسدّ ثقباً **بين مسارين**، لا داخل مسارٍ واحد: مسارُ v14.18
  --    اليدويّ (`resolve_booking_refund`) يختم «رُدّ» في `booking_refunds` ولا
  --    يمسّ `refund_state` — فتاجرٌ سجّل ردّه يدوياً أمسِ يجد اليوم زرَّ الردّ
  --    الفوريّ مفتوحاً، فيُخرج المبلغ **مرّتين** من حسابه ويُصدر إشعاراً دائناً
  --    ثانياً. حالتان في جدولين لا تحرس إحداهما الأخرى ما لم تُسأل صراحةً.
  -- 🪤 وترتيبُ القفل هنا (الحجز ثمّ الاسترداد) هو نفسه في
  --    `resolve_booking_refund` — عكسُه يصنع جمود قفلٍ بين المسارين.
  PERFORM 1 FROM public.booking_refunds WHERE barcode = v_b.barcode FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.booking_refunds
              WHERE barcode = v_b.barcode AND status = 'refunded') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ALREADY_REFUNDED',
                              'source', 'manual');
  END IF;
  -- يمرّ من هنا: NULL (لم يُطلب قطّ) و 'failed' (رفضَه المزوّد ⇒ إعادةُ محاولة).
  -- ولا يُطلَق سراحُ 'claiming' بمرور الوقت أبداً: نداءٌ ظنّناه ميتاً قد يكون
  -- نجح عند المزوّد، وإطلاقُه بالتخمين = ردٌّ مزدوج من حساب التاجر.

  v_amt := round(COALESCE(NULLIF(v_b.paid_amount, 0), v_b.total_amount, 0), 2);
  IF NOT (v_amt > 0) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ZERO_AMOUNT');
  END IF;
  IF v_b.payment_provider IS NULL OR btrim(COALESCE(v_b.payment_ref, '')) = '' THEN
    -- بلا مرجع المزوّد لا يوجد ما يُردّ عليه. يُقال صراحةً بدل نداءٍ يفشل عنده.
    RETURN jsonb_build_object('ok', false, 'error', 'NO_PAYMENT_REF');
  END IF;

  UPDATE public.bookings
     SET refund_state      = 'claiming',
         refund_claimed_at = now(),
         refund_amount     = v_amt,
         refund_reason     = NULLIF(left(btrim(COALESCE(p_reason, '')), 600), ''),
         refund_by         = v_actor,
         refund_ref        = NULL          -- محاولةٌ جديدة ⇒ مرجعٌ جديد
   WHERE barcode = v_b.barcode;

  RETURN jsonb_build_object(
    'ok', true, 'barcode', v_b.barcode, 'amount', v_amt,
    'provider', v_b.payment_provider, 'ref', v_b.payment_ref, 'by', v_actor);
END
$fn$;

REVOKE ALL ON FUNCTION public.taki_claim_booking_refund(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_claim_booking_refund(text,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.taki_claim_booking_refund(text,text) TO authenticated, service_role;

COMMENT ON FUNCTION public.taki_claim_booking_refund(text,text) IS
  'يحجز حقّ نداء مزوّد الدفع للردّ. ok:true مرّةً واحدة لكلّ ردّ بقفل صفّ الحجز. لا يحرّك مالاً بنفسه.';

-- ═══════════════════════════════════════════════════════════════════════════
-- ٥) الختم — يكتبه النظامُ وحده بعد أن يردّ المزوّد
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 ولا يُعاد استعمالُ `resolve_booking_refund` هنا رغم تشابه الأثر: تلك
--    تشترط `auth.uid()` وتشترط وجودَ صفّ طلبٍ قائم (`NO_REQUEST`)، والمسارُ
--    الفوريّ لا يملك الأوّل (service_role) وقد لا يملك الثاني (التاجر يردّ
--    بمبادرته). فتُكرَّر **قواعدُها** لا نداؤها: نفس المبلغ، ونفس الإشعار
--    الدائن، ونفس شرط إعادة الكمّية (`cancelled_by = 'refund'`).
DROP FUNCTION IF EXISTS public.taki_settle_booking_refund(text, boolean, text, text);
CREATE FUNCTION public.taki_settle_booking_refund(
  p_barcode    text,
  p_ok         boolean,
  p_refund_ref text DEFAULT NULL,
  p_reason     text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_b         public.bookings%ROWTYPE;
  v_amt       numeric;
  v_seq       integer;
  v_cn        text;
  v_shop      text;
  v_money     text;
  v_cancelled boolean := false;
  v_rows      integer;
  v_ref       text := NULLIF(left(btrim(COALESCE(p_refund_ref, '')), 120), '');
  v_reason    text := NULLIF(left(btrim(COALESCE(p_reason, '')), 600), '');
BEGIN
  -- خدمةٌ وحدها. لا تاجر ولا أدمن: من يختم يجب أن يكون قد رأى ردّ المزوّد.
  IF NOT public.taki_is_system_caller() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;
  IF p_barcode IS NULL OR btrim(p_barcode) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'BARCODE_REQUIRED');
  END IF;

  SELECT * INTO v_b FROM public.bookings
   WHERE barcode = upper(btrim(p_barcode))
   FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;

  -- خاملةُ التكرار: إعادةُ إرسالٍ من الشبكة بعد ختمٍ ناجح لا تُصدر إشعاراً
  -- دائناً ثانياً ولا تحرق رقماً من سلسلة التاجر (درس v14.21).
  IF v_b.refund_state = 'refunded' THEN
    RETURN jsonb_build_object('ok', true, 'already', true, 'state', 'refunded',
                              'ref', v_b.refund_ref, 'refunded_at', v_b.refunded_at);
  END IF;
  IF v_b.refund_state IS DISTINCT FROM 'claiming' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_CLAIMING',
                              'state', v_b.refund_state);
  END IF;

  -- ── فشلٌ عند المزوّد: يُطلَق سراحُ القفل ويبقى سببُه ظاهراً للتاجر ───────
  IF NOT COALESCE(p_ok, false) THEN
    UPDATE public.bookings
       SET refund_state  = 'failed',
           refund_reason = COALESCE(v_reason, refund_reason)
     WHERE barcode = v_b.barcode;
    RETURN jsonb_build_object('ok', true, 'state', 'failed', 'reason', v_reason);
  END IF;

  -- ── نجاح: المال خرج فعلاً من حساب التاجر ────────────────────────────────
  v_amt := round(COALESCE(NULLIF(v_b.refund_amount, 0),
                          NULLIF(v_b.paid_amount, 0), v_b.total_amount, 0), 2);
  IF NOT (v_amt > 0) THEN RETURN jsonb_build_object('ok', false, 'error', 'ZERO_AMOUNT'); END IF;

  SELECT COALESCE(NULLIF(u.shop, ''), u.name) INTO v_shop
    FROM public.users u WHERE u.id = v_b.store_id;

  -- إشعارٌ دائن بسلسلةٍ مستقلّة لكلّ تاجر — ذرّيّ وبلا فجوات (v14.17).
  -- 🪤 ولا يُسحب رقمٌ جديد إن كان للطلب إشعارٌ دائن من قبل: السلسلة الضريبية
  --    لا تحتمل فجوة، وسحبُ رقمٍ ثمّ إهمالُه فجوةٌ دائمة (درس v14.21).
  SELECT credit_note_no INTO v_cn
    FROM public.booking_refunds WHERE barcode = v_b.barcode FOR UPDATE;
  IF v_cn IS NULL THEN
    INSERT INTO public.store_invoice_counters (store_id, last_credit_seq)
    VALUES (v_b.store_id, 1)
    ON CONFLICT (store_id) DO UPDATE
      SET last_credit_seq = public.store_invoice_counters.last_credit_seq + 1,
          updated_at = now()
    RETURNING last_credit_seq INTO v_seq;
    v_cn := 'CN-' || lpad(v_seq::text, 6, '0');
  END IF;

  -- صفّ `booking_refunds` هو ما تقرؤه الفاتورةُ والبوتان، فيُكتب هنا أيضاً —
  -- سواءٌ فُتح بطلبٍ من المشتري أو لم يُفتح قطّ (ردٌّ بمبادرة التاجر).
  INSERT INTO public.booking_refunds
    (barcode, store_id, buyer_id, status, opened_by, amount, merchant_note,
     decided_at, decided_by, refunded_at, refund_amount, refund_ref, refund_method,
     credit_note_no, updated_at)
  VALUES
    (v_b.barcode, v_b.store_id, v_b.user_id, 'refunded', 'seller', v_amt, v_reason,
     now(), v_b.store_id, now(), v_amt, v_ref, 'gateway', v_cn, now())
  ON CONFLICT (barcode) DO UPDATE
    SET status         = 'refunded',
        decided_at     = COALESCE(public.booking_refunds.decided_at, now()),
        merchant_note  = COALESCE(EXCLUDED.merchant_note, public.booking_refunds.merchant_note),
        refunded_at    = now(),
        refund_amount  = EXCLUDED.refund_amount,
        refund_ref     = EXCLUDED.refund_ref,
        refund_method  = 'gateway',
        credit_note_no = COALESCE(public.booking_refunds.credit_note_no, EXCLUDED.credit_note_no),
        updated_at     = now()
  RETURNING credit_note_no INTO v_cn;

  UPDATE public.bookings
     SET refund_state = 'refunded',
         refunded_at  = now(),
         refund_ref   = v_ref,
         refund_amount = v_amt
   WHERE barcode = v_b.barcode;

  -- نفس قاعدة v14.21 حرفياً: الطلبُ المفتوح يُلغى وتعود كمّيته، والمكتملُ لا —
  -- البضاعة خرجت فعلاً، فلا نَعِد التاجر بما لن يحدث.
  IF v_b.status IN ('pending', 'acknowledged') THEN
    UPDATE public.bookings SET status = 'cancelled', cancelled_by = 'refund'
     WHERE barcode = v_b.barcode;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_cancelled := v_rows > 0;
  END IF;

  v_money := trim(to_char(v_amt, 'FM999999990.09'));

  PERFORM public._refund_notify(v_b.user_id,
    '✅ رُدّ المبلغ إلى بطاقتك', 'Your refund has been issued',
    'ردّ «' || COALESCE(v_shop, 'المتجر') || '» ' || v_money || ' ر.س عن الطلب ' || v_b.barcode
      || COALESCE(' — المرجع: ' || v_ref, '')
      || '. إشعار دائن رقم ' || v_cn || ' على فاتورتك. '
      || 'المبلغ غادر حساب التاجر الآن، ومدّة وصوله إلى بطاقتك تحدّدها جهة الدفع لا تاكي.',
    '"' || COALESCE(v_shop, 'The store') || '" refunded ' || v_money || ' SAR for order ' || v_b.barcode
      || COALESCE(' — reference: ' || v_ref, '')
      || '. Credit note ' || v_cn || ' is on your invoice. '
      || 'The time it takes to reach your card is set by the payment provider, not TAKI.',
    v_b.barcode, 'buyer', 'refund_done');

  PERFORM public._refund_notify(v_b.store_id,
    '✅ نُفِّذ ردّ المبلغ', 'Refund executed',
    'نُفِّذ ردّ ' || v_money || ' ر.س عن الطلب ' || v_b.barcode || ' عبر بوّابتك، بإشعار دائن ' || v_cn || '. '
      || CASE WHEN v_cancelled
              THEN 'وأُلغي الطلب وعادت الكمّية للبيع.'
              ELSE 'والطلب مُغلق أصلاً فلم تعد كمّيته للبيع — البضاعة خرجت فعلاً.' END,
    'A refund of ' || v_money || ' SAR for order ' || v_b.barcode
      || ' was executed through your gateway as credit note ' || v_cn || '. '
      || CASE WHEN v_cancelled THEN 'The order was cancelled and the stock returned.'
              ELSE 'The order was already closed, so the stock did not return.' END,
    v_b.barcode, 'seller', 'refund_done');

  RETURN jsonb_build_object('ok', true, 'state', 'refunded', 'amount', v_amt,
                            'credit_note_no', v_cn, 'ref', v_ref,
                            'order_cancelled', v_cancelled);
END
$fn$;

REVOKE ALL ON FUNCTION public.taki_settle_booking_refund(text,boolean,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_settle_booking_refund(text,boolean,text,text) FROM anon;
REVOKE ALL ON FUNCTION public.taki_settle_booking_refund(text,boolean,text,text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.taki_settle_booking_refund(text,boolean,text,text) TO service_role;

COMMENT ON FUNCTION public.taki_settle_booking_refund(text,boolean,text,text) IS
  'يختم نتيجة نداء المزوّد: refunded (إشعار دائن + إلغاء + إشعار المشتري) أو failed (يُطلق القفل لإعادة المحاولة). service_role وحده.';

-- ═══════════════════════════════════════════════════════════════════════════
-- ٥ب) والاتّجاه المعاكس من الثقب نفسه — ترقيعٌ من النصّ **الحيّ**
-- ═══════════════════════════════════════════════════════════════════════════
-- سدّ القسمُ ٤ الاتّجاهَ الأوّل (يدويٌّ سابق ⇒ يُمنع الفوريّ). وهذا يسدّ الثاني:
-- المسار اليدويّ (`resolve_booking_refund`) لا يعرف شيئاً عن `refund_state`،
-- فتاجرٌ ضغط الزرّ الفوريّ ثمّ — والنداءُ ما زال جارياً — سجّل ردّاً يدوياً،
-- كان يُصدر إشعاراً دائناً ثانياً ويُلغي الطلب مرّتين. الحالتان في جدولين،
-- ولا تحرس إحداهما الأخرى ما لم تُسأل صراحةً.
-- 🪤 `decline` وحدها تمرّ: رفضُ طلبٍ لا يحرّك مالاً ولا يُصدر إشعاراً دائناً.
DO $manual$
DECLARE
  v_src    text;
  v_anchor text := 'IF v_b.paid_at IS NULL THEN RETURN jsonb_build_object(''ok'', false, ''error'', ''NOT_PAID''); END IF;';
BEGIN
  v_src := pg_get_functiondef(
    'public.resolve_booking_refund(text,text,text,numeric,text,text)'::regprocedure);
  IF position('refund_state' IN v_src) > 0 THEN
    RAISE NOTICE 'ℹ️ المسار اليدويّ يعرف الحالة الفوريّة أصلاً — لا تغيير.'; RETURN; END IF;
  IF position(v_anchor IN v_src) = 0 THEN
    RAISE EXCEPTION '❌ مرساةُ resolve_booking_refund غير موجودة — أوقِفت بلا تغيير. (بلا هذا الترقيع يمكن ردُّ المبلغ مرّتين.)'; END IF;
  v_src := replace(v_src, v_anchor, v_anchor || E'\n' ||
    '  -- v14.97 — لا تسجيلَ يدويّ فوق ردٍّ فوريّ جارٍ أو تمّ.' || E'\n' ||
    '  IF p_action <> ''decline'' AND v_b.refund_state IN (''claiming'', ''refunded'') THEN' || E'\n' ||
    '    RETURN jsonb_build_object(''ok'', false, ''error'',' || E'\n' ||
    '      CASE WHEN v_b.refund_state = ''claiming'' THEN ''REFUND_IN_FLIGHT'' ELSE ''ALREADY_REFUNDED'' END);' || E'\n' ||
    '  END IF;');
  EXECUTE v_src;
  RAISE NOTICE '✅ المسار اليدويّ صار يرى الردّ الفوريّ — لا ردَّ مرّتين.';
END
$manual$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٦) مفتاحُ الإعداد يجب أن تراه سياسةُ القراءة — ترقيعٌ من النصّ **الحيّ**
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 درس v14.92: سياسةُ `platform_settings_select` تحمل قائمةَ سماحٍ صريحة
--    بأسماء المفاتيح. مفتاحٌ خارجها يعود `SELECT` عنه بـ**صفر صفوفٍ لا بخطأ**،
--    فترتدّ الواجهة إلى الافتراضي وتبدو سليمةً تماماً — وضبطُ ناصر لا أثر له.
--    ويُرقَّع النصُّ الحيّ لا نسخةٌ في الهجرة: وإلا حُذفت مفاتيحُ لا نعلم بها.
DO $patch$
DECLARE v_qual text; v_roles text;
BEGIN
  SELECT pg_get_expr(p.polqual, p.polrelid),
         COALESCE((SELECT string_agg(quote_ident(r.rolname), ', ')
                     FROM pg_roles r WHERE r.oid = ANY(p.polroles)), 'public')
    INTO v_qual, v_roles
    FROM pg_policy p
   WHERE p.polrelid = 'public.platform_settings'::regclass
     AND p.polname  = 'platform_settings_select';
  IF v_qual IS NULL THEN
    RAISE EXCEPTION 'السياسة platform_settings_select غير موجودة — أوقِفت قبل أن أهدم شيئاً.'; END IF;
  IF position('''refund_window''' IN v_qual) > 0 THEN
    RAISE NOTICE 'ℹ️ refund_window مُدرَجٌ أصلاً — لا تغيير.'; RETURN; END IF;
  -- المرساة: المفتاحُ الذي أدرجته v14.95. غيابُه يعني أن النصّ الحيّ ليس ما أظنّ.
  IF position('''verification''::text' IN v_qual) = 0 THEN
    RAISE EXCEPTION 'تعذّر إدراج المفتاح: نصّ السياسة الحيّ لا يطابق المرساة (''verification''::text). أوقِفت بلا تغيير.'; END IF;
  v_qual := replace(v_qual, '''verification''::text', '''verification''::text, ''refund_window''::text');
  IF position('''refund_window''' IN v_qual) = 0 THEN
    RAISE EXCEPTION 'الاستبدال لم يقع — أوقِفت بلا تغيير.'; END IF;
  -- 🪤 تُنسخ الأدوارُ حرفياً: ٦٣ من ٦٤ سياسة كانت `TO public`، وإعادةُ بنائها
  --    بـ`authenticated` كانت ستحجب الإعدادات عن الزوّار (درس v14.38).
  EXECUTE format(
    'DROP POLICY IF EXISTS platform_settings_select ON public.platform_settings; '
    'CREATE POLICY platform_settings_select ON public.platform_settings '
    'FOR SELECT TO %s USING (%s);', v_roles, v_qual);
  RAISE NOTICE '✅ أُدرج refund_window في سياسة القراءة (الأدوار: %)', v_roles;
END
$patch$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٧) التحقّق — `DO` يرفع استثناءً. (جدول ✅/❌ لا يُفشل psql — درس v14.50)
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE
  v_src   text;
  v_qual  text;
  v_pol   jsonb;
  v_bc    text;
  v_r1    jsonb;
  v_r2    jsonb;
  n       integer;
BEGIN
  SELECT count(*) INTO n FROM public.bookings;
  IF n = 0 THEN
    RAISE EXCEPTION '❌ لا حجوزات على هذا الخادم — وأخطرُ دالّةٍ هنا (القفل) لا تُصدَّق بلا قياسٍ على صفٍّ حقيقي.';
  END IF;

  -- ── الإعداد ──────────────────────────────────────────────────────────────
  SELECT count(*) INTO n FROM public.platform_settings WHERE key = 'refund_window';
  IF n <> 1 THEN RAISE EXCEPTION '❌ مفتاح refund_window غير موجود (%).', n; END IF;

  v_pol := public.taki_refund_policy();
  IF (v_pol->>'hours')::int <> 2 THEN
    RAISE EXCEPTION '❌ الافتراضي ليس ساعتين (%) — الهجرة يجب أن تهبط بالقيمة المعلنة.', v_pol->>'hours'; END IF;
  IF (v_pol->>'merchant_button')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION '❌ زرّ التاجر مطفأ افتراضياً — وهو الميزة نفسها.'; END IF;

  -- القصّ يُقاس لا يُفترض: قيمةٌ خارج المجال يجب أن تعود مقصوصةً، لا كما هي.
  UPDATE public.platform_settings SET value = '{"hours":99999,"merchant_button":true}'::jsonb
   WHERE key = 'refund_window';
  IF (public.taki_refund_policy()->>'hours')::int <> 720 THEN
    RAISE EXCEPTION '❌ لا قصَّ للسقف: ٩٩٩٩٩ ساعة مرّت كما هي.'; END IF;
  UPDATE public.platform_settings SET value = '{"hours":-5,"merchant_button":true}'::jsonb
   WHERE key = 'refund_window';
  IF (public.taki_refund_policy()->>'hours')::int <> 0 THEN
    RAISE EXCEPTION '❌ لا قصَّ للأرضية: قيمةٌ سالبة مرّت.'; END IF;
  UPDATE public.platform_settings SET value = '{"hours":"غير رقم","merchant_button":"نعم"}'::jsonb
   WHERE key = 'refund_window';
  IF (public.taki_refund_policy()->>'hours')::int <> 2
     OR (public.taki_refund_policy()->>'merchant_button')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION '❌ قيمةٌ تالفة لم ترتدّ إلى الافتراضي — هذا شكل الخطأ الصامت.'; END IF;
  -- وتُعاد القيمة المعلنة
  UPDATE public.platform_settings SET value = '{"hours":2,"merchant_button":true}'::jsonb
   WHERE key = 'refund_window';

  -- ── الأعمدة والقيد ───────────────────────────────────────────────────────
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'bookings'
     AND column_name IN ('refund_state','refund_claimed_at','refunded_at',
                         'refund_ref','refund_amount','refund_reason','refund_by');
  IF n <> 7 THEN RAISE EXCEPTION '❌ أعمدة الاسترداد %/7.', n; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.bookings'::regclass
                    AND conname = 'bookings_refund_state_chk') THEN
    RAISE EXCEPTION '❌ قيد bookings_refund_state_chk غير موجود.'; END IF;

  -- والقيد يُقاس سالباً: قيمةٌ خارج الأربع يجب أن **تُرفض**.
  BEGIN
    UPDATE public.bookings SET refund_state = 'قيمة_ليست_في_القيد'
     WHERE barcode = (SELECT barcode FROM public.bookings LIMIT 1);
    RAISE EXCEPTION '❌ القيد لا يمنع شيئاً — قيمةٌ خارج الأربع مرّت.';
  EXCEPTION
    WHEN check_violation THEN NULL;   -- المطلوب بالضبط
  END;

  -- ── التجميد على جلسة العميل (القسم ٣) ────────────────────────────────────
  SELECT pg_get_functiondef('public.tr_guard_booking_integrity()'::regprocedure) INTO v_src;
  IF position('refund_state' IN v_src) = 0
     OR position('refunded_at' IN v_src) = 0
     OR position('refund_ref' IN v_src) = 0
     OR position('refund_amount' IN v_src) = 0
     OR position('refund_by' IN v_src) = 0
     OR position('refund_claimed_at' IN v_src) = 0
     OR position('refund_reason' IN v_src) = 0 THEN
    RAISE EXCEPTION '❌ أعمدة الاسترداد غير مجمَّدة — التاجر يستطيع كتابة «رُدّ المبلغ» بلا ريال.'; END IF;
  -- وما كان مجمّداً لم يضِع
  IF position('NEW.total_amount' IN v_src) = 0 OR position('NEW.paid_at' IN v_src) = 0
     OR position('NEW.delivery_fee' IN v_src) = 0 THEN
    RAISE EXCEPTION '❌ فُقدت أعمدةٌ كانت مجمّدة — تراجَعْ فوراً.'; END IF;
  -- 🪤 وقائمةٌ مجمَّدة داخل دالّةٍ غير مركَّبة لا تحرس شيئاً: يُفحص الوصلُ نفسه
  --    على الجدول، لا وجودُ الدالّة (درس «حارسٌ لم يُربط بالسلسلة»).
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid = 'public.bookings'::regclass
       AND NOT t.tgisinternal
       AND t.tgfoid = 'public.tr_guard_booking_integrity()'::regprocedure
       AND (t.tgtype & 4) > 0     -- INSERT
       AND (t.tgtype & 16) > 0    -- UPDATE
       AND (t.tgtype & 2) > 0     -- BEFORE
  ) THEN
    RAISE EXCEPTION '❌ tr_guard_booking_integrity غير مركَّبة BEFORE INSERT OR UPDATE على bookings — القائمة المجمَّدة زينة.'; END IF;

  -- ── الدالّتان + صلاحياتهما ───────────────────────────────────────────────
  IF to_regprocedure('public.taki_claim_booking_refund(text,text)') IS NULL THEN
    RAISE EXCEPTION '❌ taki_claim_booking_refund غير موجودة.'; END IF;
  IF to_regprocedure('public.taki_settle_booking_refund(text,boolean,text,text)') IS NULL THEN
    RAISE EXCEPTION '❌ taki_settle_booking_refund غير موجودة.'; END IF;
  IF to_regprocedure('public.taki_refund_policy()') IS NULL THEN
    RAISE EXCEPTION '❌ taki_refund_policy غير موجودة.'; END IF;

  IF has_function_privilege('anon', 'public.taki_claim_booking_refund(text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION '❌ anon يملك تنفيذ الطلب — فحصٌ سالب فشل.'; END IF;
  IF NOT has_function_privilege('authenticated', 'public.taki_claim_booking_refund(text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION '❌ التاجر (authenticated) لا يصل دالّة الطلب — الزرّ ميّت.'; END IF;
  IF has_function_privilege('anon', 'public.taki_settle_booking_refund(text,boolean,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.taki_settle_booking_refund(text,boolean,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION '❌ الختم مفتوحٌ لغير service_role — أيّ تاجر يستطيع أن يختم ردّاً لم يقع.'; END IF;
  IF NOT has_function_privilege('service_role', 'public.taki_settle_booking_refund(text,boolean,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION '❌ service_role لا يصل الختم — المسار كلّه معطّل.'; END IF;
  IF has_function_privilege('anon', 'public.taki_refund_policy()', 'EXECUTE') THEN
    RAISE EXCEPTION '❌ anon يملك تنفيذ taki_refund_policy.'; END IF;

  -- ── وعقدُ القفل نفسه: نصُّ الخطأ ليس زينة ────────────────────────────────
  SELECT pg_get_functiondef('public.taki_claim_booking_refund(text,text)'::regprocedure) INTO v_src;
  IF position('FOR UPDATE' IN v_src) = 0 THEN
    RAISE EXCEPTION '❌ لا قفل صفّ في دالّة الطلب — ضغطتان تردّان المبلغ مرّتين.'; END IF;
  IF position('ALREADY_CLAIMING' IN v_src) = 0 THEN
    RAISE EXCEPTION '❌ نصّ ALREADY_CLAIMING غائب.'; END IF;
  IF position('taki_is_system_caller' IN v_src) = 0 THEN
    RAISE EXCEPTION '❌ الدالّة تميّز النظام بغير taki_is_system_caller (درس v14.96).'; END IF;
  -- 🪤 يُجرَّد التعليقُ قبل الفحص: كلمةُ `current_user` ترد في **تعليقٍ يحذّر
  --    منها** داخل هذه الدالّة نفسها، ونمطٌ ساذج كان يتّهمها بما تحرس منه —
  --    وهو فخٌّ وقعنا فيه من قبل (v14.86: نمطٌ أمسك إفصاحَنا المنفيّ).
  IF position('current_user' IN regexp_replace(v_src, '--[^\n]*', '', 'g')) > 0 THEN
    RAISE EXCEPTION '❌ current_user داخل SECURITY DEFINER = مالكُ الدالّة لا المنادي. حارسٌ عاطل.'; END IF;
  -- والمسارُ اليدويّ مرئيٌّ للفوريّ (الاتّجاه الأوّل من الثقب)
  IF position('booking_refunds' IN v_src) = 0 THEN
    RAISE EXCEPTION '❌ الطلب الفوريّ لا يسأل عن ردٍّ يدويٍّ سابق — يُخرج المبلغ مرّتين من حساب التاجر.'; END IF;

  -- والعكس (الاتّجاه الثاني): المسارُ اليدويّ يرى الفوريّ
  SELECT pg_get_functiondef(
    'public.resolve_booking_refund(text,text,text,numeric,text,text)'::regprocedure) INTO v_src;
  IF position('refund_state' IN v_src) = 0 OR position('REFUND_IN_FLIGHT' IN v_src) = 0 THEN
    RAISE EXCEPTION '❌ المسار اليدويّ لا يرى الردّ الفوريّ — تسجيلٌ يدويّ فوق نداءٍ جارٍ = ردٌّ مزدوج.'; END IF;
  -- وما كان فيه لم يضِع (الترقيع جراحيّ لا إعادةُ كتابة)
  IF position('credit_note_no' IN v_src) = 0 OR position('cancelled_by' IN v_src) = 0
     OR position('FOR UPDATE' IN v_src) = 0 THEN
    RAISE EXCEPTION '❌ ضاع منطقٌ من resolve_booking_refund أثناء الترقيع — تراجَعْ فوراً.'; END IF;

  -- والختمُ لا يسحب رقماً ثانياً لطلبٍ له إشعارٌ دائن (فجوةٌ في سلسلةٍ ضريبية)
  SELECT pg_get_functiondef(
    'public.taki_settle_booking_refund(text,boolean,text,text)'::regprocedure) INTO v_src;
  IF position('IF v_cn IS NULL THEN' IN v_src) = 0 THEN
    RAISE EXCEPTION '❌ الختم يسحب رقم إشعارٍ دائن بلا شرط — فجوةٌ دائمة في سلسلة التاجر.'; END IF;

  -- ── 🔴 والفحص الحاسم: نداءان متتاليان ⇒ ok واحدة، وبنصّ الخطأ المتّفق عليه.
  --     يجري كلُّه داخل **معاملةٍ فرعيّة تُلغى عمداً**، فلا يمسّ صفّاً حقيقياً.
  BEGIN
    SELECT b.barcode INTO v_bc FROM public.bookings b
     WHERE b.paid_at IS NOT NULL
       AND b.refund_state IS NULL
       AND COALESCE(NULLIF(b.paid_amount, 0), b.total_amount, 0) > 0
       AND b.payment_provider IS NOT NULL
       AND btrim(COALESCE(b.payment_ref, '')) <> ''
       -- ولا صفٌّ مستردٌّ يدوياً: الحارسُ الجديد يرفضه بحقّ، فيُفسد القياس.
       AND NOT EXISTS (SELECT 1 FROM public.booking_refunds r
                        WHERE r.barcode = b.barcode AND r.status = 'refunded')
     LIMIT 1;

    IF v_bc IS NULL THEN
      -- لا طلبَ مدفوعاً صالحاً اليوم ⇒ يُصنَع الشرطُ على صفٍّ قائم **داخل هذه
      -- المعاملة الفرعيّة الملغاة**. أرفضُ أن أُصدّق قفلاً لم أره يعمل.
      -- (تُطلق هذه الكتابةُ مشغّلَ إصدار الفاتورة، وهو يعود NULL حين لا مسوّدة
      --  ولا يرفع استثناءً — وكلُّ أثرٍ له يُلغى مع المعاملة.)
      SELECT b.barcode INTO v_bc FROM public.bookings b
       WHERE NOT EXISTS (SELECT 1 FROM public.booking_refunds r
                          WHERE r.barcode = b.barcode AND r.status = 'refunded')
       ORDER BY b.booked_at DESC LIMIT 1;
      IF v_bc IS NULL THEN RAISE EXCEPTION 'TAKI_CLAIM1:كلّ الحجوزات مستردّة يدوياً'; END IF;
      UPDATE public.bookings
         SET paid_at = now(), paid_amount = 10,
             payment_provider = 'sim', payment_ref = 'verify_v1497'
       WHERE barcode = v_bc;
    END IF;

    v_r1 := public.taki_claim_booking_refund(v_bc, 'فحصُ القفل — تُلغى هذه المعاملة كاملةً');
    v_r2 := public.taki_claim_booking_refund(v_bc, 'النداء الثاني');

    IF NOT COALESCE((v_r1->>'ok')::boolean, false) THEN
      RAISE EXCEPTION 'TAKI_CLAIM1:%', COALESCE(v_r1->>'error', v_r1::text); END IF;
    IF COALESCE((v_r2->>'ok')::boolean, false) THEN
      RAISE EXCEPTION 'TAKI_CLAIM2_OK'; END IF;
    -- 🪤 ويُشترط النصّ **حرفياً** لا «وقع خطأ»: دالّةُ الحافة تفرّق بين
    --    ALREADY_CLAIMING (لا تُعِد النداء) و NOT_PAID (خطأ آخر تماماً).
    IF COALESCE(v_r2->>'error', '') <> 'ALREADY_CLAIMING' THEN
      RAISE EXCEPTION 'TAKI_CLAIM2_MSG:%', COALESCE(v_r2->>'error', '(بلا نصّ)'); END IF;

    -- استثناءٌ متعمَّد: يُلغي كلَّ ما كُتب أعلاه فلا يمسّ الفحصُ صفّاً حقيقياً.
    RAISE EXCEPTION 'TAKI_ROLLBACK_OK';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'TAKI_ROLLBACK_OK' THEN
        RAISE NOTICE '✅ القفل مقيس على صفٍّ حقيقي: نداءان ⇒ ok واحدة، والثاني ALREADY_CLAIMING حرفياً (والمعاملة أُلغيت).';
      ELSIF SQLERRM LIKE 'TAKI_CLAIM1:%' THEN
        RAISE EXCEPTION '❌ النداء الأوّل فشل (%) — القفل لا يعمل أصلاً.', SQLERRM;
      ELSIF SQLERRM = 'TAKI_CLAIM2_OK' THEN
        RAISE EXCEPTION '❌ نداءان ⇒ ok مرّتين. هذا ردٌّ مزدوج من حساب التاجر. لا تُشحن.';
      ELSIF SQLERRM LIKE 'TAKI_CLAIM2_MSG:%' THEN
        RAISE EXCEPTION '❌ الثاني رُفض بنصٍّ غير ALREADY_CLAIMING (%) — العقد مع دالّة الحافة مكسور.', SQLERRM;
      ELSE
        RAISE EXCEPTION '❌ فحص القفل انفجر: %', SQLERRM;
      END IF;
  END;

  -- ── سياسة القراءة ────────────────────────────────────────────────────────
  SELECT pg_get_expr(polqual, polrelid) INTO v_qual FROM pg_policy
   WHERE polrelid = 'public.platform_settings'::regclass
     AND polname  = 'platform_settings_select';
  IF v_qual IS NULL OR position('''refund_window''' IN v_qual) = 0 THEN
    RAISE EXCEPTION '❌ refund_window محجوبٌ عن القراءة — سترتدّ الواجهة للافتراضي بصمت وضبطُ ناصر بلا أثر.'; END IF;
  IF position('''verification''' IN v_qual) = 0 OR position('''merchant_vat''' IN v_qual) = 0
     OR position('''booking_holds''' IN v_qual) = 0 OR position('''chat_limits''' IN v_qual) = 0
     OR position('''complaints_sla_hours''' IN v_qual) = 0 THEN
    RAISE EXCEPTION '❌ فُقدت مفاتيح كانت مسموحة — تراجَعْ فوراً.'; END IF;

  -- ── 🔴 الفحص السالب الأهمّ: `store_can_sell` لم تُمسّ ─────────────────────
  SELECT pg_get_functiondef('public.store_can_sell(text)'::regprocedure) INTO v_src;
  IF position('refund' IN v_src) > 0 THEN
    RAISE EXCEPTION '❌ دخل الاسترداد إلى store_can_sell — هذا يُوقف الحجز على كلّ عرضٍ حيّ.'; END IF;
  IF NOT has_function_privilege('anon', 'public.store_can_sell(text)', 'EXECUTE') THEN
    RAISE EXCEPTION '❌ store_can_sell فقدت منح anon — صفحةُ العرض ستنكسر.'; END IF;

  -- ── وأثرُ الهبوط صفر: لا صفّ حجزٍ تغيّرت حالتُه ───────────────────────────
  SELECT count(*) INTO n FROM public.bookings WHERE refund_state IS NOT NULL;
  IF n <> 0 THEN
    RAISE EXCEPTION '❌ % صفّاً يحمل حالةَ استرداد بعد هجرةٍ لم تُنفّذ ردّاً — أثرٌ غير مقصود.', n; END IF;

  RAISE NOTICE '✅ v14.97 هبطت بأثرٍ صفر: النافذة ساعتان · الزرّ مفتوح · الأعمدة مجمّدة على العميل · القفل مقيس بنداءين · store_can_sell لم تُمسّ.';
END
$verify$;

COMMIT;
