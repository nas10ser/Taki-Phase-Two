-- ═══════════════════════════════════════════════════════════════════════════
-- v15.69 — خمسةُ عيوبٍ حرجةٍ في منطق الاشتراك، وجدتها مراجعةٌ خصميّة
-- ═══════════════════════════════════════════════════════════════════════════
-- كلُّها في كودٍ كتبتُه اليوم (v15.67/68). وليس أحدُها حيّاً بعد — لأن أسرارَ
-- أبل وقوقل غيرُ مضبوطة فلا معاملةَ حقيقيّةَ تمرّ — لكنها كانت ستكون حيّةً
-- في أوّل يومٍ يدفع فيه ناصر.
--
-- ١) 🔴 **تاريخُ الانتهاء الحقيقيّ كان يُرمى.** `taki_iap_apply` تستلم من أبل
--    أو قوقل تاريخَ «مدفوعٌ حتى» في `p_expires_at`، وتكتبه في جدول الاشتراك
--    وفي صفّ الدفعة — ثمّ تُسلّم التفعيلَ إلى `_taki_apply_package` التي
--    **لا تأخذ تاريخاً إطلاقاً** فتحسب `now() + durationDays` من الكتالوج.
--    أي ثلاثةُ أرقامٍ لمدّةٍ واحدة في نداءٍ واحد.
--    ⇒ وأثرُه في اتّجاهين، كلاهما مقيسٌ من الكود:
--      (أ) **منحٌ مجّانيّ**: زرُّ «استعادة المشتريات» (يُلزم به متجرُ أبل،
--          وبلا أيّ حدِّ معدّل) يُعيد النداءَ، فتُعاد الصلاحيّةُ إلى
--          `now()+٣٠` في كلّ ضغطة — فمن يضغطه يومياً يبقى مشتركاً للأبد.
--          وأسوأُ عند قوقل: حالةُ المهلة (بطاقةٌ فشلت) تُحسب «سارياً».
--      (ب) **نافذةٌ مظلمةٌ كلَّ شهرٍ من ٣١ يوماً**: المنحةُ ٣٠ يوماً والمتجرُ
--          يُحصّل بالشهر التقويميّ، فتنشأ فجوةٌ ~٢٤ ساعة. وفي الفجوة يعمل
--          `taki_subscription_maintenance` الساعيّ فيُجمّد كلَّ عروض التاجر
--          ويُطفئ بانراته ويُنزله إلى `free`. ثمّ يأتي إشعارُ التجديد فيُعيد
--          `premium` **ولا يُذيب الجمود**: `tg_unfreeze_on_upgrade` تشترط
--          ارتفاعَ `max_branches` وهو لم يتغيّر. فمتجرُ تاجرٍ يدفع يُظلم
--          شهرياً **ويبقى مظلماً**.
-- ٢) 🔴 **شراءُ بيئة الاختبار كان يُفعّل اشتراكاً حقيقياً** ويكتب صفَّ دفعةٍ
--    «مدفوعة». العمودُ `environment` كان يُكتب ولا يقرؤه أحد، و`appleLookup`
--    تسقط إلى خادم الاختبار عند ٤٠٤ **وهو المسارُ الطبيعيّ** لشراء اختبار.
-- ٣) 🔴 **إلغاءُ التاجر كان يُمحى عند كل تجديد**: `auto_renew = true` و
--    `subscription_canceled_at = NULL` مكتوبتان حرفيّاً في شِقَّي التحديث،
--    و`p_auto_renew` يُستلم ثمّ يُرمى — فمن أوقف التجديد يعود مُفعَّلاً.
-- ٤) 🔴 **استبدالُ المالك كان صامتاً ويردّ نجاحاً**: إن كان الشراءُ مسجَّلاً
--    لحسابٍ آخر، تُستبدل هويّةُ المنادي بهويّة المالك ويُفعَّل **للمالك**،
--    ويردّ الطلبُ ٢٠٠ فترى الشاشةُ «✅ تم تفعيل اشتراكك» لمن لم يُفعَّل له
--    شيء. والحماية صحيحة — **والردُّ كذب**.
-- ٥) 🔴 **تسلسلُ أرقام الفواتير يُحرَق**: مشغّلٌ `BEFORE INSERT` يُسند
--    `nextval` قبل كشف التعارض، و`ON CONFLICT DO NOTHING` لا يُعيد الرقم.
--    فكلُّ إعادةِ إشعارٍ (وأبل تُعيد أيّاماً) تحرق رقماً من تسلسلٍ **ضريبيّ
--    يُفترض ألّا فجوةَ فيه**. يُفحص الوجودُ قبل الإدراج.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'')
     = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه قاعدةُ المختبر (طوكيو) — الهجرةُ لجدة وحدها.';
  END IF;
END $$;

