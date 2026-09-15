-- ════════════════════════════════════════════════════════════════════════════
-- TAKI v14.44 — بوّابة الدفع: الخزنة هي الحقيقة، لا المؤشِّر (طلب ناصر ١)
-- ════════════════════════════════════════════════════════════════════════════
-- العطل المقيس على جدة (١٥ سبتمبر ٢٠٢٦):
--   merchant_gateways.secret_key_id لمتجر «تاكي» = a7df4f42…  ← **غير موجود**
--   والمفتاح الحقيقي موجودٌ في الخزنة باسمه: mg_<merchant>_sk = c02df98a…
--   أي أن انتقال ٥ أغسطس أعاد إنشاء أسرار الخزنة بأرقام جديدة ولم يُحدِّث
--   المؤشِّرات. فالسرّ لم يضع — المؤشِّر وحده هو الذي ضلّ.
--
-- ولماذا لم يظهر الخلل؟ لأن كل طبقةٍ تسأل **المؤشِّر** لا الخزنة:
--   • `_gateway_write` يرى مؤشِّراً غير فارغ ⇒ ينادي `vault.update_secret`،
--     وهذه `UPDATE … WHERE id=` على صفٍّ غير موجود ⇒ **صفر صفوف، بلا خطأ**.
--     (أُثبت بالتنفيذ داخل معاملة ملغاة: لا استثناء، والسرّ ما زال غائباً.)
--     ⇒ لو أدخل ناصر مفاتيح ميسر اليوم لقالت الواجهة «✅ حُفظت» ولم يُحفظ شيء.
--   • `_gateway_masked.has_secret` = (secret_key_id IS NOT NULL) ⇒ «محفوظ ✓».
--   • `merchant_toggle_gateway` يفحص المؤشِّر ⇒ يسمح بالتفعيل بلا مفتاح.
--   • `deal_payment_mode` لا يفحص المفتاح إطلاقاً ⇒ **قِيس**: متجر «تاكي»
--     يعرض اليوم للمشترين `both` على عرضين نشطين، فزرّ «ادفع الآن» ظاهرٌ
--     وكل ضغطة عليه ترجع GATEWAY_UNAVAILABLE.
--
-- العلاج ثلاث طبقات:
--   ١) شفاء البيانات: يُعاد ربط المؤشِّر بالسرّ الحيّ باسمه القانوني.
--   ٢) قاعدة واحدة للحقيقة: `_gateway_secret_live()` تسأل الخزنة، وتستعملها
--      الطبقات الأربع كلها — فلا يبقى مكانٌ يصدّق المؤشِّر وحده.
--   ٣) الكتابة تُثبَت بقراءة: بعد كل كتابةٍ في الخزنة يُقرأ السرّ ويُقارَن،
--      وإلا `SECRET_WRITE_FAILED` — فلا تعود كتابةٌ فاشلة تمرّ صامتة أبداً.
--
-- ⚠️ لا يُدخل هذا الملف أي مفتاح بوّابة — مفاتيح التاجر بيد التاجر وحده.
-- الخادم المستهدف: **جدة (الإنتاج)**. يرفض التنفيذ على مختبر طوكيو.
-- ════════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'TOKYO_LAB_REFUSED: هذه هجرة إنتاج. نفّذها على جدة.';
  END IF;
END
$guard$;

-- ════════════════════════════════════════════════════════════════════════════
-- ١) قاعدة الحقيقة الواحدة — هل يَحُلّ مؤشِّر التاجر إلى سرٍّ فعليّ؟
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._gateway_secret_live(p_merchant_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.merchant_gateways g
    JOIN vault.secrets s ON s.id = g.secret_key_id
    WHERE g.merchant_id = p_merchant_id
  );
$$;
COMMENT ON FUNCTION public._gateway_secret_live(text) IS
  'v14.44 — المفتاح السرّي للتاجر موجود في الخزنة فعلاً؟ مؤشِّرٌ معلَّق = لا.';

