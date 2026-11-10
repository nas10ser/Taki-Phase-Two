-- ═══════════════════════════════════════════════════════════════════════════
-- TAKI · JEDDAH_v15_87_close_phone_disclosure.sql
--
-- الخطوةُ الأخيرة: سحبُ منح `anon` عن `find_email_by_phone` — فلا يبقى طريقٌ
-- يُعيد بريدَ حسابٍ من رقم جوّاله لزائرٍ مجهول.
--
-- 🔴 **ولا تُنفَّذ قبل شرطين — وكلاهما مفروضٌ بالكود أدناه (v15.89):**
--    ① عدّادُ `phone_login_health.ok_count > 0` — أي أن المسارَ الخادميّ
--      (`supabase/functions/phone-login`) أنجح دخولاً حقيقياً واحداً على
--      الأقلّ. وبدونه يكون السحبُ قطعاً للدخول بالجوّال عن كلّ التجّار
--      والمشترين بلا شبكةِ أمان. **وهذا الشرطُ يرفع استثناءً أدناه.**
--    ② **ومسارُ «نسيت كلمة المرور» بالجوّال انتقل هو الآخر إلى الخادم.**
--      `src/pages/Register.tsx` ينادي `find_email_by_phone` ليحلّ الرقمَ قبل
--      إرسال رابط الاستعادة — وهو نفسُ التسريب. وإغلاقُه ليس إرسالَ الرسالة
--      من الخادم وحده: الشاشةُ تحتاج البريدَ **بعد** الإرسال أيضاً (إدخالُ
--      الرمز `verifyOtp` وإعادةُ الإرسال)، فيلزم نقلُ **تحقّق الرمز** كذلك.
--      ولا تُقاس هذه السلسلةُ بلا حسابِ تجربة.
--      🪤 وكان هذا الشرطُ **نثراً في هذه الترويسة** حتى v15.89 — ونثرٌ لا يمنع
--         تنفيذاً. صار عموداً (`recover_server_side`) تفحصه كتلةُ `DO` أدناه.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $guard$
BEGIN
    IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
        RAISE EXCEPTION 'STOP: هذه هجرةُ إنتاج (جدة) ونحن على مختبر طوكيو.';
    END IF;
END
$guard$;

-- ── الشرطُ ②: مسارُ «نسيت كلمة المرور» انتقل هو الآخر إلى الخادم ──────────
-- 🔴 كان هذا نثراً في الترويسة حتى v15.89 — ونثرٌ لا يمنع تنفيذاً.
DO $recover$
DECLARE v_ok boolean;
BEGIN
    SELECT recover_server_side INTO v_ok FROM public.phone_login_health WHERE only_row;
    IF NOT COALESCE(v_ok, false) THEN
        RAISE EXCEPTION
            'STOP: مسارُ «نسيت كلمة المرور» بالجوّال ما زال ينادي find_email_by_phone '
            'من المتصفّح. سحبُ المنح الآن يكسر استعادةَ كلمة المرور — وهو أسوأُ من '
            'التسريب الذي تُغلقه هذه الهجرة. انقل المسارَ أوّلاً (حسمُ البريد وتحقّقُ '
            'الرمز على الخادم) ثمّ اضبط phone_login_health.recover_server_side = true.';
    END IF;
END
$recover$;

-- ── الشرطُ ①: دخولٌ حقيقيٌّ واحدٌ على الأقلّ عبر المسار الجديد ────────────
DO $gate$
DECLARE
    v_ok bigint;
BEGIN
    SELECT ok_count INTO v_ok FROM public.phone_login_health WHERE only_row;
    IF COALESCE(v_ok, 0) < 1 THEN
        RAISE EXCEPTION
            'STOP: لم يُقَس أيُّ دخولٍ ناجحٍ على المسار الخادميّ بعد (ok_count=%). '
            'سحبُ المنح الآن يقطع الدخولَ بالجوّال عن الجميع بلا شبكةِ أمان. '
            'ليدخل أحدُكم بجوّاله مرّةً واحدة ثمّ أعِد تشغيل هذه الهجرة.',
            COALESCE(v_ok, 0);
    END IF;
END
$gate$;

-- ── السحب ─────────────────────────────────────────────────────────────────
-- 🪤 والاثنان لازمان: `REVOKE … FROM PUBLIC` لا يُلغي منحَ `anon` المباشر،
--    ولا العكس (درسٌ مدفوعُ الثمن في هذا المشروع).
REVOKE EXECUTE ON FUNCTION public.find_email_by_phone(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.find_email_by_phone(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.find_email_by_phone(text) FROM authenticated;
-- وتبقى للخدمة: `taki_phone_login_gate` تناديها من داخل دالّة الحافة.
GRANT EXECUTE ON FUNCTION public.find_email_by_phone(text) TO service_role;

DO $verify$
DECLARE
    v_bad text := '';
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.routine_privileges
         WHERE routine_schema = 'public' AND routine_name = 'find_email_by_phone'
           AND grantee IN ('anon', 'authenticated', 'PUBLIC')
    ) THEN
        v_bad := v_bad || ' · منحٌ باقٍ لزائرٍ أو موثَّق';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.routine_privileges
         WHERE routine_schema = 'public' AND routine_name = 'find_email_by_phone'
           AND grantee = 'service_role' AND privilege_type = 'EXECUTE'
    ) THEN
        v_bad := v_bad || ' · الخدمةُ فقدت التنفيذ ⇒ الدخولُ بالجوّال ينكسر كلّياً';
    END IF;
    IF v_bad <> '' THEN
        RAISE EXCEPTION 'فشل التحقّق:%', v_bad;
    END IF;
    RAISE NOTICE '✅ جدة · v15.87 · لم يَعُد بريدُ أيّ حسابٍ يُستخرج من رقم جوّاله لزائرٍ مجهول';
END
$verify$;

COMMIT;