-- ── مفتاحُ السماح ببيئة الاختبار (مطفأٌ افتراضاً) ────────────────────────
-- 🪤 وميزةٌ غيرُ مؤكَّدةٍ تفشل **مغلقة**: `= true` لا `!== false`.
INSERT INTO public.platform_settings (key, value)
VALUES ('iap_allow_sandbox', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ── ١+٣) الموضعُ الواحد يستلم التاريخَ وحالةَ التجديد ────────────────────
-- 🪤 و`CREATE OR REPLACE` **لا يضيف معاملاً**: يُنشئ نسخةً ثانيةً فيصير
--    النداءُ ملتبساً («function is not unique»). يُحذف أوّلاً بلا CASCADE.
DROP FUNCTION IF EXISTS public._taki_apply_package(text, integer);

CREATE FUNCTION public._taki_apply_package(
  p_store_id    text,
  p_package_id  integer,
  p_expires_at  timestamptz DEFAULT NULL,   -- «مدفوعٌ حتى» من المتجر
  p_auto_renew  boolean     DEFAULT NULL    -- NULL = لا تمسّ حالةَ الإلغاء
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_pkg   jsonb;
  v_price numeric; v_disc numeric; v_days integer; v_max integer; v_net numeric;
  v_now   timestamptz := now();
  v_end   timestamptz;
BEGIN
  SELECT pkg INTO v_pkg
    FROM public.platform_settings ps,
         LATERAL jsonb_array_elements(ps.value) AS pkg
   WHERE ps.key = 'location_packages' AND (pkg->>'id')::int = p_package_id
   LIMIT 1;
  IF v_pkg IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unknown_package');
  END IF;
  IF COALESCE((v_pkg->>'active')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('success', false, 'error', 'package_inactive');
  END IF;

  v_price := COALESCE((v_pkg->>'price')::numeric, 0);
  v_disc  := COALESCE((v_pkg->>'discount')::numeric, 0);
  v_days  := COALESCE((v_pkg->>'durationDays')::int, 30);
  v_max   := COALESCE((v_pkg->>'max')::int, 1);
  v_net   := round(v_price * (1 - (v_disc / 100.0)), 2);

  -- 🔴 تاريخُ المتجر هو الحاكم إن وُجد، ومدّةُ الكتالوج ارتدادٌ لمسار
  --    البوّابة وحده (حيث لا متجرَ يُحدّد تاريخاً). وبهذا:
  --      • تُصبح الاستعادةُ المتكرّرة بلا أثر (نفسُ التاريخ يُكتب).
  --      • وتزول الفجوةُ الشهريّة: تاريخُ أبل **هو** موعدُ التحصيل التالي.
  v_end := COALESCE(p_expires_at, v_now + make_interval(days => v_days));
  IF v_end <= v_now THEN
    RETURN jsonb_build_object('success', false, 'error', 'expiry_in_past',
                              'expires_at', v_end);
  END IF;

  INSERT INTO public.store_profiles (
    store_id, subscription_plan, subscription_started_at, subscription_expires_at,
    subscription_amount, max_branches, subscription_package_id,
    auto_renew, subscription_canceled_at, updated_at)
  VALUES (p_store_id, 'premium', v_now, v_end, v_net, v_max, p_package_id,
          COALESCE(p_auto_renew, true),
          CASE WHEN p_auto_renew IS FALSE THEN v_now ELSE NULL END, v_now)
  ON CONFLICT (store_id) DO UPDATE SET
    subscription_plan        = EXCLUDED.subscription_plan,
    -- 🪤 وبدايةُ الاشتراك لا تُعاد عند التجديد: إعادتُها تُفقد تاريخَ أوّل
    --    اشتراكٍ وتُفسد تقاريرَ الأقدميّة والاستبقاء.
    subscription_started_at  = COALESCE(public.store_profiles.subscription_started_at,
                                        EXCLUDED.subscription_started_at),
    -- ولا تُقصَّر صلاحيّةٌ قائمةٌ بتاريخٍ أقدم (إشعارٌ متأخّرٌ أو خارجُ ترتيب).
    subscription_expires_at  = GREATEST(EXCLUDED.subscription_expires_at,
                                        COALESCE(public.store_profiles.subscription_expires_at,
                                                 EXCLUDED.subscription_expires_at)),
    subscription_amount      = EXCLUDED.subscription_amount,
    max_branches             = EXCLUDED.max_branches,
    subscription_package_id  = EXCLUDED.subscription_package_id,
    -- 🔴 وحالةُ التجديد تُحترم: NULL تعني «لا تمسّها» (مسارُ البوّابة
    --    يُفعّلها، والمتجرُ يقول حالتَه الحقيقيّة).
    auto_renew               = CASE WHEN p_auto_renew IS NULL THEN true ELSE p_auto_renew END,
    subscription_canceled_at = CASE
                                 WHEN p_auto_renew IS FALSE
                                   THEN COALESCE(public.store_profiles.subscription_canceled_at, v_now)
                                 ELSE NULL END,
    updated_at               = EXCLUDED.updated_at;

  RETURN jsonb_build_object('success', true, 'plan', 'premium', 'amount', v_net,
    'days', v_days, 'max_branches', v_max,
    'expires_at', (SELECT subscription_expires_at FROM public.store_profiles
                    WHERE store_id = p_store_id),
    'package_ar', v_pkg->>'ar', 'net', v_net,
    'from_store_date', p_expires_at IS NOT NULL);
END $$;
REVOKE ALL ON FUNCTION public._taki_apply_package(text, integer, timestamptz, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._taki_apply_package(text, integer, timestamptz, boolean) FROM anon, authenticated;

-- ── ٢+٤+٥) تطبيقُ الشراء: بيئةٌ تُفحص · مالكٌ لا يُستبدل صامتاً · فاتورةٌ لا تُحرق
CREATE OR REPLACE FUNCTION public.taki_iap_apply(
  p_store_id    text,
  p_platform    text,
  p_product_id  text,
  p_purchase_key text,
  p_latest_txn  text,
  p_expires_at  timestamptz,
  p_environment text,
  p_auto_renew  boolean,
  p_event       text,
  p_raw         jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_pkg_id  integer;
  v_owner   text;
  v_res     jsonb;
  v_net     numeric;
  v_pay_id  text;
  v_plan_id text;
  v_env     text := COALESCE(p_environment, 'Production');
BEGIN
  IF NOT public.taki_is_system_caller() THEN
    RAISE EXCEPTION 'IAP_SERVER_ONLY' USING HINT = 'IAP_SERVER_ONLY';
  END IF;
  IF p_platform NOT IN ('apple', 'google') THEN
    RAISE EXCEPTION 'IAP_BAD_PLATFORM' USING HINT = 'IAP_BAD_PLATFORM';
  END IF;
  IF COALESCE(p_purchase_key, '') = '' THEN
    RAISE EXCEPTION 'IAP_NO_KEY' USING HINT = 'IAP_NO_KEY';
  END IF;

  -- 🔴 بيئةُ الاختبار لا تُفعّل اشتراكاً حقيقياً ولا تكتب دفعةً «مدفوعة».
  --    و`appleLookup` تسقط إلى خادم الاختبار عند ٤٠٤ وهو **المسارُ الطبيعيّ**
  --    لشراء اختبار — فبلا هذا الفحص كان شراءُ سَندبوكس يمنح باقةً مجّاناً
  --    ويُدرج إيراداً وهمياً في التقارير والإقرار الضريبيّ.
  IF v_env = 'Sandbox'
     AND COALESCE((SELECT value::text FROM public.platform_settings
                    WHERE key = 'iap_allow_sandbox'), 'false') <> 'true' THEN
    RETURN jsonb_build_object('success', false, 'error', 'sandbox_not_allowed',
      'hint', 'يُفعَّل عمداً بمفتاح iap_allow_sandbox للاختبار وحده');
  END IF;

  SELECT (kv.value->>'package_id')::int INTO v_pkg_id
    FROM public.platform_settings ps, LATERAL jsonb_each(ps.value) AS kv
   WHERE ps.key = 'iap_products' AND kv.key = p_product_id
   LIMIT 1;
  IF v_pkg_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unmapped_product',
      'product_id', p_product_id,
      'hint', 'يُضاف المعرّف بـ scripts/iap-wire-products.js');
  END IF;

  SELECT store_id INTO v_owner FROM public.store_iap_subscriptions
   WHERE platform = p_platform AND purchase_key = p_purchase_key;

  -- 🔴 والمالكُ لا يُستبدل صامتاً. الحمايةُ صحيحة (لا يُسند شراءُ تاجرٍ
  --    لآخر)، لكنّ ردَّ «نجاح» لمن لم يُفعَّل له شيء **كذب**: تُعرض له
  --    «✅ تم تفعيل اشتراكك» ويبقى بلا اشتراك. يُقال له الحقيقةُ برمزٍ صريح.
  --    🪤 و`p_store_id IS NULL` مسارُ الإشعار (لا هويّةَ فيه) فيُقرأ المالك.
  IF p_store_id IS NOT NULL AND v_owner IS NOT NULL AND v_owner <> p_store_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'owned_by_another_account',
      'hint', 'هذا الشراءُ مسجَّلٌ لحسابٍ آخر — سجّل الدخول بذلك الحساب');
  END IF;

  INSERT INTO public.store_iap_subscriptions (
    store_id, platform, product_id, package_id, purchase_key, latest_txn_id,
    environment, status, expires_at, auto_renew, last_event, last_event_at, raw)
  VALUES (p_store_id, p_platform, p_product_id, v_pkg_id, p_purchase_key, p_latest_txn,
          v_env, 'active', p_expires_at, COALESCE(p_auto_renew, true),
          p_event, now(), COALESCE(p_raw, '{}'::jsonb))
  ON CONFLICT (platform, purchase_key) DO UPDATE SET
    store_id      = COALESCE(public.store_iap_subscriptions.store_id, EXCLUDED.store_id),
    product_id    = EXCLUDED.product_id,
    package_id    = EXCLUDED.package_id,
    latest_txn_id = EXCLUDED.latest_txn_id,
    environment   = EXCLUDED.environment,
    status        = 'active',
    expires_at    = EXCLUDED.expires_at,
    auto_renew    = EXCLUDED.auto_renew,
    last_event    = EXCLUDED.last_event,
    last_event_at = now(),
    raw           = EXCLUDED.raw,
    updated_at    = now();

  SELECT store_id INTO v_owner FROM public.store_iap_subscriptions
   WHERE platform = p_platform AND purchase_key = p_purchase_key;
  IF v_owner IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_owner',
      'hint', 'الشراءُ مسجَّلٌ بلا مالك — يربطه التاجر من التطبيق');
  END IF;

  v_res := public._taki_apply_package_dry(v_pkg_id);
  IF NOT COALESCE((v_res->>'success')::boolean, false) THEN RETURN v_res; END IF;
  v_net := (v_res->>'net')::numeric;

  -- 🔴 والفاتورةُ تُفحص **قبل** الإدراج لا بـ`ON CONFLICT DO NOTHING`: مشغّلُ
  --    `tr_invoice_no` يُسند `nextval` قبل كشف التعارض، و`nextval` لا يتراجع
  --    — فكلُّ إعادةِ إشعارٍ تحرق رقماً من تسلسلٍ ضريبيٍّ لا يُفترض أن فيه
  --    فجوة. وأبل تُعيد الإرسال أيّاماً، فالفجواتُ كانت ستتراكم.
  v_pay_id := p_platform || ':' || COALESCE(p_latest_txn, p_purchase_key);
  IF NOT EXISTS (SELECT 1 FROM public.subscription_payments WHERE id = v_pay_id) THEN
    SELECT id INTO v_plan_id FROM public.subscription_plans
     WHERE code = 'premium' OR id = 'premium' LIMIT 1;
    INSERT INTO public.subscription_payments (
      id, merchant_id, plan_id, amount, currency, status, payment_method,
      gateway_provider, gateway_reference, branches_count, period_start, period_end,
      metadata, paid_at, created_at)
    VALUES (
      v_pay_id, v_owner, v_plan_id, v_net, 'SAR', 'paid',
      CASE p_platform WHEN 'apple' THEN 'apple_iap' ELSE 'google_play' END,
      CASE p_platform WHEN 'apple' THEN 'App Store' ELSE 'Google Play' END,
      COALESCE(p_latest_txn, p_purchase_key),
      (v_res->>'max_branches')::int,
      now(), p_expires_at,
      jsonb_build_object('platform', p_platform, 'product_id', p_product_id,
                         'environment', v_env, 'event', p_event,
                         'package_id', v_pkg_id,
                         'source', CASE p_platform WHEN 'apple' THEN 'app_store' ELSE 'play_store' END),
      now(), now());
  END IF;

  -- 🔴 ويُمرَّر تاريخُ المتجر وحالةُ تجديده — وهما ما كان يُرمى.
  RETURN public._taki_apply_package(v_owner, v_pkg_id, p_expires_at, p_auto_renew)
         || jsonb_build_object('payment_id', v_pay_id, 'package_id', v_pkg_id,
                               'environment', v_env);
