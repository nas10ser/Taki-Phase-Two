-- ═══════════════════════════════════════════════════════════════════════════
-- TAKI · JEDDAH_v15_89_recover_gate.sql
-- 🔴 كان الشرطُ الثاني لهجرة الإغلاق (v15.87) **نثراً في ترويستها**: «لا
--    تُنفَّذ قبل أن ينتقل مسارُ «نسيت كلمة المرور» إلى الخادم». ونثرٌ لا يمنع
--    تنفيذاً — وتشغيلُها قبله يكسر استعادةَ كلمة المرور بالجوّال، وهو أسوأُ
--    من التسريب الذي تُغلقه. فيصير الشرطُ **عموداً يُفحَص**.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $guard$
BEGIN
  IF obj_description('public'::regnamespace,'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'STOP: هجرةُ إنتاج على مختبر طوكيو.';
  END IF;
END $guard$;

ALTER TABLE public.phone_login_health
  ADD COLUMN IF NOT EXISTS recover_server_side boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.phone_login_health.recover_server_side IS
  'يصير true حين ينتقل مسارُ «نسيت كلمة المرور» بالجوّال إلى الخادم (حسمُ البريد + تحقّقُ الرمز). وv15.87 ترفض السحبَ قبله.';

DO $v$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='phone_login_health'
                    AND column_name='recover_server_side') THEN
    RAISE EXCEPTION 'فشل التحقّق: العمود لم يُنشأ';
  END IF;
  RAISE NOTICE '✅ جدة · v15.89 · شرطُ مسار الاستعادة صار عموداً يُفحَص لا نثراً';
END $v$;
COMMIT;
