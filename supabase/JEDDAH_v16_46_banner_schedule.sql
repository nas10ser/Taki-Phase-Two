-- ═══════════════════════════════════════════════════════════════════════════
-- v16.46 — جدولةُ البانر: بدايةٌ ونهايةٌ بالساعة، أو مفتوحة
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 أمرُ ناصر (٢٠ نوفمبر ٢٠٢٦): «لا بدّ من وجود تاريخٍ محدَّد في البانر من
--    وإلى والساعة، أو تحطّ أياماً ويُحسب بالدقيقة — إلى أسبوع أو أسبوعين أو
--    شهر أو أيّ عددٍ أضعه — أو تعطيني خيار أجعلها مفتوحة».
--
-- والمقيسُ قبل الإصلاح:
--   · `banners.expires_at` موجودٌ **ونهايةٌ فقط** — ولا `starts_at` إطلاقاً.
--   · ولا حقلَ لأيٍّ منهما في شاشة البانر (لقطتا ناصر: صورة · عنوانان ·
--     وجهةُ الضغط · مكانُ الظهور — ولا تاريخ).
--   ⇒ فبانرٌ يُنشر الآن **ولا يبدأ لاحقاً**، ولا سبيلَ لجدولته لموسم.
--
-- 🪤 **والنهايةُ كانت مفروضةً في RLS وحدها** (لا في قارئ الواجهة):
--      `is_active AND (expires_at IS NULL OR expires_at > now())`
--    وهذا هو الصواب — الحارسُ في القاعدة لا في الشاشة. فتُضاف البدايةُ في
--    **نفس الموضع**، وإلّا بقي بانرٌ مجدوَلٌ يظهر قبل موعده لمن يقرأ مباشرةً.
--
-- 🪤 وتُعاد بناءُ السياسة **من نصّها الحيّ حرفاً** (قُرئ اليوم من
--    `pg_policies`) بإضافة شرطٍ واحد — لا من نسخةٍ مكتوبةٍ في هجرة، وإلّا
--    سقط فرعُ الأدمن أو تغيّر الدور. **والدورُ `public` يُنسخ كما هو**:
--    إعادةُ بنائها بـ`authenticated` تحجب البانرات عن الزوّار (درسٌ مسجَّل).
--
-- 🪤 و«عدد أيام» ليس عموداً ثالثاً: يُحسب في الشاشة إلى `expires_at` دقيقةً
--    بدقيقة. وعمودٌ لـ«المدّة» إلى جانب «النهاية» مصدرا حقيقةٍ ينحرفان.
-- ═══════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
    IF COALESCE(obj_description('public'::regnamespace, 'pg_namespace'), '')
       LIKE '%TAKI_LAB_TOKYO_MARKER%' THEN
        RAISE EXCEPTION 'هذه هجرةُ إنتاج — ورُفض تنفيذُها على المختبر (طوكيو).';
    END IF;
END $guard$;

-- ① عمودُ البداية. `NULL` = «ابدأ فوراً» — وهو سلوكُ كلّ بانرٍ قائمٍ اليوم،
--    فلا يتغيّر شيءٌ على ما هو منشور.
ALTER TABLE public.banners ADD COLUMN IF NOT EXISTS starts_at timestamptz;

COMMENT ON COLUMN public.banners.starts_at IS
    'بدايةُ الظهور. NULL = فوراً. تُفرض في سياسة banners_select لا في الواجهة.';
COMMENT ON COLUMN public.banners.expires_at IS
    'نهايةُ الظهور. NULL = مفتوحة بلا انتهاء.';

-- ② السياسةُ: نصُّها الحيُّ + شرطُ البداية. ولا يُمسّ فرعُ الأدمن ولا الدور.
DROP POLICY IF EXISTS banners_select ON public.banners;
CREATE POLICY banners_select ON public.banners
    FOR SELECT TO public
    USING (
        (
            (is_active = true)
            AND ((starts_at IS NULL) OR (starts_at <= now()))
            AND ((expires_at IS NULL) OR (expires_at > now()))
        )
        OR (SELECT taki_admin_perm('action_manage_banners'::text) AS taki_admin_perm)
    );

-- ── تحقّقٌ يرفع استثناءً ───────────────────────────────────────────────────
DO $verify$
DECLARE
    v_qual  text;
    v_roles text;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema='public' AND table_name='banners' AND column_name='starts_at') THEN
        RAISE EXCEPTION 'العمود starts_at لم يُضَف';
    END IF;

    SELECT qual, array_to_string(roles, ',') INTO v_qual, v_roles
      FROM pg_policies WHERE schemaname='public' AND tablename='banners' AND policyname='banners_select';

    IF v_qual IS NULL THEN RAISE EXCEPTION 'سياسةُ القراءة اختفت بعد إعادة البناء'; END IF;

    -- 🔴 الدورُ يُنسخ حرفاً: `authenticated` هنا تحجب البانرات عن الزوّار.
    IF v_roles <> 'public' THEN
        RAISE EXCEPTION 'الدورُ تغيّر إلى «%» — البانراتُ ستُحجب عن الزائر', v_roles;
    END IF;

    IF position('starts_at' in v_qual) = 0 THEN
        RAISE EXCEPTION 'شرطُ البداية لم يدخل السياسة — بانرٌ مجدوَلٌ سيظهر قبل موعده';
    END IF;
    IF position('expires_at' in v_qual) = 0 THEN
        RAISE EXCEPTION 'شرطُ النهاية سقط — بانرٌ منتهٍ سيبقى ظاهراً';
    END IF;
    -- وفرعُ الأدمن يبقى وإلّا لم يرَ الأدمنُ ما جدوَله قبل بدئه.
    IF position('taki_admin_perm' in v_qual) = 0 THEN
        RAISE EXCEPTION 'فرعُ الأدمن سقط — لن يرى الأدمنُ بانراً مجدوَلاً ولا منتهياً';
    END IF;

    RAISE NOTICE '✅ banners: starts_at مُضاف · السياسةُ تفرض البداية والنهاية · الدور public';
END $verify$;
