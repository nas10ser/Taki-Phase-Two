-- ═══════════════════════════════════════════════════════════════════════════
-- v15.67 — اشتراكُ التاجر **داخل التطبيق** (أبل StoreKit · قوقل Play Billing)
-- ═══════════════════════════════════════════════════════════════════════════
-- أمرُ ناصر (٧ نوفمبر ٢٠٢٦): «اشتراكُ التاجر داخل التطبيق اريدها داخل
-- التطبيق الاشتراك ايضا» — بعد أن عُرض عليه المخرجُ بلا عمولة ورفضه.
-- فالعمولةُ ١٥–٣٠٪ على الاشتراك قرارُه، وهذه الهجرةُ تُنفّذه.
--
-- 🔴 وقاعدةُ التصميم الحاكمة: **لا تفعيلَ باشتراكٍ يقوله العميل.** إيصالُ
--    أبل أو رمزُ قوقل يُتحقَّق منه **على خادمهما** في دالّة حافة، ثمّ يُكتب
--    صفُّ دفعةٍ بمرجعٍ حقيقيّ، ثمّ يُفعَّل. والعميلُ لا يملك أيَّ مسارِ
--    تفعيل — وهذا امتدادٌ مباشر لإصلاح v13.43 (كان التاجرُ يكتب خطّته من
--    المتصفّح) و v15.31 (كان يُفعّل بلا دفعةٍ مؤكَّدة).
--
-- 🪤 ومنعُ الازدواج شرطٌ لا تحسين: أبل وقوقل **يُعيدان إرسال الإشعار** حتى
--    يُجاب بـ٢٠٠، وأبل تُعيد المحاولة على مدى أيّام. فلو كان التفعيل غيرَ
--    خاملِ التكرار صار الاشتراكُ يمتدّ شهراً بكلّ إعادة. المفتاحُ الفريد هو
--    `original_transaction_id` عند أبل و`purchase_token` عند قوقل.
--
-- 🪤 و**لا يُطابَق الاشتراكُ بالسعر**: أبل وقوقل يقبضان بعملة المستخدم وبدرجات
--    أسعارهما، فلا يصل إلينا ريالٌ بعينه أبداً. الإيصالُ يُثبت شراءَ
--    **معرّف منتَج**، والمعرّفُ يُترجَم إلى باقةٍ من جدول الربط. والمبلغُ
--    المسجَّل هو سعرُ الباقة من الكتالوج (للفاتورة والتقارير) لا ما قبضته أبل.
--
-- 🪤 والوصلةُ إلى `users` هي `ON DELETE SET NULL` لا CASCADE: حذفُ حسابٍ لا
--    يجوز أن يمحو سجلّاً ماليّاً، وأبل تظلّ تُرسل إشعاراتِ تجديدٍ لاشتراكٍ
--    قائمٍ بعد الحذف — فصفٌّ بلا مالكٍ أصدقُ من لا صفّ. (نفسُ درس
--    `contest_entries` في v14.77.)
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'')
     = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه قاعدةُ المختبر (طوكيو) — الهجرةُ لجدة وحدها.';
  END IF;
  IF to_regclass('public.subscription_payments') IS NULL
     OR to_regclass('public.store_profiles') IS NULL THEN
    RAISE EXCEPTION 'جداولُ الاشتراك غير موجودة — ليست قاعدةَ تاكي.';
  END IF;
END $$;

-- ── ١) سجلُّ اشتراكات المتجرين ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.store_iap_subscriptions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id            text REFERENCES public.users(id) ON DELETE SET NULL,
  platform            text NOT NULL CHECK (platform IN ('apple', 'google')),
  product_id          text NOT NULL,
  package_id          integer NOT NULL,
  -- المفتاحُ الثابت: لا يتغيّر مع التجديد. أبل تُسمّيه الأصليّ، وقوقل الرمز.
  purchase_key        text NOT NULL,
  latest_txn_id       text,
  environment         text NOT NULL DEFAULT 'Production'
                        CHECK (environment IN ('Production', 'Sandbox')),
  status              text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','grace','on_hold','paused',
                                          'expired','revoked','canceled')),
  expires_at          timestamptz,
  auto_renew          boolean NOT NULL DEFAULT true,
  last_event          text,
  last_event_at       timestamptz,
  raw                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- خاملُ التكرار: إعادةُ إرسال نفس الإشعار تُحدِّث صفّاً ولا تُنشئ ثانياً.
