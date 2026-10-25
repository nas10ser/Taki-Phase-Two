-- ═══════════════════════════════════════════════════════════════════════════
-- v15.22 — ما تحتاجه دالّةُ الحافة بالضبط، لا أكثر
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 وسرُّ المهمّة يُسلَّم بدالّةٍ خاصّةٍ لا بمنح `app_secrets` كلِّه: ذاك العرضُ
--    يحمل سرَّ بوّابة البوت وسرَّ الدفعات ومفتاحَ تيرنستايل. ومنحُ الكلّ لقراءةِ
--    واحدٍ هو كيف تتسرّب الأسرار.
DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر. أوقِفت.';
  END IF;
  IF to_regprocedure('public._taki_stock_app(text)') IS NULL THEN
    RAISE EXCEPTION 'v15.18 غير مطبَّقة — أوقِفت.';
  END IF;
END
$guard$;

-- دالّةُ الحافة تحتاج بياناتَ التطبيق للمبادلة والتحديث والتوقيع
GRANT EXECUTE ON FUNCTION public._taki_stock_app(text) TO service_role;

DROP FUNCTION IF EXISTS public.taki_stock_oauth_job_secret();
CREATE FUNCTION public.taki_stock_oauth_job_secret()
RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT jsonb_build_object('secret',
    (SELECT value FROM public.app_secrets WHERE key = 'stock_oauth_secret'));
$fn$;
REVOKE ALL ON FUNCTION public.taki_stock_oauth_job_secret() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_stock_oauth_job_secret() FROM anon;
REVOKE ALL ON FUNCTION public.taki_stock_oauth_job_secret() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.taki_stock_oauth_job_secret() TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- ملاحظةٌ دقيقةٌ من المدقّق: ثمانيةُ أقواسٍ في رقعة v15.15 أنتجت `''''`
-- ═══════════════════════════════════════════════════════════════════════════
-- أي أنّ الافتراضيّ عند غياب المسار هو **فاصلةٌ عليا واحدة** لا نصٌّ فارغ.
-- والأثرُ اليوم صفر (لا قيمةَ `equals` تساوي `'`)، لكنّه خطأٌ كامن: مزوّدٌ
-- يُعلن `skip_when` بقيمة `'` كان سيُسقط كلَّ رسالةٍ لا تحمل المسار.
DO $patch$
DECLARE src text; src0 text;
BEGIN
  src := pg_get_functiondef('public.taki_stock_webhook(text,jsonb,text)'::regprocedure);
  src0 := src;
  IF position(E'public._taki_jpath(p_body, c->>''path'')' IN src) = 0 THEN
    RAISE NOTICE 'ℹ️ لا كتلةَ skip_when بهذا الشكل — تُترك.'; RETURN;
  END IF;
  IF position(E'lower(COALESCE(public._taki_jpath(p_body, c->>''path''),''''''''))' IN src) = 0 THEN
    RAISE NOTICE 'ℹ️ الافتراضيّ سليمٌ أصلاً.'; RETURN;
  END IF;
  src := replace(src,
    E'lower(COALESCE(public._taki_jpath(p_body, c->>''path''),''''''''))',
    E'lower(COALESCE(public._taki_jpath(p_body, c->>''path''), ''~absent~''))');
  IF src = src0 THEN RAISE EXCEPTION '❌ لم تقع الرقعة.'; END IF;
  EXECUTE src;
  IF position('~absent~' IN pg_get_functiondef('public.taki_stock_webhook(text,jsonb,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '❌ الرقعة لم تُنفَّذ.';
  END IF;
  RAISE NOTICE '✅ الافتراضيّ صار علامةً صريحةً لا تُطابق أيّ قيمةٍ حقيقية.';
END
$patch$;

DO $verify$
BEGIN
  IF NOT has_function_privilege('service_role', 'public._taki_stock_app(text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.taki_stock_oauth_job_secret()', 'EXECUTE') THEN
    RAISE EXCEPTION '❌ دورُ الخدمة لا يستطيع ما تحتاجه الحافة.';
  END IF;
  IF has_function_privilege('anon', 'public.taki_stock_oauth_job_secret()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.taki_stock_oauth_job_secret()', 'EXECUTE')
     OR has_function_privilege('anon', 'public._taki_stock_app(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._taki_stock_app(text)', 'EXECUTE') THEN
    RAISE EXCEPTION '❌ 🔴 سرُّ المهمّة أو بياناتُ التطبيق مكشوفةٌ لدورٍ عامّ.';
  END IF;
  -- 🔴 وأنّ حارسَ skip_when ما زال يعمل بعد الرقعة (كسرةُ v15.15 نفسها)
  IF position('skip_when' IN pg_get_functiondef('public.taki_stock_webhook(text,jsonb,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '❌ 🔴 حارسُ الصفر اختفى من النصّ الحيّ.';
  END IF;
  RAISE NOTICE '✅ v15.22: الحافةُ تملك ما تحتاجه وحده · والأسرارُ محجوبة.';
END
$verify$;
