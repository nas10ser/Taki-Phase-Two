-- ═══════════════════════════════════════════════════════════════════════════
-- v15.21 — التحقّقُ من أنّ الرسالة منهم فعلاً
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 عيبٌ أكّده التدقيق: `inbound_secret` مُعلَنٌ وموثَّقٌ منذ v15.13 بأنه
--    «سرُّ التحقّق من كلّ رسالةٍ واردة» — **ولا شيءَ يكتبه ولا شيءَ يقرؤه.**
--    وحقلٌ كهذا أسوأُ من غيابه: الكتالوجُ يقول `verify: 'hmac-sha256-raw'`
--    فيُقرأ وعداً، والحارسُ الفعليُّ هو طولُ المسار وحده.
--
-- 🪤 ولماذا التحقّقُ في دالّة الحافة لا في القاعدة: توقيعُ سلّة فوق **الجسم
--    الخام** (ومثالُهم بـNode يُجزّئ `JSON.stringify(req.body)` وهو خطأٌ
--    موثَّقٌ عندهم نفسِهم — إعادةُ الترميز تغيّر البايتات). والبايتاتُ الخام
--    موجودةٌ في الحافة لا في القاعدة. ⇒ القاعدةُ تُسلّم السرَّ لدور الخدمة.
--
-- 🪤 وحين لا يوجد سرٌّ (قبل تسجيل تطبيق تاكي) يبقى المسارُ هو الحارسَ —
--    **ويُقال ذلك في الشاشة** ولا يُدَّعى توقيع.
-- ═══════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر. أوقِفت.';
  END IF;
  IF to_regprocedure('public.taki_stock_webhook(text,jsonb,text)') IS NULL THEN
    RAISE EXCEPTION 'v15.12 غير مطبَّقة — أوقِفت.';
  END IF;
END
$guard$;

-- ما تحتاجه دالّةُ الحافة للتحقّق: المزوّدُ والسرُّ، بمفتاحٍ أو بمسار
DROP FUNCTION IF EXISTS public.taki_stock_inbound_guard(text);
CREATE FUNCTION public.taki_stock_inbound_guard(p_key text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_i public.stock_integrations%ROWTYPE; v_hash text;
BEGIN
  IF p_key IS NULL OR length(btrim(p_key)) < 20 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'BAD_KEY');
  END IF;
  v_hash := encode(extensions.digest(btrim(p_key), 'sha256'), 'hex');
  SELECT * INTO v_i FROM public.stock_integrations
   WHERE (api_key_hash = v_hash OR webhook_slug = btrim(p_key))
     AND is_enabled AND direction IN ('in','both');
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'UNKNOWN_KEY'); END IF;
  RETURN jsonb_build_object('ok', true, 'provider', lower(v_i.provider),
    'secret', NULLIF(btrim(COALESCE(v_i.inbound_secret, '')), ''));
