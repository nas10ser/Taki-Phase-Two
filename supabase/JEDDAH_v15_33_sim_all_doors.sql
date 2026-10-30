-- ═══════════════════════════════════════════════════════════════════════════
-- v15.33 — حارسُ `sim` كان يحرس باباً من ثلاثة
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 قِيس على الإنتاج (جدّة، ٣٠ أكتوبر ٢٠٢٦): متجرُ ناصر `2c0b4cde…` يحمل
--    `provider='sim'` — المحاكاةُ التي تختم الطلبَ «مدفوعاً» بلا ريال —
--    و`verified_at = ٣٠ أكتوبر ٠٩:١٨ UTC` و`is_enabled = true`، ومعه
--    **٦ عروضٍ حيّة** و`accepts_cod=false` ⇒ `deal_payment_mode='both'`
--    ⇒ «ادفع الآن» معروضٌ لأيّ زائر، ويُختم الطلبُ مدفوعاً بلا مال.
--
-- ولماذا نفذ رغم v15.31: ذلك الحارسُ على بابِ **الحفظ** وحده
--    (`merchant_set_gateway` و`_gateway_write`). وللبوّابة **ثلاثةُ أبواب**:
--      ١) حفظُ المفاتيح            ← محروس (v15.31)
--      ٢) «🔌 اختبار الاتصال»       ← `_stamp_gateway_verified` — **مفتوح**
--      ٣) «تفعيل البوابة»           ← `merchant_toggle_gateway` — **مفتوح**
--    والصفُّ كان `sim` منذ يوليو، فلم يمرّ ببابِ الحفظ أصلاً: كفى زرّان.
--
-- 🪤 الدرس: حارسٌ على دالّةٍ واحدة ليس حارساً على **حالة**. يُجرَد كلُّ من
--    يكتب العمودَ المحروس (`pg_get_functiondef` + اسمُ العمود)، لا من يبدو
--    البابَ الطبيعيّ. ثلاثُ دوالّ تكتب `verified_at`/`is_enabled` هنا.
--
-- 🟢 وهذه الهجرة **لا تُغيّر إعدادات متجرٍ قائم**: تمنع التكرار فقط.
--    وإطفاءُ الصفِّ الحيّ قرارُ ناصر (يُطفئ «ادفع الآن» ويحتاج منه إقراراً
--    بالدفع عند الاستلام، وإلّا صار متجرُه بلا وسيلةِ تحصيلٍ أصلاً).
-- ═══════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر. أوقِفت.';
  END IF;
  IF to_regprocedure('public._stamp_gateway_verified(text)') IS NULL
     OR to_regprocedure('public.merchant_toggle_gateway(boolean)') IS NULL THEN
    RAISE EXCEPTION 'إحدى الدالّتين غائبة — الأساسُ مختلف، أوقِفت.';
  END IF;
END
$guard$;

