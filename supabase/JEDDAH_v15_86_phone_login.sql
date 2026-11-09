-- ═══════════════════════════════════════════════════════════════════════════
-- TAKI · JEDDAH_v15_86_phone_login.sql
--
-- 🔴 **الثغرة:** `find_email_by_phone` ممنوحةٌ لـ`anon`، فمن يعرف رقمَ جوّالِ
--    عميلٍ يعرف بريدَه (٣/دقيقة · ١٥/ساعة لكلّ عنوان · ٢٠/ساعة لكلّ رقم).
--    وهي **ليست ترفاً**: الموقعُ يناديها قبل `signInWithPassword` ليحسم البريد،
--    ودخولُ GoTrue بالجوّال مباشرةً **مُغلقٌ على الخادم** — قِيس في بيئة
--    الحاوية: `GOTRUE_EXTERNAL_PHONE_ENABLED=false` و`GOTRUE_SMS_AUTOCONFIRM=false`،
--    وفتحُه يستلزم مزوّدَ رسائل ومسارات OTP كاملة.
--
-- ⇒ العلاج: يُحسم البريدُ **على الخادم** داخل دالّة حافة، فلا يراه المتصفّحُ
--    إلّا إن صحّت كلمةُ المرور. وهذه الهجرةُ تُجهّز طرفَ القاعدة:
--      ١) `taki_phone_login_gate(text)` — تُنادى بالخدمة وحدها، تُعيد البريد.
--      ٢) `taki_phone_login_mark()`     — تُسجّل أوّلَ دخولٍ ناجحٍ بالمسار الجديد.
--      ٣) `phone_login_health`          — صفٌّ واحدٌ يحمل العدّاد والتاريخ.
--
-- 🪤 **ولا يُسحب منحُ `anon` في هذه الهجرة.** سحبُه قبل أن يُثبت المسارُ
--    الجديد يقطع الدخولَ بالجوّال عن كلّ التجّار والمشترين بلا شبكةِ أمان.
--    فالسحبُ في هجرةٍ ثانية (`v15_87`) **ترفض التنفيذ** ما لم يكن العدّادُ
--    أعلى من صفر — أي ما لم يُقَس دخولٌ حقيقيٌّ واحدٌ على الأقلّ.
--
-- 🪤 وحرّاسُ المعدّل تبقى **داخل** `find_email_by_phone` كما هي: دالّةُ الحافة
--    تمرّر `x-forwarded-for` حرفياً، فـ`_taki_client_ip()` تُطبّق حسابَها
--    القائم (تعدّ من **آخر** الترويسة لأن أوّلها يُزوَّر) وتصل العنوانَ الحقيقيّ.
--    ولو حُسب العنوانُ في الدالّة لصار كلُّ المستخدمين في دلوٍ واحدٍ (عنوانُ
--    الحاوية) ⇒ ١٥ محاولةً في الساعة **للعالم كلّه**.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── حارسُ المختبر: هذه هجرةُ إنتاجٍ لا تُنفَّذ على طوكيو ────────────────────
DO $guard$
BEGIN
    IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
        RAISE EXCEPTION 'STOP: هذه هجرةُ إنتاج (جدة) ونحن على مختبر طوكيو.';
    END IF;
END
$guard$;

-- ── ١) صفُّ الصحّة: هل عمل المسارُ الجديد فعلاً؟ ───────────────────────────
CREATE TABLE IF NOT EXISTS public.phone_login_health (
    only_row   boolean     PRIMARY KEY DEFAULT true CHECK (only_row),
    ok_count   bigint      NOT NULL DEFAULT 0,
    first_ok   timestamptz,
    last_ok    timestamptz
);
INSERT INTO public.phone_login_health (only_row) VALUES (true) ON CONFLICT DO NOTHING;

ALTER TABLE public.phone_login_health ENABLE ROW LEVEL SECURITY;
-- 🪤 والمنحُ الافتراضيُّ في هذا المشروع يُعطي `authenticated` كلَّ الصلاحيّات
--    على أيّ جدولٍ عامٍّ جديد (`arwdm`)، و`REVOKE … FROM PUBLIC` وحده لا يمسّه.
REVOKE ALL ON public.phone_login_health FROM PUBLIC;
REVOKE ALL ON public.phone_login_health FROM anon;
REVOKE ALL ON public.phone_login_health FROM authenticated;
GRANT SELECT ON public.phone_login_health TO service_role;

