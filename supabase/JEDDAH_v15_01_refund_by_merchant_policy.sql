-- ═══════════════════════════════════════════════════════════════════════════
-- v15.01 — الاسترداد بسياسة التاجر، لا بوعدٍ من المنصّة
-- ═══════════════════════════════════════════════════════════════════════════
-- طلبُ ناصر: «اجعلها على حسب سياسات التاجر، واجعل الخيار متاحاً في حال أراد
--            استخدامها، ولا أريد للموقع أن يتدخّل».
--
-- 🔴 وما بُني في v14.97 كان يخالف هذا فعلاً — لا في الكود بل في **الوعد**:
--    `refund_window.hours` كانت تجعل صفحةَ الاسترداد تقول للمشتري «خلال
--    ساعتين **تضمن TAKI**…». وتاكي لا تملك المال ولا تنفّذ الردّ ولا تستطيع
--    إجبار تاجرٍ عليه — فذلك ضمانٌ لا يقف خلفه شيء. وهو بالضبط الفخّ
--    المسجَّل في قواعد المشروع: **وثيقةٌ تَعِد بما لا يُنفّذه كود**.
--    وكان أيضاً يخالف مبدأ v14.18 الأصلي: «تاكي وسيط، تُسجّل وتُبلّغ وتُثبت
--    — ولا تبتّ».
--
-- ما يصير بعد هذا الملفّ:
--   • **الردّ بنقرة خيارٌ يملكه التاجر** (`store_profiles.instant_refund`)،
--     مفتوحٌ افتراضياً ويُطفئه من لوحته متى شاء.
--   • **والسياسة سياستُه** — نصُّ `refund_policy` الذي يكتبه هو، يُعرض للمشتري
--     في صفحة العرض وصفحة المتجر قبل الحجز، وهو المرجع.
--   • والمنصّة لا تَعِد بمهلةٍ ولا تفرضها. يبقى لها مفتاحُ إطفاءٍ عامّ
--     **للطوارئ التقنية وحدها** (عطبُ مزوّدٍ مثلاً)، لا كسياسة.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── حارس: هذه هجرة إنتاج (جدّة) ────────────────────────────────────────────
DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر. أوقِفت.';
  END IF;
  IF to_regprocedure('public.taki_claim_booking_refund(text,text)') IS NULL THEN
    RAISE EXCEPTION 'v14.97 لم تُطبَّق — لا شيء لأعدّله. أوقِفت.';
  END IF;
END
$guard$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ١) الخيار بيد التاجر
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.store_profiles
  ADD COLUMN IF NOT EXISTS instant_refund boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.store_profiles.instant_refund IS
  'هل يُظهر هذا المتجر زرّ الردّ الفوريّ؟ خيارُ التاجر وحده (v15.01). مفتوحٌ افتراضياً.';