-- داخليّة بحتة: تناديها الدوال المعرّفة (definer) بصلاحية مالكها.
REVOKE ALL ON FUNCTION public._gateway_secret_live(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._gateway_secret_live(text) FROM anon;
REVOKE ALL ON FUNCTION public._gateway_secret_live(text) FROM authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ٢) شفاء البيانات — إعادة ربط المؤشِّرات المعلَّقة بأسرارها الحيّة
-- ════════════════════════════════════════════════════════════════════════════
-- أ) مؤشِّر معلَّق (أو فارغ) وفي الخزنة سرٌّ باسم التاجر القانوني ⇒ تبنَّه،
--    وأعد اشتقاق آخر أربع خانات من القيمة الفعلية لا من قيمةٍ سابقة.
--
-- 🔴 ويُفكّ ختم «مختبَرة» ويُطفأ التفعيل معه — عمداً. الختم القديم أُعطي
--    لإعدادٍ لم يعد قائماً، وإبقاؤه كان سيفتح فوراً زرّ «ادفع الآن» على
--    عرضَي متجر «تاكي» الحيّين بمزوّد `sim`؛ و`sim` **محاكاة**: يختم الطلب
--    «مدفوعاً» بلا أي مال. أي أن الشفاء وحده كان سيمنح أي زائرٍ بضاعةً
--    مجّاناً. فالتاجر يضغط «اختبار الاتصال» ثم «تفعيل» بنفسه — ضغطتان.
UPDATE public.merchant_gateways g
SET secret_key_id = ds.id,
    key_last4     = right(ds.decrypted_secret, 4),
    verified_at   = NULL,
    is_enabled    = false,
    updated_at    = now()
FROM vault.decrypted_secrets ds
WHERE ds.name = 'mg_' || g.merchant_id || '_sk'
  AND (g.secret_key_id IS NULL
       OR NOT EXISTS (SELECT 1 FROM vault.secrets v WHERE v.id = g.secret_key_id));

UPDATE public.merchant_gateways g
SET webhook_secret_id = ds.id,
    updated_at        = now()
FROM vault.decrypted_secrets ds
WHERE ds.name = 'mg_' || g.merchant_id || '_whs'
  AND (g.webhook_secret_id IS NULL
       OR NOT EXISTS (SELECT 1 FROM vault.secrets v WHERE v.id = g.webhook_secret_id));

-- ب) مؤشِّر معلَّق ولا سرّ له في الخزنة ⇒ قل الحقيقة: لا مفتاح، ولا بوّابة
--    مفعَّلة، ولا ختم «مختبَرة». (لا يُطفأ `direct_pay` للمنصّة كلها — التاجر
--    وحده يعود إلى الدفع عند الاستلام حتى يُدخل مفاتيحه.)
UPDATE public.merchant_gateways g
SET secret_key_id = NULL,
    key_last4     = NULL,
    verified_at   = NULL,
    is_enabled    = false,
    updated_at    = now()
WHERE g.secret_key_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM vault.secrets v WHERE v.id = g.secret_key_id);

UPDATE public.merchant_gateways g
SET webhook_secret_id = NULL,
    updated_at        = now()
WHERE g.webhook_secret_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM vault.secrets v WHERE v.id = g.webhook_secret_id);