-- ── البابُ الثاني: «اختبار الاتصال» ─────────────────────────────────────────
-- 🪤 كانت `LANGUAGE sql` فلا مكانَ فيها لشرط. وشرطٌ في `WHERE` كان سيُنتج
--    صفرَ صفٍّ **بلا خطأ** — أي «نجح الاختبار» كذباً (درس الخزنة v14.44).
CREATE OR REPLACE FUNCTION public._stamp_gateway_verified(p_merchant_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_prov text;
BEGIN
  SELECT lower(coalesce(provider,'')) INTO v_prov
    FROM public.merchant_gateways WHERE merchant_id = p_merchant_id;
  IF v_prov = 'sim' THEN RAISE EXCEPTION 'SIM_NOT_ALLOWED'; END IF;
  UPDATE public.merchant_gateways
     SET verified_at = now(), fail_count = 0, updated_at = now()
   WHERE merchant_id = p_merchant_id;
  -- كتابةٌ بصفر صفوفٍ ليست نجاحاً — والمنادي يظنّ أنها كذلك.
  IF NOT FOUND THEN RAISE EXCEPTION 'NO_GATEWAY'; END IF;
END
$function$;

-- ── البابُ الثالث: «تفعيل البوابة» ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.merchant_toggle_gateway(p_enabled boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid text := auth.uid()::text; v_row public.merchant_gateways%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT * INTO v_row FROM public.merchant_gateways WHERE merchant_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'NO_GATEWAY'; END IF;
  IF p_enabled THEN
    -- v15.33 — قبل كلّ شرطٍ آخر: المحاكاةُ لا تُفعَّل من لوحة التاجر.
    IF lower(coalesce(v_row.provider,'')) = 'sim' THEN RAISE EXCEPTION 'SIM_NOT_ALLOWED'; END IF;
    IF v_row.agreement_accepted_at IS NULL THEN RAISE EXCEPTION 'AGREEMENT_REQUIRED'; END IF;
    IF NOT public._gateway_secret_live(v_uid) THEN RAISE EXCEPTION 'KEYS_REQUIRED'; END IF;
    IF v_row.verified_at IS NULL THEN RAISE EXCEPTION 'VERIFY_REQUIRED'; END IF;
  END IF;
  UPDATE public.merchant_gateways
  SET is_enabled = p_enabled, fail_count = CASE WHEN p_enabled THEN 0 ELSE fail_count END, updated_at = now()
  WHERE merchant_id = v_uid;
  INSERT INTO public.activity_log (user_id, user_type, action, entity_type, entity_id, metadata)
  VALUES (v_uid, 'seller', CASE WHEN p_enabled THEN 'gateway_enabled' ELSE 'gateway_disabled' END,
          'merchant_gateway', v_uid, '{}'::jsonb);
  RETURN public.get_my_gateway();
END $function$;

-- ── تحقّقٌ سلوكيّ يُفشل الهجرة إن كذبت ──────────────────────────────────────
-- 🪤 لا يُقبل «أيُّ استثناء» — يُشترط SIM_NOT_ALLOWED بعينه. وحالةٌ موجبة
--    تُثبت أن مزوّداً حقيقياً ما زال يمرّ، وإلّا شحنّا حارساً يمنع الجميع.
BEGIN;
DO $test$
DECLARE v_sim text; v_real text; v_err text; v_hit boolean;
BEGIN
  SELECT merchant_id INTO v_sim  FROM public.merchant_gateways WHERE lower(provider) = 'sim'   LIMIT 1;
  SELECT merchant_id INTO v_real FROM public.merchant_gateways WHERE lower(provider) <> 'sim'  LIMIT 1;
  IF v_sim IS NULL OR v_real IS NULL THEN
    RAISE EXCEPTION '❌ لا عيّنتان (sim=% · حقيقيّ=%) — الفحصُ لم يُجرَ، وهذا فشل', coalesce(v_sim,'∅'), coalesce(v_real,'∅');
  END IF;

  -- (أ) سالب: «اختبار الاتصال» على sim يُرفض بالرمز بعينه.
  v_hit := false;
  BEGIN PERFORM public._stamp_gateway_verified(v_sim);
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    v_hit := position('SIM_NOT_ALLOWED' IN v_err) > 0;
    IF NOT v_hit THEN RAISE EXCEPTION '❌ سقط لسببٍ آخر: %', v_err; END IF;
  END;
  IF NOT v_hit THEN RAISE EXCEPTION '❌ بابُ «اختبار الاتصال» ما زال مفتوحاً لـsim'; END IF;

  -- (ب) موجب: مزوّدٌ حقيقيّ يمرّ من نفس الباب (الحارسُ لم يُقفل الجميع).
  PERFORM public._stamp_gateway_verified(v_real);

  -- (ج) سالب: «تفعيل البوابة» على sim يُرفض — بانتحال هويّة صاحبها.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_sim, 'role', 'authenticated')::text, true);
  v_hit := false;
  BEGIN PERFORM public.merchant_toggle_gateway(true);
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    v_hit := position('SIM_NOT_ALLOWED' IN v_err) > 0;
    IF NOT v_hit THEN RAISE EXCEPTION '❌ سقط لسببٍ آخر: %', v_err; END IF;
  END;
  IF NOT v_hit THEN RAISE EXCEPTION '❌ بابُ «تفعيل البوابة» ما زال مفتوحاً لـsim'; END IF;

  -- (د) والإطفاءُ يبقى متاحاً دائماً — وإلّا حُبس التاجرُ داخل بوّابةٍ معطوبة.
  PERFORM public.merchant_toggle_gateway(false);

  PERFORM set_config('request.jwt.claims', NULL, true);
  RAISE NOTICE '✅ مُثبَت: البابان مُغلقان أمام sim · ومزوّدٌ حقيقيّ ما زال يمرّ · والإطفاءُ متاح';
END
$test$;
ROLLBACK;

SELECT 'المختبر؟' AS البند, coalesce(obj_description('public'::regnamespace,'pg_namespace'),'لا — جدّة') AS القيمة
UNION ALL SELECT 'حارس _stamp_gateway_verified',
  CASE WHEN position('SIM_NOT_ALLOWED' IN pg_get_functiondef(to_regprocedure('public._stamp_gateway_verified(text)')::oid)) > 0
       THEN '✅ مشحون' ELSE '❌ غائب' END
UNION ALL SELECT 'حارس merchant_toggle_gateway',
  CASE WHEN position('SIM_NOT_ALLOWED' IN pg_get_functiondef(to_regprocedure('public.merchant_toggle_gateway(boolean)')::oid)) > 0
       THEN '✅ مشحون' ELSE '❌ غائب' END
UNION ALL SELECT '⚠️ بوّاباتُ sim مفعّلةٌ الآن (قرارُ ناصر)',
  (SELECT count(*)::text FROM public.merchant_gateways WHERE lower(provider)='sim' AND is_enabled);