END $$;
REVOKE ALL ON FUNCTION public.taki_iap_apply(text,text,text,text,text,timestamptz,text,boolean,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_iap_apply(text,text,text,text,text,timestamptz,text,boolean,text,jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.taki_iap_apply(text,text,text,text,text,timestamptz,text,boolean,text,jsonb) TO service_role;

-- ── ٦) ربطُ شراءٍ **معلَّق** بمالكه قبل أن يكتمل ─────────────────────────
-- 🔴 بلا هذا، شراءٌ معلَّق (قوقل تسمح بالدفع نقداً في متجرٍ فعليّ، وأبل تطلب
--    موافقةَ وليٍّ في حساب العائلة) **يُفقد أبداً**: الواجهةُ تَعِد «سيُفعَّل
--    تلقائياً»، والإشعارُ يأتي بعد أيّامٍ بلا هويّة، فلا يجد مالكاً ويُهمَل
--    بـ`no_owner`. فالتاجرُ يدفع ولا ينال شيئاً ولا يعلم.
--    ⇒ تُربط الهويّةُ لحظةَ الشراء، ولا يُفعَّل شيء.
CREATE OR REPLACE FUNCTION public.taki_iap_claim(
  p_store_id text, p_platform text, p_product_id text,
  p_purchase_key text, p_latest_txn text, p_environment text, p_raw jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_pkg_id integer; v_owner text;
BEGIN
  IF NOT public.taki_is_system_caller() THEN
    RAISE EXCEPTION 'IAP_SERVER_ONLY' USING HINT = 'IAP_SERVER_ONLY';
  END IF;
  IF p_platform NOT IN ('apple','google') OR COALESCE(p_purchase_key,'') = ''
     OR COALESCE(p_store_id,'') = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'bad_input');
  END IF;

  SELECT (kv.value->>'package_id')::int INTO v_pkg_id
    FROM public.platform_settings ps, LATERAL jsonb_each(ps.value) AS kv
   WHERE ps.key = 'iap_products' AND kv.key = p_product_id LIMIT 1;
  IF v_pkg_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unmapped_product');
  END IF;

  SELECT store_id INTO v_owner FROM public.store_iap_subscriptions
   WHERE platform = p_platform AND purchase_key = p_purchase_key;
  IF v_owner IS NOT NULL AND v_owner <> p_store_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'owned_by_another_account');
  END IF;

  INSERT INTO public.store_iap_subscriptions (
    store_id, platform, product_id, package_id, purchase_key, latest_txn_id,
    environment, status, expires_at, auto_renew, last_event, last_event_at, raw)
  VALUES (p_store_id, p_platform, p_product_id, v_pkg_id, p_purchase_key, p_latest_txn,
          COALESCE(p_environment,'Production'), 'on_hold', NULL, true,
          'CLAIM_PENDING', now(), COALESCE(p_raw,'{}'::jsonb))
  ON CONFLICT (platform, purchase_key) DO UPDATE SET
    store_id      = COALESCE(public.store_iap_subscriptions.store_id, EXCLUDED.store_id),
    latest_txn_id = COALESCE(EXCLUDED.latest_txn_id, public.store_iap_subscriptions.latest_txn_id),
    last_event    = 'CLAIM_PENDING',
    last_event_at = now(),
    updated_at    = now();
  -- 🪤 ولا تُمسّ حالةٌ قائمة: شراءٌ سارٍ لا يُنزَل إلى «معلَّق» بنداءِ ربط.
  RETURN jsonb_build_object('success', true, 'claimed', true, 'package_id', v_pkg_id);
