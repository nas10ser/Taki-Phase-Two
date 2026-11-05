-- ═══════════════════════════════════════════════════════════════════════════
-- v15.48 — ما بقي من الفحص المستقلّ: منحٌ زائد، وتعليقٌ يَعِد بترتيبٍ مستحيل
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 الأوّلُ فخٌّ موثَّقٌ في CLAUDE.md ووقعتُ فيه في v15.45 رغم ذلك:
--    «`REVOKE … FROM PUBLIC` لا يُلغي منحَ `anon`/`authenticated` المباشر».
--    كتبتُ `REVOKE FROM PUBLIC` و`FROM anon` ثم `GRANT TO service_role`،
--    و`authenticated` بقي يملك التنفيذَ بمنحٍ افتراضيّ من سوبابيس.
--    وأثرُه: أيُّ مستخدمٍ مسجَّل يستطيع سردَ المتاجر التي انحرف فيها إقرارُ
--    طريقة الحساب — تسريبُ حالةِ متاجرَ أخرى، صغيرٌ لكنّه ليس له سبب.
-- ═══════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر. أوقِفت.';
  END IF;
  IF to_regprocedure('public.taki_audit_payment_drift()') IS NULL THEN
    RAISE EXCEPTION 'أساسُ v15.45 غائب — أوقِفت.';
  END IF;
END
$guard$;

REVOKE ALL ON FUNCTION public.taki_audit_payment_drift() FROM authenticated;

-- 🪤 وتُراجَع أخواتُها من نفس الإصدارات: كلُّ دالّةٍ أُريد لها أن تكون
--    للخدمة وحدها، فلا يكفي REVOKE من PUBLIC.
REVOKE ALL ON FUNCTION public.taki_is_lab() FROM anon;

DO $verify$
BEGIN
  IF has_function_privilege('authenticated', 'public.taki_audit_payment_drift()', 'EXECUTE') THEN
    RAISE EXCEPTION '❌ ما زال المستخدمُ المسجَّل يملك كاشفَ الانحراف';
  END IF;
  IF has_function_privilege('anon', 'public.taki_audit_payment_drift()', 'EXECUTE') THEN
    RAISE EXCEPTION '❌ الزائرُ يملك كاشفَ الانحراف';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.taki_audit_payment_drift()', 'EXECUTE') THEN
    RAISE EXCEPTION '❌ أُلغي منحُ الخدمة — الكاشفُ لم يَعُد يعمل أصلاً';
  END IF;
  -- وما يحتاجه المتصفّحُ فعلاً لم يُمسّ
  IF NOT has_function_privilege('authenticated', 'public.merchant_set_booking_holds(numeric,numeric)', 'EXECUTE')
     OR NOT has_function_privilege('anon', 'public.store_policies(text)', 'EXECUTE') THEN
    RAISE EXCEPTION '❌ أُلغي منحٌ تحتاجه الواجهة — هذا كسرٌ لا إحكام';
  END IF;
END
$verify$;

SELECT 'كاشفُ الانحراف: authenticated' AS "البند",
  has_function_privilege('authenticated','public.taki_audit_payment_drift()','EXECUTE')::text AS "القيمة"
UNION ALL SELECT 'كاشفُ الانحراف: service_role',
  has_function_privilege('service_role','public.taki_audit_payment_drift()','EXECUTE')::text
UNION ALL SELECT 'مهلةُ التاجر: authenticated',
  has_function_privilege('authenticated','public.merchant_set_booking_holds(numeric,numeric)','EXECUTE')::text;