CREATE UNIQUE INDEX IF NOT EXISTS store_iap_subs_key_uq
  ON public.store_iap_subscriptions (platform, purchase_key);
CREATE INDEX IF NOT EXISTS store_iap_subs_store_idx
  ON public.store_iap_subscriptions (store_id) WHERE store_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS store_iap_subs_expiry_idx
  ON public.store_iap_subscriptions (expires_at) WHERE status IN ('active','grace');

COMMENT ON TABLE public.store_iap_subscriptions IS
  'اشتراكاتُ التجّار المشتراةُ داخل التطبيق. تُكتب من دوالّ الحافة بعد تحقّقٍ '
  'على خادم أبل/قوقل، ولا يكتبها عميلٌ أبداً. purchase_key هو المفتاحُ الثابت '
  '(original_transaction_id عند أبل · purchase_token عند قوقل).';

ALTER TABLE public.store_iap_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.store_iap_subscriptions FROM PUBLIC;
REVOKE ALL ON public.store_iap_subscriptions FROM anon, authenticated;

-- 🪤 والتاجرُ يرى **صفَّه** ليعرف حالةَ اشتراكه (ومتجرُ أبل يُلزم بعرض
--    الحالة وبزرّ استعادة) — قراءةٌ فقط، ولا كتابةَ لأحدٍ غير الخادم.
DROP POLICY IF EXISTS store_iap_subs_select_own ON public.store_iap_subscriptions;
CREATE POLICY store_iap_subs_select_own ON public.store_iap_subscriptions
  FOR SELECT TO authenticated
  USING (store_id = auth.uid()::text OR public.taki_admin_perm('tab_subscriptions'));
GRANT SELECT ON public.store_iap_subscriptions TO authenticated;

-- ── ٢) ربطُ معرّفات متجرَي أبل وقوقل بالباقات ────────────────────────────
-- 🪤 المفتاحُ الجديد يُدرَج في **ثلاثة مواضع** لا اثنين (قاعدةُ v14.92):
--    فرعُ التطبيق · قائمةُ الجلب · **وقائمةُ السماح في RLS** — ونسيانُ
--    الثالث يُعيد `SELECT` بصفر صفوفٍ **لا بخطأ**، فترتدّ الواجهةُ إلى
--    الافتراضي وتبدو سليمةً تماماً.
INSERT INTO public.platform_settings (key, value)
VALUES ('iap_products', '{}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- وتُعاد بناءُ السياسة **من نصّها الحيّ** بإضافة عنصرٍ واحد، لا من نسخةٍ
-- مكتوبةٍ هنا — وإلّا حُذفت مفاتيحُ لا نعلم بها. والأدوارُ تُنسخ حرفياً.
DO $$
DECLARE
  q       text;
  roles   text;
  new_q   text;
BEGIN
  SELECT pg_get_expr(pol.polqual, pol.polrelid),
         COALESCE(NULLIF(array_to_string(ARRAY(
           SELECT r.rolname FROM pg_roles r WHERE r.oid = ANY(pol.polroles)), ','), ''), 'public')
    INTO q, roles
    FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid
   WHERE c.relname = 'platform_settings' AND pol.polname = 'platform_settings_select';

  IF q IS NULL THEN RAISE EXCEPTION 'سياسةُ قراءة الإعدادات غير موجودة'; END IF;

  IF q LIKE '%''iap_products''%' THEN
    RAISE NOTICE 'ℹ️ iap_products مدرجٌ أصلاً في قائمة السماح.';
  ELSE
    new_q := regexp_replace(q, '(ARRAY\[)', '\1''iap_products''::text, ');
    IF new_q = q THEN RAISE EXCEPTION 'لم يُعثر على ARRAY[ في نصّ السياسة'; END IF;
    EXECUTE format('DROP POLICY platform_settings_select ON public.platform_settings');
    EXECUTE format('CREATE POLICY platform_settings_select ON public.platform_settings '
                 || 'FOR SELECT TO %s USING (%s)', roles, new_q);
    RAISE NOTICE '✅ أُدرج iap_products (الأدوار: %)', roles;
  END IF;
END $$;

-- ── ٣) التفعيلُ في موضعٍ واحد يستعمله المسارانِ ──────────────────────────
-- 🔴 كان منطقُ التفعيل (قراءةُ الكتالوج + كتابةُ store_profiles) داخل
--    `subscribe_self_to_package` وحدها. ونسخُه لمسار المتجرين كان سيُنشئ
--    نسختين تنحرفان: أوّلُ تعديلٍ في مدّةٍ أو سقفِ فروعٍ يسري على مسارٍ
--    واحد ولا يشكو أحد. فيُستخرَج إلى دالّةٍ خاصّة، ويُنادى من الاثنين.
CREATE OR REPLACE FUNCTION public._taki_apply_package(p_store_id text, p_package_id integer)
RETURNS jsonb
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
  -- الكتالوجُ هو المرجع، لا المنادي — في المسارين.
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
  v_end   := v_now + make_interval(days => v_days);

  INSERT INTO public.store_profiles (
    store_id, subscription_plan, subscription_started_at, subscription_expires_at,
    subscription_amount, max_branches, subscription_package_id,
    auto_renew, subscription_canceled_at, updated_at)
  VALUES (p_store_id, 'premium', v_now, v_end, v_net, v_max, p_package_id,
          true, NULL, v_now)
  ON CONFLICT (store_id) DO UPDATE SET
    subscription_plan        = EXCLUDED.subscription_plan,
    subscription_started_at  = EXCLUDED.subscription_started_at,
    subscription_expires_at  = EXCLUDED.subscription_expires_at,
    subscription_amount      = EXCLUDED.subscription_amount,
    max_branches             = EXCLUDED.max_branches,
    subscription_package_id  = EXCLUDED.subscription_package_id,
    auto_renew               = true,
    subscription_canceled_at = NULL,
    updated_at               = EXCLUDED.updated_at;

  RETURN jsonb_build_object('success', true, 'plan', 'premium', 'amount', v_net,
    'days', v_days, 'max_branches', v_max, 'expires_at', v_end,
    'package_ar', v_pkg->>'ar', 'net', v_net);