END $$;
REVOKE ALL ON FUNCTION public.taki_iap_claim(text,text,text,text,text,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_iap_claim(text,text,text,text,text,text,jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.taki_iap_claim(text,text,text,text,text,text,jsonb) TO service_role;

-- ── ومنادو الموضع الواحد يُحدَّثون للصيغة الجديدة ────────────────────────
CREATE OR REPLACE FUNCTION public.subscribe_self_to_package(p_package_id integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_uid text := auth.uid()::text; v_role text; v_res jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;
  SELECT user_type INTO v_role FROM public.users WHERE id = v_uid;
  IF v_role NOT IN ('seller', 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_a_merchant');
  END IF;
  v_res := public._taki_apply_package_dry(p_package_id);
  IF NOT COALESCE((v_res->>'success')::boolean, false) THEN RETURN v_res; END IF;
  IF NOT public._taki_sub_payment_ok(v_uid, p_package_id, (v_res->>'net')::numeric) THEN
    RETURN jsonb_build_object('success', false, 'error', 'payment_not_confirmed');
  END IF;
  -- مسارُ البوّابة: لا تاريخَ من متجرٍ ⇒ مدّةُ الكتالوج، والتجديدُ يُفعَّل.
  RETURN public._taki_apply_package(v_uid, p_package_id, NULL, true);
END $$;

CREATE OR REPLACE FUNCTION public.bot_subscribe_plan(
  p_telegram_id bigint, p_package_id integer, p_whatsapp_id text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_sid text; v_dry jsonb; v_res jsonb; v_pkg jsonb; v_vat numeric;
BEGIN
  IF NOT public.bot_payments_enabled() THEN
    RETURN jsonb_build_object('success', false, 'error', 'free_mode');
  END IF;
  SELECT id INTO v_sid FROM users
   WHERE id = public._bot_uid(p_telegram_id, p_whatsapp_id)
     AND user_type IN ('seller','admin') AND deleted_at IS NULL LIMIT 1;
  IF v_sid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_seller');
  END IF;
  v_dry := public._taki_apply_package_dry(p_package_id);
  IF NOT COALESCE((v_dry->>'success')::boolean, false) THEN
    RETURN jsonb_build_object('success', false, 'error',
      CASE v_dry->>'error' WHEN 'unknown_package' THEN 'bad_package'
                           WHEN 'package_inactive' THEN 'bad_package'
                           ELSE COALESCE(v_dry->>'error','bad_package') END);
  END IF;
  IF NOT public._taki_sub_payment_ok(v_sid, p_package_id, (v_dry->>'net')::numeric) THEN
    RETURN jsonb_build_object('success', false, 'error', 'payment_not_confirmed');
  END IF;
  v_res := public._taki_apply_package(v_sid, p_package_id, NULL, true);
  IF NOT COALESCE((v_res->>'success')::boolean, false) THEN RETURN v_res; END IF;
  SELECT pkg INTO v_pkg FROM public.platform_settings ps,
         LATERAL jsonb_array_elements(ps.value) AS pkg
   WHERE ps.key = 'location_packages' AND (pkg->>'id')::int = p_package_id LIMIT 1;
  SELECT CASE WHEN COALESCE((s.value->>'vat_enabled')::boolean, false)
               AND COALESCE((s.value->>'prices_include_vat')::boolean, true) = false
              THEN round((v_res->>'net')::numeric
                         * COALESCE(NULLIF(s.value->>'vat_rate','')::numeric, 15) / 100, 2)
              ELSE 0 END
    INTO v_vat
    FROM (SELECT value FROM public.platform_settings WHERE key = 'tax_settings'
          UNION ALL SELECT '{}'::jsonb LIMIT 1) s;
  RETURN jsonb_build_object('success', true, 'plan_ar', v_pkg->>'ar',
    'max_branches', (v_res->>'max_branches')::int, 'price', (v_res->>'net')::numeric,
    'expires_at', v_res->>'expires_at', 'days', (v_res->>'days')::int,
    'vat', v_vat, 'total', round((v_res->>'net')::numeric + v_vat, 2));
END $function$;

-- ═══════════════════════════════════════════════════════════════════════════
-- التحقّق — سلوكيٌّ ويرفع، وداخل معاملةٍ تُلفى (يُفعّل على تاجرٍ حقيقيّ)
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $$
DECLARE
  v_sid text; v_other text; v_pkg integer; v_prod text := 'net.takisa.test.v1569';
  v_key text := 'TEST69-' || gen_random_uuid()::text;
  v_r jsonb; v_exp timestamptz; v_seq bigint; v_seq2 bigint; v_n integer;
  v_days integer; v_canc timestamptz; v_ar boolean;
  v_store_date timestamptz := date_trunc('second', now() + interval '58 days');
BEGIN
  SELECT id INTO v_sid FROM public.users
   WHERE user_type IN ('seller','admin') AND deleted_at IS NULL ORDER BY id LIMIT 1;
  SELECT id INTO v_other FROM public.users
   WHERE id <> v_sid AND deleted_at IS NULL ORDER BY id LIMIT 1;
  SELECT (pkg->>'id')::int, COALESCE((pkg->>'durationDays')::int,30)
    INTO v_pkg, v_days
    FROM public.platform_settings ps, LATERAL jsonb_array_elements(ps.value) pkg
   WHERE ps.key='location_packages' AND COALESCE((pkg->>'active')::boolean,false)
   ORDER BY (pkg->>'id')::int LIMIT 1;
  IF v_sid IS NULL OR v_pkg IS NULL THEN RAISE EXCEPTION 'لا تاجرَ أو باقةً للاختبار'; END IF;
  UPDATE public.platform_settings
     SET value = value || jsonb_build_object(v_prod, jsonb_build_object('package_id', v_pkg))
   WHERE key = 'iap_products';

  -- ── ٢) بيئةُ الاختبار مرفوضةٌ افتراضاً ─────────────────────────────────
  v_r := public.taki_iap_apply(v_sid,'apple',v_prod,v_key,'TX1',v_store_date,'Sandbox',true,'T','{}'::jsonb);
  IF v_r->>'error' IS DISTINCT FROM 'sandbox_not_allowed' THEN
    RAISE EXCEPTION 'شراءُ سَندبوكس لم يُرفض: %', v_r;
  END IF;
  IF EXISTS (SELECT 1 FROM public.subscription_payments WHERE gateway_reference='TX1') THEN
    RAISE EXCEPTION 'سَندبوكس كتب صفَّ دفعةٍ «مدفوعة»';
  END IF;
  RAISE NOTICE '  ✅ ٢) سَندبوكس ⇒ مرفوضٌ ولا دفعةَ مكتوبة';
  -- وبالمفتاح: يُقبل عمداً
  UPDATE public.platform_settings SET value='true'::jsonb WHERE key='iap_allow_sandbox';
  v_r := public.taki_iap_apply(v_sid,'apple',v_prod,v_key,'TX1',v_store_date,'Sandbox',true,'T','{}'::jsonb);
  IF NOT COALESCE((v_r->>'success')::boolean,false) THEN
    RAISE EXCEPTION 'سَندبوكس لم يُقبل مع المفتاح: %', v_r;
  END IF;
  RAISE NOTICE '  ✅ ٢ب) ومع مفتاح iap_allow_sandbox ⇒ مقبولٌ عمداً';

  -- ── ١) تاريخُ المتجر هو الحاكم، لا مدّةُ الكتالوج ──────────────────────
  SELECT subscription_expires_at INTO v_exp FROM public.store_profiles WHERE store_id=v_sid;
  IF abs(extract(epoch FROM (v_exp - v_store_date))) > 5 THEN
    RAISE EXCEPTION 'تاريخُ المتجر لم يُحترم: كُتب % والمتوقَّع % (مدّةُ الكتالوج % يوماً)',
      v_exp, v_store_date, v_days;
  END IF;
  RAISE NOTICE '  ✅ ١) تاريخُ المتجر (+٥٨ يوماً) كُتب بدل مدّةِ الكتالوج (% يوماً)', v_days;

  -- ١ب) والاستعادةُ المتكرّرة لا تُمدّد (العيبُ «أ»: منحٌ مجّانيّ بكل ضغطة)
  PERFORM public.taki_iap_apply(v_sid,'apple',v_prod,v_key,'TX1',v_store_date,'Sandbox',true,'RESTORE','{}'::jsonb);
  PERFORM public.taki_iap_apply(v_sid,'apple',v_prod,v_key,'TX1',v_store_date,'Sandbox',true,'RESTORE','{}'::jsonb);
  SELECT subscription_expires_at INTO v_exp FROM public.store_profiles WHERE store_id=v_sid;
  IF abs(extract(epoch FROM (v_exp - v_store_date))) > 5 THEN
    RAISE EXCEPTION 'الاستعادةُ المتكرّرة مدّدت الصلاحيّة: %', v_exp;
  END IF;
  RAISE NOTICE '  ✅ ١ب) ثلاثُ استعاداتٍ ⇒ نفسُ التاريخ (لا منحَ مجّانيّاً)';

  -- ١ج) وإشعارٌ متأخّرٌ بتاريخٍ أقدم لا يُقصّر صلاحيّةً قائمة
  PERFORM public.taki_iap_apply(v_sid,'apple',v_prod,v_key,'TX1',
            now() + interval '2 days','Sandbox',true,'LATE','{}'::jsonb);
  SELECT subscription_expires_at INTO v_exp FROM public.store_profiles WHERE store_id=v_sid;
  IF abs(extract(epoch FROM (v_exp - v_store_date))) > 5 THEN
    RAISE EXCEPTION 'إشعارٌ متأخّرٌ قصّر الصلاحيّة إلى %', v_exp;
  END IF;
  RAISE NOTICE '  ✅ ١ج) إشعارٌ خارجُ الترتيب لا يُقصّر الصلاحيّة';

  -- ── ٥) تسلسلُ الفواتير لا يُحرَق بإعادة الإشعار ────────────────────────
  SELECT last_value INTO v_seq FROM public.taki_invoice_seq;
  PERFORM public.taki_iap_apply(v_sid,'apple',v_prod,v_key,'TX1',v_store_date,'Sandbox',true,'RETRY','{}'::jsonb);
  PERFORM public.taki_iap_apply(v_sid,'apple',v_prod,v_key,'TX1',v_store_date,'Sandbox',true,'RETRY','{}'::jsonb);
  SELECT last_value INTO v_seq2 FROM public.taki_invoice_seq;
  IF v_seq2 <> v_seq THEN
    RAISE EXCEPTION 'إعادةُ الإشعار حرقت % رقمَ فاتورة', v_seq2 - v_seq;
  END IF;
  SELECT count(*) INTO v_n FROM public.subscription_payments WHERE gateway_reference='TX1';
  IF v_n <> 1 THEN RAISE EXCEPTION 'صفوفُ الدفعة % والمتوقَّع ١', v_n; END IF;
  RAISE NOTICE '  ✅ ٥) إعادتان ⇒ صفرُ رقمِ فاتورةٍ محروق وصفٌّ واحد';

  -- ── ٣) إلغاءُ التجديد يُحترم ولا يُمحى ─────────────────────────────────
  PERFORM public.taki_iap_apply(v_sid,'apple',v_prod,v_key,'TX1',v_store_date,'Sandbox',false,'CANCEL','{}'::jsonb);
  SELECT auto_renew, subscription_canceled_at INTO v_ar, v_canc
    FROM public.store_profiles WHERE store_id=v_sid;
  IF v_ar IS NOT FALSE OR v_canc IS NULL THEN
    RAISE EXCEPTION 'إلغاءُ التجديد لم يُحترم: auto_renew=% canceled_at=%', v_ar, v_canc;
  END IF;
  -- وإعادةُ نفس الإشعار لا تُحرّك تاريخَ الإلغاء
  PERFORM public.taki_iap_apply(v_sid,'apple',v_prod,v_key,'TX1',v_store_date,'Sandbox',false,'CANCEL','{}'::jsonb);
  IF (SELECT subscription_canceled_at FROM public.store_profiles WHERE store_id=v_sid)
     IS DISTINCT FROM v_canc THEN
    RAISE EXCEPTION 'تاريخُ الإلغاء تحرّك بإعادة الإشعار';
  END IF;
  RAISE NOTICE '  ✅ ٣) إلغاءُ التجديد محفوظٌ وثابتٌ عبر الإعادة';

  -- ── ٤) حسابٌ آخرُ يُرفض بصراحةٍ لا يُجاب بنجاح ─────────────────────────
  IF v_other IS NOT NULL THEN
    v_r := public.taki_iap_apply(v_other,'apple',v_prod,v_key,'TX1',v_store_date,'Sandbox',true,'STEAL','{}'::jsonb);
    IF COALESCE((v_r->>'success')::boolean,false) THEN
      RAISE EXCEPTION 'حسابٌ آخرُ تلقّى «نجاحاً» على شراءِ غيره: %', v_r;
    END IF;
    IF v_r->>'error' IS DISTINCT FROM 'owned_by_another_account' THEN
      RAISE EXCEPTION 'الرمزُ غيرُ صريح: %', v_r;
    END IF;
    IF (SELECT store_id FROM public.store_iap_subscriptions WHERE purchase_key=v_key)
       IS DISTINCT FROM v_sid THEN
      RAISE EXCEPTION 'المالكُ تغيّر';
    END IF;
    RAISE NOTICE '  ✅ ٤) حسابٌ آخر ⇒ owned_by_another_account (لا «نجاحٌ» كاذب)';
  END IF;

  -- ── ٦) ربطُ شراءٍ معلَّقٍ يُسجّل المالكَ ولا يُفعّل ────────────────────
  DECLARE v_key2 text := 'TEST69P-' || gen_random_uuid()::text; v_before timestamptz;
  BEGIN
    SELECT subscription_expires_at INTO v_before FROM public.store_profiles WHERE store_id=v_sid;
    v_r := public.taki_iap_claim(v_sid,'google',v_prod,v_key2,'TXP','Production','{}'::jsonb);
    IF NOT COALESCE((v_r->>'success')::boolean,false) THEN
      RAISE EXCEPTION 'الربطُ فشل: %', v_r;
    END IF;
    IF (SELECT store_id FROM public.store_iap_subscriptions
         WHERE platform='google' AND purchase_key=v_key2) IS DISTINCT FROM v_sid THEN
      RAISE EXCEPTION 'الربطُ لم يُسجّل المالك';
    END IF;
    IF (SELECT subscription_expires_at FROM public.store_profiles WHERE store_id=v_sid)
       IS DISTINCT FROM v_before THEN
      RAISE EXCEPTION 'الربطُ فعّل اشتراكاً — وهو يجب ألّا يفعل';
    END IF;
    -- والإشعارُ اللاحق (بلا هويّة) يجد المالكَ الآن
    v_r := public.taki_iap_apply(NULL,'google',v_prod,v_key2,'TXP',
             now() + interval '30 days','Production',true,'NOTIFY','{}'::jsonb);
    IF NOT COALESCE((v_r->>'success')::boolean,false) THEN
      RAISE EXCEPTION 'الإشعارُ بلا هويّةٍ لم يجد المالكَ بعد الربط: %', v_r;
    END IF;
    RAISE NOTICE '  ✅ ٦) ربطُ المعلَّق يُسجّل المالكَ ولا يُفعّل · والإشعارُ بعده يجده';
  END;

  -- ── ٨) ومسارُ البوّابة (بلا تاريخ متجر) يبقى على مدّة الكتالوج ─────────
  DECLARE v_g jsonb;
  BEGIN
    v_g := public._taki_apply_package(v_sid, v_pkg, NULL, true);
    IF NOT COALESCE((v_g->>'success')::boolean,false) THEN
      RAISE EXCEPTION 'مسارُ البوّابة فشل: %', v_g;
    END IF;
    IF (v_g->>'from_store_date')::boolean IS NOT FALSE THEN
      RAISE EXCEPTION 'مسارُ البوّابة ادّعى تاريخَ متجر';
    END IF;
    RAISE NOTICE '  ✅ ٨) مسارُ البوّابة بلا تاريخِ متجرٍ ⇒ مدّةُ الكتالوج';
  END;

  RAISE NOTICE '✅ ثمانيةُ فحوصٍ مرّت على خمسة إصلاحات.';
