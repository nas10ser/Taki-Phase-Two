-- ═══════════════════════════════════════════════════════════════════════════
-- v16.23 — ملاحظةُ المشتري تصل الفاتورة
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 **بلاغُ ناصر**: «في الفاتورة لا بدّ أن يضع ملاحظات المشتري … حتى
--    يلتزموا بها ولا يكون هناك أي خطأ عند إنشاء الطلب».
--
-- القياسُ على جدة: **٦١ طلباً من ١٢٤ تحمل ملاحظة، وواحدٌ فقط بصيغة `📝`.**
-- والمُستخرِجُ في الموضعين يشترط تلك البادئة:
--     v_buyer_note := substring(notes FROM '📝\s*([^\n]*(?:\n(?!💰)[^\n]*)*)')
-- أي أن **٦٠ ملاحظةً لم تصل الفاتورةَ قطّ** — لا ورقةَ الموقع ولا PDF البوت.
-- 🪤 وهو عيبٌ صامت: الملاحظةُ تظهر في «حجوزاتي» (تقرأ `notes` مباشرةً)
--    فيظنّ الجميعُ أنها وصلت، وهي غائبةٌ عن الورقة التي بيد التاجر.
--
-- والصيغُ الثلاثُ كما هي في البيانات (قِيست لا افتُرضت):
--   (أ) `📦 …⏎📝 سوف ناتي خلال ساعه⏎💰 الإجمالي: 80 ر.س` ⇒ ما بين 📝 و💰.
--   (ب) `📦 تفاصيل الطلب:⏎• علم صغير ×1⏎💰 الإجمالي: 20 ر.س` ⇒ **لا ملاحظة**.
--       (وبلا هذا الفرع تُطبع تفاصيلُ الطلب على أنها «ملاحظة المشتري».)
--   (ج) `اريد الحليب حرارتها وسط` ⇒ النصُّ كلُّه.
--
-- 🔴 والقاعدةُ **دالّةٌ واحدة** يناديها كلُّ من يحتاجها — لا نسخةٌ في كلّ
--    فاتورة (درسُ v16.18: نسختان تنحرفان، وكُشفت بالإثبات السلوكيّ).
-- ═══════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF COALESCE(obj_description('public'::regnamespace, 'pg_namespace'), '')
       LIKE 'TAKI_LAB_TOKYO_MARKER%' THEN
    RAISE EXCEPTION 'هذه هجرةُ إنتاج — ورُفضت لأنها تُنفَّذ على المختبر (طوكيو).';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.taki_buyer_note(p_notes text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
    SELECT CASE
        WHEN COALESCE(btrim(p_notes), '') = '' THEN NULL
        -- (أ) الصيغةُ المركَّبةُ القديمة
        -- 🪤 **فخُّ PostgreSQL**: في تعبيراته المنتظمة **أوّلُ مُكمِّمٍ في
        --    النمط يحكم جشعَ النمط كلِّه**. فـ`[ \t]*` الجشعةُ قبل `(...)*?`
        --    جعلت الكسولةَ جشعةً، فابتلع الالتقاطُ سطرَ `💰 الإجمالي` معه
        --    (قِيس: أعادت «سوف ناتي خلال ساعه⏎💰 الإجمالي: 80 ر.س»).
        --    ⇒ لا اعتمادَ على الكسل: السطورُ تُوصف صراحةً — أيُّ سطرٍ، أو
        --    سطرٌ جديدٌ **لا يتبعه** `💰`.
        WHEN p_notes LIKE '%📝%' THEN
            NULLIF(btrim(COALESCE(
                (regexp_match(p_notes, '📝[ \t]*((?:[^\n]|\n(?![ \t]*💰))*)'))[1], '')), '')
        -- (ب) نصٌّ كتبه النظامُ لا المشتري
        WHEN p_notes ~ '[📦📏💰]' THEN NULL
        -- (ج) نصٌّ خامٌّ كتبه المشتري
        ELSE NULLIF(btrim(p_notes), '')
    END;
$fn$;
REVOKE ALL ON FUNCTION public.taki_buyer_note(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.taki_buyer_note(text) TO anon, authenticated, service_role;

-- ── يُستبدل الاستخراجُ في فاتورة البوت بنداءِ القاعدة الواحدة ────────────
DO $patch$
DECLARE
    v_src text;
    v_new text;
    v_old text;
BEGIN
    SELECT pg_get_functiondef(p.oid) INTO v_src
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'bot_get_booking_invoice';
    IF v_src IS NULL THEN RAISE EXCEPTION 'لم أجد bot_get_booking_invoice'; END IF;

    IF position('taki_buyer_note' in v_src) > 0 THEN
        RAISE NOTICE 'مرقَّعةٌ أصلاً — لا تعديل.';
        RETURN;
    END IF;

    SELECT m[1] INTO v_old FROM regexp_matches(v_src, '(v_buyer_note\s*:=[^;]+;)', 'g') AS m LIMIT 1;
    IF v_old IS NULL THEN
        RAISE EXCEPTION 'لم أجد إسنادَ v_buyer_note — لم أُعدّل شيئاً';
    END IF;

    v_new := replace(v_src, v_old, 'v_buyer_note := public.taki_buyer_note(v_b.notes);');
    IF v_new = v_src THEN RAISE EXCEPTION 'الاستبدالُ لم يقع'; END IF;
    EXECUTE v_new;
END
$patch$;

-- ── التحقّق: على الصيغ الثلاث **وعلى الصفوف الحيّة** ─────────────────────
DO $verify$
DECLARE
    v_a text := E'📦 تفاصيل الطلب:\n• طفل كبير ×1 (80 ر.س)\n\n📝 سوف ناتي خلال ساعه\n💰 الإجمالي: 80 ر.س';
    v_b text := E'📦 تفاصيل الطلب:\n• علم صغير ×1 (20 ر.س)\n💰 الإجمالي: 20 ر.س';
    v_c text := 'اريد الحليب حرارتها وسط ';
    v_n   int;
    v_src text;
BEGIN
    IF public.taki_buyer_note(v_a) IS DISTINCT FROM 'سوف ناتي خلال ساعه' THEN
        RAISE EXCEPTION '(أ) المركَّبةُ بملاحظة: [%]', public.taki_buyer_note(v_a);
    END IF;
    IF public.taki_buyer_note(v_b) IS NOT NULL THEN
        RAISE EXCEPTION '(ب) المركَّبةُ بلا ملاحظةٍ أعادت [%] — وتفاصيلُ الطلب ليست ملاحظةَ مشترٍ',
            public.taki_buyer_note(v_b);
    END IF;
    IF public.taki_buyer_note(v_c) IS DISTINCT FROM 'اريد الحليب حرارتها وسط' THEN
        RAISE EXCEPTION '(ج) النصُّ الخامّ: [%]', public.taki_buyer_note(v_c);
    END IF;
    IF public.taki_buyer_note('   ') IS NOT NULL OR public.taki_buyer_note(NULL) IS NOT NULL THEN
        RAISE EXCEPTION 'الفراغُ يجب أن يكون NULL';
    END IF;

    -- 🔴 وعلى **الصفوف الحيّة**. 🪤 وتصحيحُ تقديرٍ لي: ظننتُ أن ٦٠ من ٦١
    --    ملاحظةً كانت تسقط، فكتبتُ عتبةَ ٥٠ — فأفشلها القياس. والحقيقة:
    --    من ٦١ صفّاً ذي نصّ، **٤١ تفاصيلُ طلبٍ كتبها النظام** (📦/📏/🧩)
    --    واستبعادُها صواب، و**٢٠ ملاحظةٌ حقيقيّةٌ للمشتري** كان يُطبع منها
    --    **واحدة**. فالعتبةُ تُشتقّ من القياس لا من الظنّ.
    SELECT count(*) INTO v_n FROM public.bookings
     WHERE public.taki_buyer_note(notes) IS NOT NULL;
    IF v_n < 20 THEN
        RAISE EXCEPTION 'الصفوفُ ذاتُ الملاحظة الحقيقيّة = % والمقيسُ ٢٠', v_n;
    END IF;

    -- 🔴 وثابتٌ أقوى من عدّ: **كلُّ** صفٍّ بلا علاماتِ نظامٍ يُعيد نصَّه كاملاً
    --    مُشذَّباً. فلو ضاق النمطُ يوماً على صيغةٍ جديدةٍ لصرخ هنا.
    IF EXISTS (
        SELECT 1 FROM public.bookings
         WHERE COALESCE(btrim(notes), '') <> ''
           AND notes !~ '[📦📏💰📝🧩]'
           AND public.taki_buyer_note(notes) IS DISTINCT FROM btrim(notes)
    ) THEN
        RAISE EXCEPTION 'صفٌّ خامٌّ لم يُعَد نصُّه كاملاً — المشتري كتب ولم يصل';
    END IF;
    -- ولا تتسرّب تفاصيلُ الطلب بوصفها ملاحظة
    IF EXISTS (SELECT 1 FROM public.bookings WHERE public.taki_buyer_note(notes) ~ '[📦📏💰]') THEN
        RAISE EXCEPTION 'تسرّبت تفاصيلُ الطلب إلى حقل ملاحظة المشتري';
    END IF;

    -- وفاتورةُ البوت تنادي القاعدةَ الواحدة
    SELECT pg_get_functiondef(p.oid) INTO v_src
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'bot_get_booking_invoice';
    IF position('taki_buyer_note' in v_src) = 0 THEN
        RAISE EXCEPTION 'فاتورةُ البوت ما زالت على نسختها الخاصّة';
    END IF;
    IF v_src ~ '📝\\\\s\*\(' THEN
        RAISE EXCEPTION 'بقي النمطُ القديمُ إلى جانب الجديد';
    END IF;

    RAISE NOTICE '✅ ملاحظةُ المشتري: الصيغُ الثلاثُ · % صفّاً حيّاً · والبوتُ على القاعدة الواحدة.', v_n;
END
$verify$;
