-- ════════════════════════════════════════════════════════════════════════════
-- TAKI v14.54 — حارس بوّابة الخرائط: توثيقٌ وحدُّ معدّل (طلب ناصر ٣)
-- ════════════════════════════════════════════════════════════════════════════
-- `https://www.takisa.net/api/resolve-map` دالةٌ خادمية على Vercel تفكّ روابط
-- خرائط جوجل المختصرة للتاجر حين يلصق موقع محلّه. وهي اليوم:
--   • **مفتوحة للإنترنت كله** — لا توثيق ولا مفتاح. جرّبتُها من سطر الأوامر
--     بلا أي هوية فردّت ٢٠٠ ونتيجةً كاملة.
--   • **بلا حدّ معدّل** — نداءٌ بلا سقف على حصّة Vercel المجانية.
--   • و«قائمة النطاقات المسموحة» فيها تُفحص على **القفزة الأولى وحدها**: الحلقة
--     تتبع `Location` وتجلب العنوان التالي بلا إعادة فحص (السطر `continue`).
--
-- وحارس الأصل (Origin) الموجود فيها لا يحرس شيئاً: يضبط ترويسة CORS للمتصفّح
-- ولا يمنع تشغيل الدالة، وقائمتُه لا تحوي `www.takisa.net` أصلاً — فهو ضابطٌ
-- لا يعمل على أحد. **ضابطٌ لا يُنفَّذ ليس ضابطاً.**
--
-- هذه الهجرة تضع **سياسة** الحارس في القاعدة لا في الدالة: من يُسمح له، وكم
-- مرّة. فتُعدَّل بلا نشر، ولا تفترق نسختان منها. والدالة تسأل هذه الدالةَ
-- بهوية المستخدم نفسه (JWT) — فلا سرّ جديد في أي مكان.
--
-- الخادم المستهدف: **جدة (الإنتاج)**. يرفض التنفيذ على مختبر طوكيو.
-- ════════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'TOKYO_LAB_REFUSED: هذه هجرة إنتاج. نفّذها على جدة.';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.taki_map_gate()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid  text := auth.uid()::text;
  v_type text;
  v_shop text;
BEGIN
  -- ١) لا هويّة ⇒ لا خدمة. هذا وحده يُخرج الإنترنت كلّه من الباب.
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED');
  END IF;

  -- ٢) والخدمة للتجّار وحدهم: المشتري لا يرسم موقع محلّ.
  SELECT u.user_type, u.shop INTO v_type, v_shop
  FROM public.users u WHERE u.id = v_uid AND u.deleted_at IS NULL
    AND COALESCE(u.is_suspended, false) = false;
  IF v_type IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED');
  END IF;
  IF v_type NOT IN ('seller','admin') AND NULLIF(btrim(COALESCE(v_shop,'')), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SELLER_ONLY');
  END IF;

  -- ٣) حدّ المعدّل: ٢٠ نداءً في الساعة لكل تاجر. التاجر يضبط موقع محلّه مرّات
  --    معدودة في عمر المتجر، فعشرون سقفٌ سخيّ لاستعمالٍ حقيقي وضيّقٌ على إساءة.
  --    (`taki_rate_check` ترفع P0011 عند التجاوز — نلتقطها ونردّ ردّاً مفهوماً
  --    بدل أن يصل خطأ قاعدة بيانات إلى المتصفّح.)
  BEGIN
    PERFORM public.taki_rate_check('mapgate:' || v_uid, 20, 3600, 'RATE_LIMIT');
  EXCEPTION WHEN SQLSTATE 'P0011' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'RATE_LIMIT');
  END;

  RETURN jsonb_build_object('ok', true);
END $function$;

COMMENT ON FUNCTION public.taki_map_gate() IS
  'v14.54 — سياسة بوّابة الخرائط: تاجرٌ موثَّق غير موقوف، ٢٠ نداءً/ساعة. تناديها دالة Vercel بهوية المستخدم.';

REVOKE ALL ON FUNCTION public.taki_map_gate() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_map_gate() FROM anon;
GRANT EXECUTE ON FUNCTION public.taki_map_gate() TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- التحقّق — يرفع استثناءً، لا يطبع ❌ ويمضي
-- ════════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE v jsonb; v_hits int;
BEGIN
  IF to_regprocedure('public.taki_map_gate()') IS NULL THEN
    RAISE EXCEPTION 'VERIFY: الحارس مفقود'; END IF;
  IF has_function_privilege('anon','public.taki_map_gate()','EXECUTE') THEN
    RAISE EXCEPTION 'VERIFY: الزائر يستطيع نداء الحارس'; END IF;
  IF NOT has_function_privilege('authenticated','public.taki_map_gate()','EXECUTE') THEN
    RAISE EXCEPTION 'VERIFY: المستخدم الموثَّق لا يستطيع نداءه — البوّابة ستنكسر'; END IF;

  -- بلا هويّة (نحن supabase_admin، فـauth.uid() فارغة) يجب أن يُرفض.
  v := public.taki_map_gate();
  IF v->>'error' IS DISTINCT FROM 'AUTH_REQUIRED' THEN
    RAISE EXCEPTION 'VERIFY: نداءٌ بلا هويّة لم يُرفض: %', v; END IF;

  -- وأن حدّ المعدّل يعدّ فعلاً: عدّاد وهمي داخل معاملةٍ ستُلغى.
  PERFORM public.taki_rate_check('mapgate:verify-probe', 2, 3600, 'RATE_LIMIT');
  PERFORM public.taki_rate_check('mapgate:verify-probe', 2, 3600, 'RATE_LIMIT');
  BEGIN
    PERFORM public.taki_rate_check('mapgate:verify-probe', 2, 3600, 'RATE_LIMIT');
    RAISE EXCEPTION 'VERIFY: حدّ المعدّل لم يمنع النداء الثالث — الحدّ لا يحدّ';
  EXCEPTION WHEN SQLSTATE 'P0011' THEN NULL;
  END;
  DELETE FROM public.rate_limit_counters WHERE bucket_key = 'mapgate:verify-probe';
  RAISE NOTICE 'التحقّق مرّ: الرفض بلا هويّة ✅ · حدّ المعدّل يمنع فعلاً ✅';
END
$verify$;