-- ════════════════════════════════════════════════════════════════════════════
-- ٣) الكتابة تُثبَت بقراءة — لا كتابةَ صامتة بعد اليوم
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._gateway_write(
  p_merchant_id text, p_provider text, p_publishable_key text, p_secret_key text,
  p_webhook_secret text, p_extra jsonb, p_actor_id text, p_actor_type text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_row public.merchant_gateways%ROWTYPE;
  v_sk  text := NULLIF(btrim(COALESCE(p_secret_key, '')), '');
  v_ws  text := NULLIF(btrim(COALESCE(p_webhook_secret, '')), '');
  v_provider_changed boolean := false;
  v_by_admin boolean := (p_actor_id IS DISTINCT FROM p_merchant_id);
  v_sk_name text := 'mg_' || p_merchant_id || '_sk';
  v_ws_name text := 'mg_' || p_merchant_id || '_whs';
  v_sk_id uuid;
  v_ws_id uuid;
  v_back  text;
BEGIN
  IF p_provider IS NULL OR p_provider NOT IN ('sim','moyasar','tap','paytabs','payfort','hyperpay','checkout') THEN
    RAISE EXCEPTION 'BAD_PROVIDER';
  END IF;

  SELECT * INTO v_row FROM public.merchant_gateways WHERE merchant_id = p_merchant_id;
  IF NOT FOUND THEN
    INSERT INTO public.merchant_gateways (merchant_id, provider)
    VALUES (p_merchant_id, p_provider) RETURNING * INTO v_row;
  END IF;
  v_provider_changed := (v_row.provider IS DISTINCT FROM p_provider);

  -- 🪤 v14.44 — المؤشِّر لا يُصدَّق إلا إذا حلّ إلى صفٍّ في الخزنة. ومؤشِّرٌ
  -- معلَّق يُشفى بالاسم القانوني إن وُجد (اسم الخزنة فريد، فإنشاء ثانٍ بنفس
  -- الاسم كان سيفشل، والكتابة على مؤشِّرٍ ميت كانت تمرّ صامتة).
  SELECT s.id INTO v_sk_id FROM vault.secrets s WHERE s.id = v_row.secret_key_id;
  IF v_sk_id IS NULL THEN
    SELECT s.id INTO v_sk_id FROM vault.secrets s WHERE s.name = v_sk_name;
  END IF;
  SELECT s.id INTO v_ws_id FROM vault.secrets s WHERE s.id = v_row.webhook_secret_id;
  IF v_ws_id IS NULL THEN
    SELECT s.id INTO v_ws_id FROM vault.secrets s WHERE s.name = v_ws_name;
  END IF;

  -- الوضع التجريبي لا يطلب مفاتيح — سر داخلي عشوائي يُولَّد له
  IF p_provider = 'sim' AND v_sk IS NULL AND (v_provider_changed OR v_sk_id IS NULL) THEN
    v_sk := md5(random()::text || clock_timestamp()::text) || md5(random()::text || p_merchant_id);
  END IF;

  -- المؤشِّران يُكتبان بما حُلّ فعلاً: مؤشِّرٌ معلَّق لا اسم له في الخزنة
  -- يصير NULL هنا فلا يبقى صفٌّ يدّعي مفتاحاً لا وجود له.
  UPDATE public.merchant_gateways SET
    provider          = p_provider,
    publishable_key   = COALESCE(NULLIF(btrim(COALESCE(p_publishable_key,'')), ''), publishable_key),
    extra_config      = COALESCE(p_extra, extra_config),
    secret_key_id     = v_sk_id,
    webhook_secret_id = v_ws_id,
    key_last4         = CASE WHEN v_sk_id IS NULL THEN NULL ELSE key_last4 END,
    verified_at       = CASE WHEN v_provider_changed OR v_sk IS NOT NULL OR v_ws IS NOT NULL
                               OR v_sk_id IS DISTINCT FROM v_row.secret_key_id
                             THEN NULL ELSE verified_at END,
    is_enabled        = CASE WHEN v_provider_changed OR v_sk_id IS NULL THEN false ELSE is_enabled END,
    fail_count        = 0,
    updated_at        = now()
  WHERE merchant_id = p_merchant_id;

  IF v_sk IS NOT NULL THEN
    IF v_sk_id IS NULL THEN
      v_sk_id := vault.create_secret(v_sk, v_sk_name, 'TAKI merchant gateway secret key');
    ELSE
      PERFORM vault.update_secret(v_sk_id, v_sk);
    END IF;

    -- الإثبات: اقرأ ما كُتب. `vault.update_secret` على مؤشِّرٍ ميت تُرجع
    -- void بلا خطأ وتكتب صفر صفوف — فالقراءة وحدها تكشف الفشل.
    SELECT ds.decrypted_secret INTO v_back FROM vault.decrypted_secrets ds WHERE ds.id = v_sk_id;
    IF v_back IS DISTINCT FROM v_sk THEN
      RAISE EXCEPTION 'SECRET_WRITE_FAILED';
    END IF;

    UPDATE public.merchant_gateways
    SET secret_key_id = v_sk_id, key_last4 = right(v_sk, 4)
    WHERE merchant_id = p_merchant_id;
  END IF;

  IF v_ws IS NOT NULL THEN
    IF v_ws_id IS NULL THEN
      v_ws_id := vault.create_secret(v_ws, v_ws_name, 'TAKI merchant gateway webhook secret');
    ELSE
      PERFORM vault.update_secret(v_ws_id, v_ws);
    END IF;

    SELECT ds.decrypted_secret INTO v_back FROM vault.decrypted_secrets ds WHERE ds.id = v_ws_id;
    IF v_back IS DISTINCT FROM v_ws THEN
      RAISE EXCEPTION 'SECRET_WRITE_FAILED';
    END IF;

    UPDATE public.merchant_gateways SET webhook_secret_id = v_ws_id WHERE merchant_id = p_merchant_id;
  END IF;

  INSERT INTO public.activity_log (user_id, user_type, action, entity_type, entity_id, metadata)
  VALUES (p_actor_id, p_actor_type, 'gateway_keys_updated', 'merchant_gateway', p_merchant_id,
          jsonb_build_object('provider', p_provider, 'by_admin', v_by_admin,
                             'secret_changed', v_sk IS NOT NULL, 'webhook_changed', v_ws IS NOT NULL));
  INSERT INTO public.notifications (id, user_id, title_ar, title_en, body_ar, body_en, type, meta_data)
  VALUES ('ntf_gw_' || (extract(epoch from clock_timestamp())*1000)::bigint || '_' || substr(md5(random()::text), 1, 6),
          p_merchant_id,
          '🔐 تحديث بيانات بوابة الدفع', 'Payment gateway credentials updated',
          CASE WHEN v_by_admin
            THEN 'قامت الإدارة بإعداد/تحديث بوابة الدفع لمتجرك. تجدها في لوحتك ← بطاقة «💳 بوابة الدفع».'
            ELSE 'تم تحديث بيانات بوابة الدفع لمتجرك. إن لم تكن أنت من قام بذلك فأوقف البوابة فوراً وتواصل مع الإدارة.' END,
          CASE WHEN v_by_admin
            THEN 'The platform admin configured/updated your store''s payment gateway.'
            ELSE 'Your store''s payment gateway credentials were updated. If this was not you, disable the gateway immediately and contact support.' END,
          'system', jsonb_build_object('audience', 'seller'));

  RETURN public._gateway_masked(p_merchant_id);
END $function$;

-- ════════════════════════════════════════════════════════════════════════════
-- ٤) الطبقات الثلاث الباقية تسأل الخزنة لا المؤشِّر
-- ════════════════════════════════════════════════════════════════════════════