-- 🪤 ولا يُترك للتاجر أن يكتبه مباشرةً على الجدول: `store_profiles_update`
--    تسمح `uid() = store_id`، لكن `tr_guard_store_billing` يحرس أعمدة الفوترة
--    وحدها — فعمودٌ جديد بلا حارسٍ يبقى مفتوحاً. وهذا العمود **مقبولٌ أن
--    يكتبه التاجر** (هو خيارُه)، لكن عبر دالّةٍ كي يبقى مسارُ الكتابة واحداً
--    ومسجَّلاً، لا نداءً مباشراً من المتصفّح على الجدول.
DROP FUNCTION IF EXISTS public.merchant_set_instant_refund(boolean);
CREATE FUNCTION public.merchant_set_instant_refund(p_on boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE v_me text := (SELECT auth.uid())::text; v_type text; n int;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED'); END IF;
  SELECT user_type INTO v_type FROM public.users WHERE id = v_me AND deleted_at IS NULL;
  IF v_type IS NULL OR v_type NOT IN ('seller', 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_A_MERCHANT');
  END IF;

  INSERT INTO public.store_profiles (store_id, instant_refund)
  VALUES (v_me, COALESCE(p_on, true))
  ON CONFLICT (store_id) DO UPDATE
    SET instant_refund = EXCLUDED.instant_refund, updated_at = now();
  GET DIAGNOSTICS n = ROW_COUNT;
  -- 🪤 صفرُ صفوفٍ بلا خطأ هو شكلُ الرفض الصامت الذي تعيده RLS — يُثبَت العدد.
  IF n = 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_SAVED'); END IF;

  INSERT INTO public.activity_log (user_id, user_type, action, entity_type, entity_id, metadata)
  VALUES (v_me, v_type, 'instant_refund_toggled', 'store', v_me,
          jsonb_build_object('on', COALESCE(p_on, true)));

  RETURN jsonb_build_object('ok', true, 'instant_refund', COALESCE(p_on, true));
END
$fn$;

REVOKE ALL ON FUNCTION public.merchant_set_instant_refund(boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merchant_set_instant_refund(boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.merchant_set_instant_refund(boolean) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٢) القفل يحترم خيار التاجر — ويُعاد بناؤه من نصّه الحيّ
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 لا يُعاد كتابةُ الدالّة من الذاكرة: فيها قفلُ الصفّ ومنطقُ الحالات
--    ورسائلُ الأخطاء التي يعتمد عليها `merchant-pay` حرفياً. يُقرأ نصُّها
--    الحيّ ويُحقن شرطٌ واحد، ويُتحقّق من وقوع الحقن.
DO $patch$
DECLARE v_src text; v_new text; v_anchor text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f'
     AND p.proname = 'taki_claim_booking_refund';
  IF v_src IS NULL THEN RAISE EXCEPTION '❌ taki_claim_booking_refund غير موجودة.'; END IF;

  IF position('MERCHANT_REFUND_OFF' IN v_src) > 0 THEN
    RAISE NOTICE 'ℹ️ الشرط مُدرَجٌ أصلاً — لا تغيير.';
    RETURN;
  END IF;

  -- المرساة: أوّلُ فحصٍ بعد جلب صفّ الحجز — «هل هذا الطلب مدفوع؟».
  v_anchor := 'NOT_PAID';
  IF position(v_anchor IN v_src) = 0 THEN
    RAISE EXCEPTION '❌ نصُّ الدالّة الحيّ لا يحوي المرساة «%» — أوقِفت بلا تغيير.', v_anchor;
  END IF;

  -- يُحقن **قبل** فحص الدفع مباشرةً: خيارُ التاجر يسبق كلَّ شيء، فلو كان
  -- مطفأً لا يُفحص شيءٌ آخر ولا يُحجز الصفّ.
  v_new := replace(
    v_src,
    'IF v_b.paid_at IS NULL THEN',
    'IF NOT COALESCE((SELECT sp.instant_refund FROM public.store_profiles sp'
    || ' WHERE sp.store_id = v_b.store_id), true) AND NOT v_system THEN'
    || E'\n    -- v15.01 — التاجر أطفأ الردّ الفوريّ من لوحته. خيارُه، والمنصّة'
    || E'\n    --          لا تتدخّل. (ويبقى المسارُ اليدويّ `booking_refunds` قائماً،'
    || E'\n    --          وتبقى الإدارةُ قادرةً على الفكّ عند الحاجة — `v_system`.)'
    || E'\n    RETURN jsonb_build_object(''ok'', false, ''error'', ''MERCHANT_REFUND_OFF'');'
    || E'\n  END IF;'
    || E'\n  IF v_b.paid_at IS NULL THEN');

  IF v_new = v_src OR position('MERCHANT_REFUND_OFF' IN v_new) = 0 THEN
    RAISE EXCEPTION '❌ لم يقع الحقن — نصُّ الدالّة لا يطابق المتوقَّع. أوقِفت بلا تغيير.';
  END IF;

  EXECUTE v_new;
  RAISE NOTICE '✅ القفل صار يحترم خيار التاجر.';
END
$patch$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٣) المنصّة لا تَعِد بمهلة — المفتاحُ العامّ صار فرملةَ طوارئ لا سياسة
-- ═══════════════════════════════════════════════════════════════════════════
-- `hours = 0` تعني: **لا وعدَ زمنيّ من المنصّة**. والواجهةُ تقرأ ذلك فتحذف
-- الجملة من الصفحات القانونية بدل أن تعرض «خلال ٠ ساعة».
UPDATE public.platform_settings
   SET value = jsonb_build_object(
         'hours', 0,
         'merchant_button', COALESCE((value->>'merchant_button')::boolean, true)),
       description = 'فرملةُ طوارئ تقنية للردّ الفوريّ (v15.01): merchant_button=false يُطفئه للجميع عند عطبِ مزوّد. hours=0 دائماً — المنصّة لا تَعِد بمهلة، والسياسة سياسةُ التاجر.',
       updated_at = now()
 WHERE key = 'refund_window';

-- ═══════════════════════════════════════════════════════════════════════════
-- ٤) تحقّقٌ يرفع استثناءً — ويُقاس السلوك لا الوجود
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE v_src text; n int;
BEGIN
  -- (أ) العمود والدالّة والمنح
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='store_profiles'
                    AND column_name='instant_refund') THEN
    RAISE EXCEPTION '❌ العمود instant_refund لم يُضف.';
  END IF;
  IF to_regprocedure('public.merchant_set_instant_refund(boolean)') IS NULL THEN
    RAISE EXCEPTION '❌ دالّةُ التبديل لم تُنشأ.';
  END IF;
  IF has_function_privilege('anon', 'public.merchant_set_instant_refund(boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION '❌ الزائر يستطيع تبديل خيار متجرٍ ليس له.';
  END IF;

  -- (ب) الشرط داخل القفل فعلاً
  SELECT pg_get_functiondef('public.taki_claim_booking_refund(text,text)'::regprocedure) INTO v_src;
  IF position('MERCHANT_REFUND_OFF' IN v_src) = 0 THEN
    RAISE EXCEPTION '❌ القفل لا يقرأ خيار التاجر.';
  END IF;
  IF position('FOR UPDATE' IN v_src) = 0 OR position('ALREADY_CLAIMING' IN v_src) = 0 THEN
    RAISE EXCEPTION '❌ فُقد قفلُ الصفّ أو نصُّ ALREADY_CLAIMING أثناء الحقن — خطرُ ردٍّ مرّتين.';
  END IF;

  -- (ج) 🪤 **ما لا يستطيع هذا الملفّ إثباته، ويقوله صراحةً.**
  --     الشرط المحقون يتخطّاه `v_system` عمداً (الإدارةُ تفكّ العالق حتى لو
  --     أطفأ التاجر). و`taki_is_system_caller()` تقرأ `session_user`، و`psql`
  --     يتّصل بـ`supabase_admin` — فالجلسةُ «نظام» مهما بدّلنا الدور، ولا
  --     يمكن انتحالُ متصفّحٍ من هنا. حاولتُ قياساً سلوكياً فردّ `NOT_PAID`
  --     لا `MERCHANT_REFUND_OFF`: ليس عيباً في الشرط بل في مكان الاختبار.
  --     (هذا بعينه درسُ v14.96، ووقعتُ فيه ثانيةً.)
  --     فيُثبَت هنا **الموضع** — وهو ما يمكن إثباته يقيناً — ويُقاس السلوك
  --     بطلبٍ حقيقيّ من المتصفّح.
  IF position('MERCHANT_REFUND_OFF' IN v_src) > position('NOT_PAID' IN v_src) THEN
    RAISE EXCEPTION '❌ شرطُ التاجر بعد فحص الدفع — سيُحجز الصفّ قبل أن يُسأل التاجر.';
  END IF;
  IF position('instant_refund' IN v_src) = 0 THEN
    RAISE EXCEPTION '❌ الشرط لا يقرأ العمود instant_refund.';
  END IF;
  IF position('NOT v_system' IN v_src) = 0 THEN
    RAISE EXCEPTION '❌ الإدارةُ لا تتخطّى الشرط — استردادٌ عالقٌ لمتجرٍ أطفأ الخيار يصير بلا مخرج.';
  END IF;
  RAISE NOTICE 'ℹ️ الموضعُ مُثبَت؛ والسلوكُ يُقاس بطلبٍ حقيقيّ من المتصفّح لا من psql.';

  -- (د) المنصّة لا تَعِد بمهلة
  IF (public.taki_refund_policy()->>'hours')::numeric <> 0 THEN
    RAISE EXCEPTION '❌ المنصّة ما زالت تَعِد بمهلة (% ساعة) — والوعدُ ليس لها.',
      public.taki_refund_policy()->>'hours';
  END IF;

  -- (هـ) ولا متجرَ فقد خيارَه بالخطأ
  SELECT count(*) INTO n FROM public.store_profiles WHERE instant_refund IS NOT TRUE;
  IF n > 0 THEN
    RAISE EXCEPTION '❌ % متجراً صار خيارُه مطفأً بعد هجرةٍ افتراضُها الفتح.', n;
  END IF;

  RAISE NOTICE '✅ v15.01: الخيار بيد التاجر (مفتوحٌ للجميع) · القفل يحترمه · والمنصّة لا تَعِد بمهلة.';
END
$verify$;