END $$;
ROLLBACK;

-- ── جدولُ القراءة ────────────────────────────────────────────────────────
SELECT 'الخادم' AS "البند", current_setting('server_version') AS "القيمة",
       CASE WHEN COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'')
                 = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN '❌ المختبر' ELSE '✅ جدة' END AS "الحالة"
UNION ALL SELECT 'الموضعُ الواحد يستلم التاريخ', '_taki_apply_package/4',
       CASE WHEN to_regprocedure('public._taki_apply_package(text,integer,timestamptz,boolean)') IS NOT NULL
            THEN '✅' ELSE '❌' END
UNION ALL SELECT 'ولا نسخةَ قديمةً بمعاملين', '_taki_apply_package/2',
       CASE WHEN to_regprocedure('public._taki_apply_package(text,integer)') IS NULL
            THEN '✅ حُذفت' ELSE '❌ باقيةٌ فالنداءُ ملتبس' END
UNION ALL SELECT 'ربطُ المعلَّق', 'taki_iap_claim',
       CASE WHEN to_regprocedure('public.taki_iap_claim(text,text,text,text,text,text,jsonb)') IS NOT NULL
            THEN '✅' ELSE '❌' END
UNION ALL SELECT 'سَندبوكس', 'iap_allow_sandbox',
       (SELECT value::text FROM public.platform_settings WHERE key='iap_allow_sandbox')
       || CASE WHEN (SELECT value::text FROM public.platform_settings WHERE key='iap_allow_sandbox') = 'false'
               THEN ' ✅ مطفأ' ELSE ' ⚠️ مفعَّل' END
UNION ALL SELECT 'ممنوحةٌ للمتصفّح',
       (SELECT count(*)::text FROM information_schema.role_routine_grants
         WHERE routine_name IN ('taki_iap_apply','taki_iap_sync','taki_iap_claim','_taki_apply_package')
           AND grantee IN ('authenticated','anon','PUBLIC')),
       CASE WHEN NOT EXISTS (SELECT 1 FROM information_schema.role_routine_grants
                              WHERE routine_name IN ('taki_iap_apply','taki_iap_sync','taki_iap_claim','_taki_apply_package')
                                AND grantee IN ('authenticated','anon','PUBLIC'))
            THEN '✅ صفر' ELSE '❌' END;