-- أ) ما تراه لوحة التاجر: «المفتاح محفوظ» يعني محفوظاً في الخزنة فعلاً
CREATE OR REPLACE FUNCTION public._gateway_masked(p_merchant_id text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
  SELECT CASE WHEN p_merchant_id IS NULL THEN NULL ELSE
    COALESCE(
      CASE WHEN g.merchant_id IS NULL THEN NULL ELSE jsonb_build_object(
        'provider',              g.provider,
        'publishable_key',       g.publishable_key,
        'extra_config',          g.extra_config,
        'key_last4',             g.key_last4,
        'has_secret',            public._gateway_secret_live(g.merchant_id),
        'has_webhook_secret',    EXISTS (SELECT 1 FROM vault.secrets s WHERE s.id = g.webhook_secret_id),
        'payment_modes',         g.payment_modes,
        'is_enabled',            g.is_enabled,
        'disabled_by_admin',     g.disabled_by_admin,
        'fail_count',            g.fail_count,
        'verified_at',           g.verified_at,
        'agreement_accepted_at', g.agreement_accepted_at,
        'provider_enabled',      public.pay_provider_on(g.provider)
      ) END,
      '{}'::jsonb
    )
    || jsonb_build_object(
        'direct_pay_enabled', public.direct_pay_on(),
        'enabled_providers',
          COALESCE((SELECT jsonb_agg(k.key) FROM (
            SELECT e.key FROM public.platform_settings ps,
                 LATERAL jsonb_each(ps.value) e
            WHERE ps.key = 'enabled_pay_providers' AND e.value = 'true'::jsonb
          ) k), '[]'::jsonb)
      )
  END
  FROM (SELECT 1) x
  LEFT JOIN public.merchant_gateways g ON g.merchant_id = p_merchant_id;
$function$;

-- ب) التفعيل: «KEYS_REQUIRED» تُقاس من الخزنة
CREATE OR REPLACE FUNCTION public.merchant_toggle_gateway(p_enabled boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE v_uid text := auth.uid()::text; v_row public.merchant_gateways%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT * INTO v_row FROM public.merchant_gateways WHERE merchant_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'NO_GATEWAY'; END IF;
  IF p_enabled THEN
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

-- ج) ما يراه المشتري: لا زرّ «ادفع الآن» لبوّابةٍ بلا مفتاح
CREATE OR REPLACE FUNCTION public.deal_payment_mode(p_store_id text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
  SELECT CASE
    WHEN NOT public.direct_pay_on() THEN 'cod'
    WHEN g.merchant_id IS NULL THEN 'cod'
    WHEN NOT public.pay_provider_on(g.provider) THEN 'cod'
    WHEN NOT g.is_enabled OR g.disabled_by_admin OR g.verified_at IS NULL OR g.fail_count >= 5 THEN 'cod'
    -- v14.44 — الحارس الأخير: مفتاحٌ لا يَحُلّ في الخزنة = بوّابةٌ لا تعمل.
    -- كان غيابه يُظهر «ادفع الآن» على عرضين ثم يردّ GATEWAY_UNAVAILABLE.
    WHEN NOT public._gateway_secret_live(g.merchant_id) THEN 'cod'
    ELSE g.payment_modes
  END
  FROM (SELECT 1) x
  LEFT JOIN public.merchant_gateways g ON g.merchant_id = p_store_id;
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- ٥) لوحة المدير ترى الحقيقة أيضاً (عمود جديد ⇒ DROP أولاً: OR REPLACE
--    لا يغيّر نوع الإرجاع)
-- ════════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.admin_list_gateways();
CREATE FUNCTION public.admin_list_gateways()
RETURNS TABLE(merchant_id text, store_name text, provider text, payment_modes text,
              is_enabled boolean, disabled_by_admin boolean, verified_at timestamptz,
              fail_count integer, key_last4 text, agreement_accepted_at timestamptz,
              created_at timestamptz, secret_ok boolean, effective_mode text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'ADMIN_ONLY'; END IF;
  RETURN QUERY
  SELECT g.merchant_id, COALESCE(NULLIF(u.shop, ''), u.name) AS store_name, g.provider, g.payment_modes,
         g.is_enabled, g.disabled_by_admin, g.verified_at,
         g.fail_count, g.key_last4, g.agreement_accepted_at, g.created_at,
         public._gateway_secret_live(g.merchant_id) AS secret_ok,
         public.deal_payment_mode(g.merchant_id)    AS effective_mode
  FROM public.merchant_gateways g
  LEFT JOIN public.users u ON u.id = g.merchant_id
  ORDER BY g.created_at DESC;
END $function$;

DO $g$
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public.admin_list_gateways() FROM PUBLIC';
  EXECUTE 'REVOKE ALL ON FUNCTION public.admin_list_gateways() FROM anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.admin_list_gateways() TO authenticated';
END
$g$;

DELETE FROM public.admin_rpc_permissions WHERE rpc_name = 'admin_list_gateways';
INSERT INTO public.admin_rpc_permissions (rpc_name, required_perm) VALUES ('admin_list_gateways','tab_launch');

-- ════════════════════════════════════════════════════════════════════════════
-- التحقّق
-- ════════════════════════════════════════════════════════════════════════════
SELECT 'الخادم' AS الفحص,
       CASE WHEN obj_description('public'::regnamespace,'pg_namespace')
                 = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN '❌ مختبر طوكيو'
            ELSE '✅ جدة (الإنتاج)' END AS النتيجة
UNION ALL SELECT 'قاعدة الحقيقة الواحدة',
       CASE WHEN to_regprocedure('public._gateway_secret_live(text)') IS NOT NULL THEN '✅ موجودة' ELSE '❌ مفقودة' END
UNION ALL SELECT 'مؤشِّرات معلَّقة متبقّية',
       CASE WHEN (SELECT count(*) FROM public.merchant_gateways g
                  WHERE g.secret_key_id IS NOT NULL
                    AND NOT EXISTS (SELECT 1 FROM vault.secrets v WHERE v.id = g.secret_key_id)) = 0
            THEN '✅ صفر' ELSE '❌ باقية' END
UNION ALL SELECT 'بوّابة بلا مفتاح تعرض «ادفع الآن»',
       CASE WHEN (SELECT count(*) FROM public.merchant_gateways g
                  WHERE public.deal_payment_mode(g.merchant_id) <> 'cod'
                    AND NOT public._gateway_secret_live(g.merchant_id)) = 0
            THEN '✅ صفر' ELSE '❌ موجودة' END
UNION ALL SELECT 'الكتابة تُثبَت بقراءة',
       CASE WHEN pg_get_functiondef('public._gateway_write(text,text,text,text,text,jsonb,text,text)'::regprocedure)
                 LIKE '%SECRET_WRITE_FAILED%' THEN '✅ مفعَّل' ELSE '❌ غائب' END
UNION ALL SELECT 'لوحة المدير ترى secret_ok',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.parameters
                         WHERE specific_schema='public' AND parameter_name='secret_ok'
                           AND specific_name LIKE 'admin_list_gateways%')
            THEN '✅ موجود' ELSE '❌ مفقود' END;

-- حالة كل بوّابة بعد الشفاء (بلا أي قيمة سرّية)
SELECT COALESCE(NULLIF(u.shop,''), u.name) AS المتجر,
       g.provider AS المزوّد,
       public._gateway_secret_live(g.merchant_id) AS المفتاح_في_الخزنة,
       g.verified_at IS NOT NULL AS مختبَرة,
       g.is_enabled AS مفعَّلة,
       public.deal_payment_mode(g.merchant_id) AS ما_يراه_المشتري
FROM public.merchant_gateways g
LEFT JOIN public.users u ON u.id = g.merchant_id
ORDER BY 1;