-- ── ٢) بوّابةُ حسم البريد — للخدمة وحدها ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.taki_phone_login_gate(p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $fn$
DECLARE
    v_email text;
BEGIN
    -- 🪤 المنحُ هو البوّابة (service_role وحده أدناه)، وهذا حزامٌ ثانٍ:
    --    `session_user` لا يغيّره `SET ROLE` ولا `SECURITY DEFINER`.
    IF NOT public.taki_is_system_caller() THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    -- حرّاسُ المعدّل كلُّها داخلها (دلوُ العنوان ودلوُ الرقم)، وهي ترفع استثناءً
    -- عند التجاوز فيصل إلى دالّة الحافة كما هو.
    v_email := public.find_email_by_phone(p_phone);

    RETURN jsonb_build_object('email', v_email);
END
$fn$;

REVOKE ALL ON FUNCTION public.taki_phone_login_gate(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_phone_login_gate(text) FROM anon;
REVOKE ALL ON FUNCTION public.taki_phone_login_gate(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.taki_phone_login_gate(text) TO service_role;

-- ── ٣) علامةُ نجاحٍ مقيس — بلا أيّ بيانٍ شخصيّ ────────────────────────────
-- 🪤 ولا تُسجَّل هويّةُ من دخل ولا رقمُه: المقصودُ إثباتُ أن **المسار** عمل،
--    لا من استعمله. عدّادٌ وتاريخان لا أكثر.
CREATE OR REPLACE FUNCTION public.taki_phone_login_mark()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
    IF NOT public.taki_is_system_caller() THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    UPDATE public.phone_login_health
       SET ok_count = ok_count + 1,
           first_ok = COALESCE(first_ok, now()),
           last_ok  = now()
     WHERE only_row;
END
$fn$;

REVOKE ALL ON FUNCTION public.taki_phone_login_mark() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_phone_login_mark() FROM anon;
REVOKE ALL ON FUNCTION public.taki_phone_login_mark() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.taki_phone_login_mark() TO service_role;

-- ═══ التحقّق — `DO` يرفع استثناءً، لا جدولُ ✅/❌ (ذاك لا يُفشل psql) ═══
DO $verify$
DECLARE
    v_bad text := '';
BEGIN
    IF to_regprocedure('public.taki_phone_login_gate(text)') IS NULL THEN
        v_bad := v_bad || ' · بوّابةُ الدخول غير منشأة';
    END IF;
    IF to_regprocedure('public.taki_phone_login_mark()') IS NULL THEN
        v_bad := v_bad || ' · علامةُ النجاح غير منشأة';
    END IF;
    IF to_regclass('public.phone_login_health') IS NULL THEN
        v_bad := v_bad || ' · جدولُ الصحّة غير منشأ';
    END IF;

    -- لا منحَ لزائرٍ ولا لموثَّقٍ على أيٍّ من الاثنتين
    IF EXISTS (
        SELECT 1 FROM information_schema.routine_privileges
         WHERE routine_schema = 'public'
           AND routine_name IN ('taki_phone_login_gate', 'taki_phone_login_mark')
           AND grantee IN ('anon', 'authenticated', 'PUBLIC')
    ) THEN
        v_bad := v_bad || ' · منحٌ باقٍ لزائرٍ أو موثَّق';
    END IF;

    -- والخدمةُ تملك التنفيذ فعلاً
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.routine_privileges
         WHERE routine_schema = 'public' AND routine_name = 'taki_phone_login_gate'
           AND grantee = 'service_role' AND privilege_type = 'EXECUTE'
    ) THEN
        v_bad := v_bad || ' · الخدمةُ لا تملك تنفيذَ البوّابة';
    END IF;

    -- ولا منحَ كتابةٍ لأحدٍ على جدول الصحّة
    IF EXISTS (
        SELECT 1 FROM information_schema.role_table_grants
         WHERE table_schema = 'public' AND table_name = 'phone_login_health'
           AND grantee IN ('anon', 'authenticated', 'PUBLIC')
    ) THEN
        v_bad := v_bad || ' · منحٌ باقٍ على جدول الصحّة';
    END IF;

    -- ⚠️ ويبقى منحُ `anon` على `find_email_by_phone` **عمداً** في هذه الهجرة:
    --    شبكةُ الأمان حتى يُقاس المسارُ الجديد. فإن اختفى هنا فذاك خطأٌ لا إنجاز.
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.routine_privileges
         WHERE routine_schema = 'public' AND routine_name = 'find_email_by_phone'
           AND grantee = 'anon'
    ) THEN
        v_bad := v_bad || ' · منحُ anon على find_email_by_phone سُحب مبكّراً (شبكةُ الأمان ضاعت)';
    END IF;

    IF v_bad <> '' THEN
        RAISE EXCEPTION 'فشل التحقّق:%', v_bad;
    END IF;

    RAISE NOTICE '✅ جدة · v15.86 · بوّابةُ الدخول بالجوّال جاهزة · منحُ anon على find_email_by_phone باقٍ عمداً كشبكةِ أمان';
END
$verify$;

COMMIT;
