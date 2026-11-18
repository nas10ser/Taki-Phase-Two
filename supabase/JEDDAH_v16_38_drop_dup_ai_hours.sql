-- ═══════════════════════════════════════════════════════════════════════════
-- v16.38 — إسقاطُ نسخةٍ مكرّرةٍ ميّتةٍ من `admin_ai_hours`
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 أمرُ ناصر (١٨ نوفمبر ٢٠٢٦): «اذا كان هناك تكرارا فاحذف التكرار».
--
-- والمقيسُ على جدة: `public.admin_ai_hours` موجودةٌ **بنسختين**:
--   ① (p_from int, p_to int, p_dow int, p_days int)      — ٤٬٨٥٩ محرفاً
--   ② (p_days int, p_city text, p_category text, p_dow int) — ٢٬٩٩٥ محرفاً
--
-- والنسخةُ ② **ميّتة**، بثلاثة أدلّة مقيسة:
--   · المنادي الوحيد في الكود `src/services/adminService.ts:626` يُرسل
--     `p_from · p_to · p_dow · p_days` — أي طقمَ أسماء النسخة ①.
--   · صفرُ مطابقةٍ لـ`admin_ai_hours` في `server/` و`shared/`
--     و`supabase/functions/`.
--   · واسما `p_city`/`p_category` في الكود يخصّان `admin_ai_matrix` و
--     `admin_ai_custom` لا هذه.
--
-- 🪤 **ولماذا تُحذف وهي لا تُنادى**: كلتاهما ممنوحتان لـ`authenticated`، أي
--    أنها سطحٌ عامٌّ حيٌّ لا يستعمله أحد. والأخطرُ أنها بذرةُ فخِّ «النداء
--    الملتبس» المسجَّل في قواعد المشروع (v14.25): يكفي أن يُعاد تسميةُ مُعامل
--    في إحداهما ليتطابق الطقمان فيصمت المنادي بـ«function is not unique».
--
-- 🪤 وتُسقَط **بتوقيعها الكامل** لا بالاسم: `DROP FUNCTION admin_ai_hours`
--    بلا توقيعٍ يفشل أصلاً حين توجد نسختان — وهو حارسٌ طبيعيّ هنا، لكنّ
--    التصريحَ بالتوقيع يجعل المقصودَ مكتوباً لا محظوظاً.
-- 🪤 ولا `CASCADE`: لو تعلّق بها شيءٌ لم نره، نريد أن **يفشل** الإسقاط لا أن
--    يجرف معه ما تعلّق.
-- ═══════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
    IF COALESCE(obj_description('public'::regnamespace, 'pg_namespace'), '')
       LIKE '%TAKI_LAB_TOKYO_MARKER%' THEN
        RAISE EXCEPTION 'هذه هجرةُ إنتاج — ورُفض تنفيذُها على المختبر (طوكيو).';
    END IF;
END $guard$;

-- ── تحقّقٌ قبليّ: النسخةُ الحيّة موجودةٌ فعلاً قبل أن نُسقط الأخرى ─────────
DO $pre$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'admin_ai_hours'
           AND pg_get_function_identity_arguments(p.oid)
               = 'p_from integer, p_to integer, p_dow integer, p_days integer'
    ) THEN
        RAISE EXCEPTION 'النسخةُ الحيّة (p_from…) غير موجودة — أُوقف الإسقاط كي لا تبقى الشاشةُ بلا دالّة';
    END IF;
END $pre$;

DROP FUNCTION IF EXISTS public.admin_ai_hours(integer, text, text, integer);

-- ── تحقّقٌ يرفع استثناءً ───────────────────────────────────────────────────
DO $verify$
DECLARE
    v_n    int;
    v_args text;
BEGIN
    SELECT count(*) INTO v_n
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'admin_ai_hours';

    IF v_n <> 1 THEN
        RAISE EXCEPTION 'المتوقَّع نسخةٌ واحدة من admin_ai_hours، والموجود %', v_n;
    END IF;

    SELECT pg_get_function_identity_arguments(p.oid) INTO v_args
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'admin_ai_hours';

    IF v_args <> 'p_from integer, p_to integer, p_dow integer, p_days integer' THEN
        RAISE EXCEPTION 'الباقيةُ ليست النسخةَ الحيّة — توقيعُها: %', v_args;
    END IF;

    RAISE NOTICE '✅ admin_ai_hours: بقيت نسخةٌ واحدة (%)', v_args;
END $verify$;