END
$fn$;
REVOKE ALL ON FUNCTION public.taki_stock_inbound_guard(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_stock_inbound_guard(text) FROM anon;
REVOKE ALL ON FUNCTION public.taki_stock_inbound_guard(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.taki_stock_inbound_guard(text) TO service_role;

-- ويُكتب السرُّ لحظةَ تسجيل الخطّاف لدى المنصّة (من دالّة الحافة)
DROP FUNCTION IF EXISTS public.taki_stock_set_inbound_secret(uuid, text);
CREATE FUNCTION public.taki_stock_set_inbound_secret(p_id uuid, p_secret text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_back text;
BEGIN
  IF COALESCE(btrim(COALESCE(p_secret,'')),'') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SECRET_REQUIRED');
  END IF;
  UPDATE public.stock_integrations SET inbound_secret = btrim(p_secret) WHERE id = p_id;
  -- 🪤 تُثبَت بقراءة: `UPDATE` على معرّفٍ غيرِ موجودٍ يكتب صفرَ صفوفٍ بلا خطأ.
  SELECT inbound_secret INTO v_back FROM public.stock_integrations WHERE id = p_id;
  IF COALESCE(v_back,'') <> btrim(p_secret) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'WRITE_FAILED');
  END IF;
  RETURN jsonb_build_object('ok', true);
END
$fn$;
REVOKE ALL ON FUNCTION public.taki_stock_set_inbound_secret(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_stock_set_inbound_secret(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.taki_stock_set_inbound_secret(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.taki_stock_set_inbound_secret(uuid, text) TO service_role;

-- وللشاشة: **هل** يوجد توقيعٌ — لا قيمتُه
DROP FUNCTION IF EXISTS public.merchant_stock_verify_state(uuid);
CREATE FUNCTION public.merchant_stock_verify_state(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_me text := NULLIF((SELECT auth.uid())::text, ''); v_i public.stock_integrations%ROWTYPE;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED'); END IF;
  SELECT * INTO v_i FROM public.stock_integrations WHERE id = p_id;
  IF v_i.store_id IS NULL OR v_i.store_id <> v_me THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_YOURS');
  END IF;
  RETURN jsonb_build_object('ok', true,
    'signed', COALESCE(btrim(COALESCE(v_i.inbound_secret,'')), '') <> '',
    'method', CASE lower(v_i.provider) WHEN 'salla' THEN 'hmac-sha256-raw'
                                       WHEN 'zid'   THEN 'basic-auth'
                                       ELSE 'none' END);
END
$fn$;
REVOKE ALL ON FUNCTION public.merchant_stock_verify_state(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merchant_stock_verify_state(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.merchant_stock_verify_state(uuid) TO authenticated;

DO $verify$
DECLARE r jsonb;
BEGIN
  IF to_regprocedure('public.taki_stock_inbound_guard(text)') IS NULL
     OR to_regprocedure('public.taki_stock_set_inbound_secret(uuid,text)') IS NULL THEN
    RAISE EXCEPTION '❌ إحدى الدالّتين لم تُنشأ.';
  END IF;
  -- 🔴 ولا يُقرأ السرُّ من دورٍ عامّ بأيّ طريق
  IF has_function_privilege('anon', 'public.taki_stock_inbound_guard(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.taki_stock_inbound_guard(text)', 'EXECUTE')
     OR has_column_privilege('authenticated', 'public.stock_integrations', 'inbound_secret', 'SELECT')
     OR has_column_privilege('anon', 'public.stock_integrations', 'inbound_secret', 'SELECT') THEN
    RAISE EXCEPTION '❌ 🔴 سرُّ التحقّق الوارد مقروءٌ من دورٍ عامّ.';
  END IF;
  -- ومفتاحٌ قصيرٌ أو مجهولٌ يُرفض
  IF COALESCE(public.taki_stock_inbound_guard('short')->>'error','') <> 'BAD_KEY' THEN
    RAISE EXCEPTION '❌ مفتاحٌ قصيرٌ لم يُرفض.';
  END IF;
  IF COALESCE(public.taki_stock_inbound_guard('taki_nope_0123456789abcdefghij')->>'error','') <> 'UNKNOWN_KEY' THEN
    RAISE EXCEPTION '❌ مفتاحٌ مجهولٌ لم يُرفض.';
  END IF;
  -- وكتابةُ سرٍّ لمعرّفٍ غيرِ موجودٍ تُقال فشلاً لا نجاحاً
  IF COALESCE((public.taki_stock_set_inbound_secret(
        '00000000-0000-0000-0000-000000000000'::uuid, 'x')->>'ok')::boolean, false) THEN
    RAISE EXCEPTION '❌ 🔴 كتابةٌ بصفر صفوفٍ قيلت ناجحة — نفسُ عيب الخزنة في v14.44.';
  END IF;
  RAISE NOTICE '✅ v15.21: سرُّ التحقّق محجوبٌ عن كلّ دورٍ عامّ · والكتابةُ تُثبَت بقراءة.';
END
$verify$;