END $$;
REVOKE ALL ON FUNCTION public._taki_apply_package(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._taki_apply_package(text, integer) FROM anon, authenticated;

-- ومسارُ الويب يُعاد بناؤه ليستعمل الموضعَ الواحد، بنفس حرّاسه حرفاً بحرف.
CREATE OR REPLACE FUNCTION public.subscribe_self_to_package(p_package_id integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid  text := auth.uid()::text;
  v_role text;
  v_res  jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;
  SELECT user_type INTO v_role FROM public.users WHERE id = v_uid;
  IF v_role NOT IN ('seller', 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_a_merchant');
  END IF;

  -- السعرُ يُحسب أوّلاً لأن حارسَ الدفع يحتاجه — ثمّ يُفعَّل.
  v_res := public._taki_apply_package_dry(p_package_id);
  IF NOT COALESCE((v_res->>'success')::boolean, false) THEN RETURN v_res; END IF;

  -- 🔴 v15.31: لا اشتراكَ مدفوعٌ بلا دفعةٍ مؤكَّدةٍ بمرجعٍ من بوّابة.
  IF NOT public._taki_sub_payment_ok(v_uid, p_package_id, (v_res->>'net')::numeric) THEN
    RETURN jsonb_build_object('success', false, 'error', 'payment_not_confirmed');
  END IF;

  RETURN public._taki_apply_package(v_uid, p_package_id);
END $$;

-- حسبةُ السعر بلا كتابة — يحتاجها حارسُ الدفع قبل التفعيل.
CREATE OR REPLACE FUNCTION public._taki_apply_package_dry(p_package_id integer)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT CASE
    WHEN pkg IS NULL THEN jsonb_build_object('success', false, 'error', 'unknown_package')
    WHEN COALESCE((pkg->>'active')::boolean, false) IS NOT TRUE
      THEN jsonb_build_object('success', false, 'error', 'package_inactive')
    ELSE jsonb_build_object('success', true,
      'net', round(COALESCE((pkg->>'price')::numeric, 0)
                   * (1 - (COALESCE((pkg->>'discount')::numeric, 0) / 100.0)), 2),
      'days', COALESCE((pkg->>'durationDays')::int, 30),
      'max_branches', COALESCE((pkg->>'max')::int, 1))
  END
  FROM (SELECT (SELECT pkg FROM public.platform_settings ps,
                       LATERAL jsonb_array_elements(ps.value) AS pkg
                 WHERE ps.key = 'location_packages'
                   AND (pkg->>'id')::int = p_package_id LIMIT 1) AS pkg) q;
$$;
REVOKE ALL ON FUNCTION public._taki_apply_package_dry(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._taki_apply_package_dry(integer) TO authenticated, service_role;

-- ── ٤) تطبيقُ شراءٍ متحقَّقٍ منه — للخادم وحده ───────────────────────────
-- تُنادى من دالّة الحافة **بعد** أن تؤكّد أبل أو قوقل الشراءَ على خادمها.
-- خاملةُ التكرار: إعادةُ الإشعار تُحدِّث ولا تُضاعف.
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
  v_prev    public.store_iap_subscriptions;
  v_res     jsonb;
  v_net     numeric;
  v_pay_id  text;
  v_plan_id text;
BEGIN
  -- 🔴 لا يُنادى هذا من متصفّح أبداً: التفعيلُ بلا تحقّقٍ خادميّ = اشتراكٌ
  --    مجّانيّ لكلّ من يستطيع فتح لوحة المطوّر.
  IF NOT public.taki_is_system_caller() THEN
    RAISE EXCEPTION 'IAP_SERVER_ONLY' USING HINT = 'IAP_SERVER_ONLY';
  END IF;
  IF p_platform NOT IN ('apple', 'google') THEN
    RAISE EXCEPTION 'IAP_BAD_PLATFORM' USING HINT = 'IAP_BAD_PLATFORM';
  END IF;
  IF COALESCE(p_purchase_key, '') = '' THEN
    RAISE EXCEPTION 'IAP_NO_KEY' USING HINT = 'IAP_NO_KEY';
  END IF;

  -- معرّفُ المنتَج يُترجَم إلى باقةٍ من جدول الربط — **لا من العميل**.
  SELECT (kv.value->>'package_id')::int INTO v_pkg_id
    FROM public.platform_settings ps,
         LATERAL jsonb_each(ps.value) AS kv
   WHERE ps.key = 'iap_products' AND kv.key = p_product_id
   LIMIT 1;
  IF v_pkg_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unmapped_product',
      'product_id', p_product_id,
      'hint', 'يُضاف المعرّف في platform_settings.iap_products');
  END IF;

  SELECT * INTO v_prev FROM public.store_iap_subscriptions
   WHERE platform = p_platform AND purchase_key = p_purchase_key;

  INSERT INTO public.store_iap_subscriptions (
    store_id, platform, product_id, package_id, purchase_key, latest_txn_id,
    environment, status, expires_at, auto_renew, last_event, last_event_at, raw)
  VALUES (p_store_id, p_platform, p_product_id, v_pkg_id, p_purchase_key, p_latest_txn,
          COALESCE(p_environment, 'Production'), 'active', p_expires_at,
          COALESCE(p_auto_renew, true), p_event, now(), COALESCE(p_raw, '{}'::jsonb))
  ON CONFLICT (platform, purchase_key) DO UPDATE SET
    -- 🪤 ولا يُنقل الاشتراكُ إلى حسابٍ آخر بإشعار: `store_id` يبقى لمالكه
    --    الأوّل إلّا إن كان فارغاً. وإلّا لاستطاع تاجرٌ أن يُسند اشتراكَ
    --    غيره إلى نفسه بإعادة «استعادة الشراء» من جهازه.
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

  -- والمالكُ المسجَّل هو من يُفعَّل له، لا من أرسل الطلب.
  SELECT store_id INTO p_store_id FROM public.store_iap_subscriptions
   WHERE platform = p_platform AND purchase_key = p_purchase_key;
  IF p_store_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_owner',
      'hint', 'الشراءُ مسجَّلٌ بلا مالك — يربطه التاجر من التطبيق');
  END IF;

  v_res := public._taki_apply_package_dry(v_pkg_id);
  IF NOT COALESCE((v_res->>'success')::boolean, false) THEN RETURN v_res; END IF;
  v_net := (v_res->>'net')::numeric;

  -- 🪤 وصفُّ الدفعة **خاملُ التكرار بمرجعه**: المرجعُ هو معرّفُ المعاملة،
  --    فإعادةُ نفس الإشعار لا تُنشئ فاتورةً ثانيةً ولا تحرق رقمَ فاتورة.
  v_pay_id := p_platform || ':' || COALESCE(p_latest_txn, p_purchase_key);
  -- 🔴 `plan_id` **مفتاحٌ أجنبيٌّ إلى `subscription_plans`** لا معرّفُ باقة.
  --    كتبتُ فيه معرّفَ الباقة فانفجر القيد `…plan_id_fkey` في أوّل اختبار:
  --    «Key (plan_id)=(1) is not present». وجدولُ الخطط فيه صفٌّ واحدٌ رمزُه
  --    `basic`، والوسمُ `premium` الذي نكتبه في `store_profiles` عمودُ نصٍّ
  --    في جدولٍ آخر — لا علاقةَ له بهذا المفتاح. فيُبحَث عن الخطّة، و`NULL`
  --    إن لم تُطابق (العمودُ يقبلها، ودالّةُ الويب تفعل الشيءَ نفسَه)،
  --    ومعرّفُ الباقةِ يُحفظ في `metadata` و`branches_count` حيث يخصّه.
  SELECT id INTO v_plan_id FROM public.subscription_plans
   WHERE code = 'premium' OR id = 'premium' LIMIT 1;

  INSERT INTO public.subscription_payments (
    id, merchant_id, plan_id, amount, currency, status, payment_method,
    gateway_provider, gateway_reference, branches_count, period_start, period_end,
    metadata, paid_at, created_at)
  VALUES (
    v_pay_id, p_store_id, v_plan_id, v_net, 'SAR', 'paid',
    CASE p_platform WHEN 'apple' THEN 'apple_iap' ELSE 'google_play' END,
    CASE p_platform WHEN 'apple' THEN 'App Store' ELSE 'Google Play' END,
    COALESCE(p_latest_txn, p_purchase_key),
    (v_res->>'max_branches')::int,
    now(), p_expires_at,
    jsonb_build_object('platform', p_platform, 'product_id', p_product_id,
                       'environment', COALESCE(p_environment, 'Production'),
                       'event', p_event, 'package_id', v_pkg_id,
                       'source', CASE p_platform WHEN 'apple' THEN 'app_store' ELSE 'play_store' END),
    now(), now())
  ON CONFLICT (id) DO NOTHING;

  RETURN public._taki_apply_package(p_store_id, v_pkg_id)
         || jsonb_build_object('payment_id', v_pay_id, 'package_id', v_pkg_id);
END $$;
REVOKE ALL ON FUNCTION public.taki_iap_apply(text,text,text,text,text,timestamptz,text,boolean,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_iap_apply(text,text,text,text,text,timestamptz,text,boolean,text,jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.taki_iap_apply(text,text,text,text,text,timestamptz,text,boolean,text,jsonb) TO service_role;

-- ── ٥) إشعاراتُ انتهاءٍ وإلغاءٍ واستردادٍ — للخادم وحده ──────────────────
CREATE OR REPLACE FUNCTION public.taki_iap_sync(
  p_platform text, p_purchase_key text, p_status text,
  p_expires_at timestamptz, p_auto_renew boolean, p_event text, p_raw jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_row public.store_iap_subscriptions;
BEGIN
  IF NOT public.taki_is_system_caller() THEN
    RAISE EXCEPTION 'IAP_SERVER_ONLY' USING HINT = 'IAP_SERVER_ONLY';
  END IF;

  UPDATE public.store_iap_subscriptions SET
    status        = p_status,
    expires_at    = COALESCE(p_expires_at, expires_at),
    auto_renew    = COALESCE(p_auto_renew, auto_renew),
    last_event    = p_event,
    last_event_at = now(),
    raw           = COALESCE(p_raw, raw),
    updated_at    = now()
   WHERE platform = p_platform AND purchase_key = p_purchase_key
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    -- 🪤 إشعارٌ عن شراءٍ لا نعرفه **ليس خطأً يُعاد**: أبل تُرسل إشعاراتَ
    --    بيئة الاختبار وإشعاراتِ مشترياتٍ سبقت الربط. يُجاب بنجاحٍ وإلّا
    --    أعادت المحاولةَ أيّاماً. (ونفسُ منطق ٤٢٩ مع زد في v15.22.)
    RETURN jsonb_build_object('success', true, 'unknown_purchase', true);
  END IF;

  -- وانقطاعُ الاشتراك يُقصّر صلاحيّتَه فوراً، ولا يُحذف سجلٌّ.
  IF p_status IN ('expired', 'revoked') AND v_row.store_id IS NOT NULL THEN
    UPDATE public.store_profiles
       SET subscription_expires_at = LEAST(subscription_expires_at, now()),
           auto_renew = false, updated_at = now()
     WHERE store_id = v_row.store_id;
  ELSIF p_status = 'canceled' AND v_row.store_id IS NOT NULL THEN
    -- إلغاءُ التجديد التلقائيّ لا يُنهي المدّةَ المدفوعة — تكتمل.
    UPDATE public.store_profiles
       SET auto_renew = false, subscription_canceled_at = now(), updated_at = now()
     WHERE store_id = v_row.store_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'status', p_status,
                            'store_id', v_row.store_id);
END $$;
REVOKE ALL ON FUNCTION public.taki_iap_sync(text,text,text,timestamptz,boolean,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_iap_sync(text,text,text,timestamptz,boolean,text,jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.taki_iap_sync(text,text,text,timestamptz,boolean,text,jsonb) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- التحقّق — سلوكيٌّ ويرفع استثناءً، **وداخل معاملةٍ تُلفى**
-- ───────────────────────────────────────────────────────────────────────────
-- 🪤 الاختبارُ يُفعّل اشتراكاً على تاجرٍ حقيقيّ ليُقاس الأثر، فيلزم `ROLLBACK`
--    وإلّا مُنح متجرٌ باقةً مجّاناً باختباري. وما سبق من DDL مُثبَّتٌ أصلاً
--    (كلُّ عبارةٍ تُثبَّت وحدها)، فاللفُّ لا يمسّه.
-- 🪤 ولا يُحاول إثباتُ «المنادي ليس نظاماً» من psql: الجلسةُ نفسُها نظام
--    (درس v14.96 — مرّ الاختبارُ كاذباً مرّتين). فالمنعُ يُثبَت بما يُثبَت:
--    نصُّ الدالّة فيه الحارس، و**الصلاحياتُ لا تشمل `authenticated`** — وهذا
--    هو الجدارُ الحقيقيّ الذي يُرفض عنده النداءُ من المتصفّح.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $$
DECLARE
  v_store   text;
  v_pkg     integer;
  v_key     text := 'TAKI-TEST-' || gen_random_uuid()::text;
  v_prod    text := 'net.takisa.app.test.monthly';
  v_r       jsonb;
  v_n       integer;
  v_exp     timestamptz;
  v_other   text;
BEGIN
  -- ── ٠) الحارسُ موجودٌ نصّاً، والصلاحياتُ لا تشمل المتصفّح ──────────────
  IF to_regprocedure('public.taki_is_system_caller()') IS NULL THEN
    RAISE EXCEPTION 'taki_is_system_caller غائبة — حارسُ الخادم لا أساس له';
  END IF;
  IF (SELECT regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g')
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname='public' AND p.proname='taki_iap_apply' AND p.prokind='f')
     NOT LIKE '%taki_is_system_caller()%' THEN
    RAISE EXCEPTION 'taki_iap_apply بلا حارس نظام';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.role_routine_grants
              WHERE routine_name IN ('taki_iap_apply','taki_iap_sync')
                AND grantee IN ('authenticated','anon','PUBLIC')) THEN
    RAISE EXCEPTION 'دوالُّ المتجرين ممنوحةٌ للمتصفّح — الجدارُ مفتوح';
  END IF;

  -- ── ١) معرّفٌ غيرُ مربوط يُرفض بوضوح ──────────────────────────────────
  SELECT id INTO v_store FROM public.users
   WHERE user_type IN ('seller','admin') AND deleted_at IS NULL ORDER BY id LIMIT 1;
  IF v_store IS NULL THEN RAISE EXCEPTION 'لا تاجرَ للاختبار'; END IF;
  SELECT (pkg->>'id')::int INTO v_pkg
    FROM public.platform_settings ps, LATERAL jsonb_array_elements(ps.value) pkg
   WHERE ps.key='location_packages' AND COALESCE((pkg->>'active')::boolean,false)
   ORDER BY (pkg->>'id')::int LIMIT 1;
  IF v_pkg IS NULL THEN RAISE EXCEPTION 'لا باقةً مفعّلةً للاختبار'; END IF;

  v_r := public.taki_iap_apply(v_store, 'apple', v_prod, v_key, 'T1',
                               now() + interval '30 days', 'Sandbox', true, 'TEST', '{}'::jsonb);
  IF v_r->>'error' IS DISTINCT FROM 'unmapped_product' THEN
    RAISE EXCEPTION 'معرّفٌ غيرُ مربوطٍ مرّ: %', v_r;
  END IF;

  -- ── ٢) بعد الربط: يُفعَّل ويُكتب صفُّ دفعةٍ وصفُّ اشتراك ──────────────
  UPDATE public.platform_settings
     SET value = value || jsonb_build_object(v_prod, jsonb_build_object('package_id', v_pkg))
   WHERE key = 'iap_products';

  v_r := public.taki_iap_apply(v_store, 'apple', v_prod, v_key, 'T1',
                               now() + interval '30 days', 'Sandbox', true, 'TEST', '{}'::jsonb);
  IF NOT COALESCE((v_r->>'success')::boolean, false) THEN
    RAISE EXCEPTION 'التفعيلُ فشل بعد الربط: %', v_r;
  END IF;
  SELECT subscription_expires_at INTO v_exp FROM public.store_profiles WHERE store_id = v_store;
  IF v_exp IS NULL OR v_exp <= now() THEN
    RAISE EXCEPTION 'لم تُكتب صلاحيّةُ الاشتراك في store_profiles (%)', v_exp;
  END IF;
  SELECT count(*) INTO v_n FROM public.subscription_payments
   WHERE gateway_reference = 'T1' AND merchant_id = v_store AND status = 'paid';
  IF v_n <> 1 THEN RAISE EXCEPTION 'صفوفُ الدفعة % والمتوقَّع ١', v_n; END IF;
  -- ومعرّفُ الباقة محفوظٌ في metadata لا في مفتاح الخطّة الأجنبيّ
  IF (SELECT (metadata->>'package_id')::int FROM public.subscription_payments
       WHERE gateway_reference = 'T1') IS DISTINCT FROM v_pkg THEN
    RAISE EXCEPTION 'معرّفُ الباقة لم يُحفظ في metadata';
  END IF;

  -- ── ٣) **خاملُ التكرار**: أبل تُعيد الإشعارَ أيّاماً حتى يُجاب ٢٠٠ ────
  PERFORM public.taki_iap_apply(v_store, 'apple', v_prod, v_key, 'T1',
                                now() + interval '30 days', 'Sandbox', true, 'RETRY', '{}'::jsonb);
  PERFORM public.taki_iap_apply(v_store, 'apple', v_prod, v_key, 'T1',
                                now() + interval '30 days', 'Sandbox', true, 'RETRY', '{}'::jsonb);
  SELECT count(*) INTO v_n FROM public.subscription_payments WHERE gateway_reference = 'T1';
  IF v_n <> 1 THEN RAISE EXCEPTION 'تكرارُ الإشعار ضاعف الفاتورة: % صفّاً', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.store_iap_subscriptions WHERE purchase_key = v_key;
  IF v_n <> 1 THEN RAISE EXCEPTION 'تكرارُ الإشعار ضاعف الاشتراك: % صفّاً', v_n; END IF;

  -- ── ٤) ولا يُنقل الاشتراكُ إلى حسابٍ آخرَ بإشعار ─────────────────────
  SELECT id INTO v_other FROM public.users
   WHERE id <> v_store AND deleted_at IS NULL ORDER BY id LIMIT 1;
  IF v_other IS NOT NULL THEN
    PERFORM public.taki_iap_apply(v_other, 'apple', v_prod, v_key, 'T1',
                                  now() + interval '30 days', 'Sandbox', true, 'STEAL', '{}'::jsonb);
    IF (SELECT store_id FROM public.store_iap_subscriptions WHERE purchase_key = v_key)
       IS DISTINCT FROM v_store THEN
      RAISE EXCEPTION 'اشتراكٌ انتُقل إلى حسابٍ آخر بإشعار — ثغرةُ انتحال';
    END IF;
  END IF;

  -- ── ٥) الانتهاءُ يُقصّر الصلاحيّةَ فوراً ──────────────────────────────
  v_r := public.taki_iap_sync('apple', v_key, 'expired', NULL, false, 'EXPIRED', '{}'::jsonb);
  IF NOT COALESCE((v_r->>'success')::boolean, false) THEN
    RAISE EXCEPTION 'المزامنةُ فشلت: %', v_r;
  END IF;
  SELECT subscription_expires_at INTO v_exp FROM public.store_profiles WHERE store_id = v_store;
  IF v_exp > now() THEN
    RAISE EXCEPTION 'الاشتراكُ بقي صالحاً بعد إشعار الانتهاء (%)', v_exp;
  END IF;

  -- ── ٦) إشعارٌ عن شراءٍ مجهولٍ يُجاب بنجاحٍ لا بخطأ ────────────────────
  v_r := public.taki_iap_sync('google', 'NO-SUCH-TOKEN', 'expired', NULL, false, 'X', '{}'::jsonb);
  IF NOT COALESCE((v_r->>'success')::boolean, false)
     OR NOT COALESCE((v_r->>'unknown_purchase')::boolean, false) THEN
    RAISE EXCEPTION 'شراءٌ مجهولٌ لم يُجَب بنجاح: % — ستُعيد أبل المحاولةَ أيّاماً', v_r;
  END IF;

  -- ── ٧) ومسارُ الويب بقي محروساً بعد إعادة البناء ─────────────────────
  IF (SELECT regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g')
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname='subscribe_self_to_package' AND p.prokind='f')
     NOT LIKE '%_taki_sub_payment_ok%' THEN
    RAISE EXCEPTION 'حارسُ الدفع سقط من مسار الويب بإعادة البناء';
  END IF;

  -- ── ٨) والمفتاحُ الجديد في قائمة سماح RLS (وإلّا قرأته الواجهةُ صفراً) ─
  IF (SELECT pg_get_expr(pol.polqual, pol.polrelid) FROM pg_policy pol
        JOIN pg_class c ON c.oid=pol.polrelid
       WHERE c.relname='platform_settings' AND pol.polname='platform_settings_select')
     NOT LIKE '%iap_products%' THEN
    RAISE EXCEPTION 'iap_products ليس في قائمة سماح RLS — ستقرؤه الواجهةُ صفر صفوفٍ بلا خطأ';
  END IF;

  RAISE NOTICE '✅ ثمانيةُ فحوصٍ مرّت: الربط · التفعيل · خمولُ التكرار · منعُ النقل · الانتهاء · المجهول · حارسُ الويب · RLS';
