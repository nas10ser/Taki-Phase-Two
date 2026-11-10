-- ═══════════════════════════════════════════════════════════════════════════
-- TAKI · JEDDAH_v15_88_phone_login_telemetry.sql
--
-- 🔴 **المفصلُ الوحيدُ الذي لم يُقَس** في مسار الدخول الخادميّ (v15.86):
--    هل يقبل Cloudflare رمزَ كابتشا مرّ عبر دالّة الحافة؟ قِيس ما حوله كلُّه
--    (GoTrue يسجّل **نفسَ العنوان** في المسارين · وحدُّ المعدّل يعضّ عند
--    الرابعة · والردُّ موحّدٌ بايتاً ببايت · والفرقُ الزمنيُّ ٠٫٠٢٣ م.ث)،
--    لكنّ رمزاً صالحاً لم يمرّ بعد: المتصفّحُ المدمج لا يُكمل تحدّيَ Turnstile.
--
-- وبدل انتظار بلاغٍ من مستخدم، يصير الجوابُ **مقروءاً من القاعدة**: تُسجَّل
-- فشلاتُ الكابتشا عبر الوسيط كما تُسجَّل النجاحات. فبعد أوّل ساعةٍ من الإطلاق:
--    • `ok_count > 0`                       ⇒ المسارُ يعمل ⇒ تُشغَّل v15_87.
--    • `ok_count = 0` و`captcha_fail > 0`   ⇒ الكابتشا لا تعبر الوسيط ⇒ يُراجَع.
--    • كلاهما صفر                            ⇒ لم يحاول أحدٌ بعد.
--
-- 🪤 **ولا `CREATE OR REPLACE` مع معاملٍ جديد**: ذاك يُنشئ نسخةً ثانية فيصير
--    النداءُ ملتبساً («function is not unique») وتسكت الدالّتان. تُسقط القديمةُ
--    أوّلاً — وهذا فخٌّ مدفوعُ الثمن في هذا المشروع.
-- 🪤 ولا يُسجَّل أيُّ بيانٍ شخصيّ: عدّادان وتواريخ. لا رقمٌ ولا بريدٌ ولا عنوان.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $guard$
BEGIN
    IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
        RAISE EXCEPTION 'STOP: هذه هجرةُ إنتاج (جدة) ونحن على مختبر طوكيو.';
    END IF;
END
$guard$;

ALTER TABLE public.phone_login_health
    ADD COLUMN IF NOT EXISTS captcha_fail      bigint      NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_captcha_fail timestamptz;

-- 🪤 الإسقاطُ أوّلاً (بلا CASCADE): المعاملُ الجديد يُنشئ حِملاً زائداً لا بديلاً.
DROP FUNCTION IF EXISTS public.taki_phone_login_mark();
DROP FUNCTION IF EXISTS public.taki_phone_login_mark(text);

CREATE FUNCTION public.taki_phone_login_mark(p_kind text DEFAULT 'ok')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
    IF NOT public.taki_is_system_caller() THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    IF p_kind = 'captcha' THEN
        UPDATE public.phone_login_health
           SET captcha_fail = captcha_fail + 1, last_captcha_fail = now()
         WHERE only_row;
    ELSE
        UPDATE public.phone_login_health
           SET ok_count = ok_count + 1,
               first_ok = COALESCE(first_ok, now()),
               last_ok  = now()
         WHERE only_row;
    END IF;
END
$fn$;

REVOKE ALL ON FUNCTION public.taki_phone_login_mark(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_phone_login_mark(text) FROM anon;
REVOKE ALL ON FUNCTION public.taki_phone_login_mark(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.taki_phone_login_mark(text) TO service_role;

DO $verify$
DECLARE v_bad text := ''; v_n int;
BEGIN
    -- نسخةٌ واحدةٌ لا اثنتان (فخُّ الحِمل الزائد)
    SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'taki_phone_login_mark';
    IF v_n <> 1 THEN v_bad := v_bad || format(' · %s نسخةً من taki_phone_login_mark (المطلوب ١)', v_n); END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema='public' AND table_name='phone_login_health' AND column_name='captcha_fail') THEN
        v_bad := v_bad || ' · عمودُ captcha_fail غائب';
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.routine_privileges
                WHERE routine_schema='public' AND routine_name='taki_phone_login_mark'
                  AND grantee IN ('anon','authenticated','PUBLIC')) THEN
        v_bad := v_bad || ' · منحٌ باقٍ لزائرٍ أو موثَّق';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.routine_privileges
                WHERE routine_schema='public' AND routine_name='taki_phone_login_mark'
                  AND grantee='service_role' AND privilege_type='EXECUTE') THEN
        v_bad := v_bad || ' · الخدمةُ لا تملك التنفيذ';
    END IF;

    IF v_bad <> '' THEN RAISE EXCEPTION 'فشل التحقّق:%', v_bad; END IF;
    RAISE NOTICE '✅ جدة · v15.88 · فشلُ الكابتشا عبر الوسيط صار مقروءاً من القاعدة';
END
$verify$;

COMMIT;