END $$;
ROLLBACK;

-- ── جدولُ القراءة (بعد اللفّ — يقرأ الحالةَ المُثبَّتة) ──────────────────
SELECT 'الخادم' AS "البند", current_setting('server_version') AS "القيمة",
       CASE WHEN COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'')
                 = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN '❌ المختبر' ELSE '✅ جدة' END AS "الحالة"
UNION ALL SELECT 'جدولُ اشتراكات المتجرين', 'store_iap_subscriptions',
       CASE WHEN to_regclass('public.store_iap_subscriptions') IS NOT NULL THEN '✅' ELSE '❌' END
UNION ALL SELECT 'دوالُّ المتجرين', 'taki_iap_apply · taki_iap_sync',
       CASE WHEN to_regprocedure('public.taki_iap_apply(text,text,text,text,text,timestamptz,text,boolean,text,jsonb)') IS NOT NULL
             AND to_regprocedure('public.taki_iap_sync(text,text,text,timestamptz,boolean,text,jsonb)') IS NOT NULL
            THEN '✅' ELSE '❌' END
UNION ALL SELECT 'ممنوحةٌ للخادم وحده', 'service_role',
       CASE WHEN NOT EXISTS (SELECT 1 FROM information_schema.role_routine_grants
                              WHERE routine_name IN ('taki_iap_apply','taki_iap_sync')
                                AND grantee IN ('authenticated','anon','PUBLIC'))
            THEN '✅' ELSE '❌' END
UNION ALL SELECT 'جدولُ ربط المعرّفات', 'iap_products',
       CASE WHEN EXISTS (SELECT 1 FROM public.platform_settings WHERE key='iap_products')
            THEN '✅ (فارغٌ حتى تُنشأ المنتجات في المتجرين)' ELSE '❌' END
UNION ALL SELECT 'نُظّفت آثارُ الاختبار', 'ROLLBACK',
       CASE WHEN NOT EXISTS (SELECT 1 FROM public.store_iap_subscriptions
                              WHERE purchase_key LIKE 'TAKI-TEST-%')
             AND NOT EXISTS (SELECT 1 FROM public.subscription_payments
                              WHERE gateway_reference = 'T1')
            THEN '✅' ELSE '❌ بقيت آثار' END;
