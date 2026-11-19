-- ════════════════════════════════════════════════════════════════════════════
-- v16.49 — جدولةُ البانر تُطبَّق على **ما يُعرض**، لا على من يسأل
-- ════════════════════════════════════════════════════════════════════════════
-- 🔴 بلاغُ ناصر (١٩ نوفمبر ٢٠٢٦): «وضعتُ تاريخاً وساعةً محدّدة… والآن لا يزال
--    البانر موجوداً رغم أن وقته انتهى».
--
--    وقِيس على الإنتاج قبل كتابةِ سطرٍ واحد: الصفُّ `748b8338-…` نشطٌ،
--    `expires_at = 17:13` والساعةُ `17:58` — **خمسٌ وأربعون دقيقة بعد انتهائه
--    وهو معروض**.
--
--    والسببُ ليس في السياسة ولا في العمود — كلاهما صحيحٌ ويعمل. السببُ أن
--    `banners_select` تحمل إعفاءً للأدمن:
--        (نشطٌ وضمن مدّته) OR taki_admin_perm('action_manage_banners')
--    وهو إعفاءٌ **لازم** لشاشة الإدارة (وإلّا لم يستطع ناصر تحرير بانرٍ لم
--    يبدأ أو انتهى)، لكنّه يسري على **كلّ** استعلامٍ يُجريه الأدمن — ومنها
--    حمولةُ الرئيسية. فناصر وحده كان يرى على رئيسيّته ما لا يراه زائرٌ قطّ.
--
-- ⇒ العلاج: **حمولةُ الرئيسية ترشّح بالمدّة صراحةً** فلا تبقى الرؤيةُ معلّقةً
--   بصلاحيةِ من يسأل. والشاشةُ الإداريّة تقرأ `public.banners` مباشرةً فلا
--   تتأثّر بهذا إطلاقاً — تبقى ترى كلَّ بانرٍ لتُحرّره.
--
-- 🪤 **وتُعاد بناءُ الدالّة من نصّها الحيّ** (`pg_get_functiondef`) باستبدال
--    سطرٍ واحد، لا من نسخةٍ مكتوبةٍ هنا: أيُّ انحرافٍ لحقها منذ v16.16 يبقى.
--    والاستبدالُ **يُثبَت وقوعُه** قبل التنفيذ، وإلّا مرّت الهجرةُ بلا أثر.
-- ════════════════════════════════════════════════════════════════════════════

-- ── ⓪ حارسُ الخادم: لا تُنفَّذ على المختبر (طوكيو) ─────────────────────────
DO $guard$
BEGIN
    IF obj_description('public'::regnamespace, 'pg_namespace')
       = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
        RAISE EXCEPTION 'هذه هجرةُ إنتاج — الخادمُ أمامها هو المختبر (طوكيو). أوقِف.';
    END IF;
END $guard$;

-- ── ① إعادةُ البناء من النصّ الحيّ، باستبدالٍ واحدٍ مُثبَت ─────────────────
DO $patch$
DECLARE
    v_src    text := pg_get_functiondef('public.taki_home_payload'::regproc);
    v_needle text := 'WHERE b.is_active = true AND b.position = ''home_top''';
    v_fix    text := 'WHERE b.is_active = true AND b.position = ''home_top'''
                   || E'\n                          AND (b.starts_at  IS NULL OR b.starts_at  <= now())'
                   || E'\n                          AND (b.expires_at IS NULL OR b.expires_at >  now())';
    v_new    text;
BEGIN
    -- مطبَّقةٌ من قبل؟ لا شيء يُفعل (خاملةُ التكرار).
    IF position('b.expires_at' in v_src) > 0 THEN
        RAISE NOTICE 'ℹ️ حمولةُ الرئيسية ترشّح بالمدّة أصلاً — لا تغيير.';
        RETURN;
    END IF;

    IF position(v_needle in v_src) = 0 THEN
        RAISE EXCEPTION 'لم يُعثر على استعلام البنرات في النصّ الحيّ — توقّف بدل أن تكتب نصّاً مُخمَّناً.';
    END IF;

    v_new := replace(v_src, v_needle, v_fix);
    IF v_new = v_src THEN
        RAISE EXCEPTION 'الاستبدالُ لم يقع — هجرةٌ بلا أثر.';
    END IF;

    EXECUTE v_new;
END $patch$;

-- ── ② التحقّق: بنيويٌّ ثمّ **سلوكيٌّ بانتحال هويّة أدمن حقيقيّ** ───────────
--    🪤 ولا يصحّ التحقّقُ بجلسة `psql` كما هي: `auth.uid()` فيها NULL فلا
--       يكون المنادي أدمن، فتُرشّحه RLS أصلاً ويمرّ الفحصُ **كاذباً**.
--       ولذلك يُثبَّت أوّلاً أن الإعفاءَ حيٌّ (الأدمن يرى الصفَّ المنتهي
--       مباشرةً من الجدول) — وإلّا فالفحصُ التالي لا يُثبت شيئاً.
DO $verify$
DECLARE
    v_src   text := pg_get_functiondef('public.taki_home_payload'::regproc);
    v_admin text;
    v_probe uuid := gen_random_uuid();   -- 🪤 `banners.id` من نوع uuid لا نصّ
    v_seen  int;
    v_perm  boolean;
    v_out   jsonb;
BEGIN
    -- (أ) بنيوياً: الشرطان في نصّ الدالّة
    IF position('b.starts_at' in v_src) = 0 OR position('b.expires_at' in v_src) = 0 THEN
        RAISE EXCEPTION 'نصُّ الدالّة بلا شرطَي المدّة.';
    END IF;

    SELECT id INTO v_admin FROM public.users
     WHERE user_type = 'admin' AND 'action_manage_banners' = ANY(admin_permissions)
     LIMIT 1;
    IF v_admin IS NULL THEN
        RAISE EXCEPTION 'لا أدمن بصلاحية البنرات — لا يمكن إثباتُ الإصلاح.';
    END IF;

    -- بانرٌ **انتهى قبل دقيقة** — بعينه الحالةُ التي أبلغ عنها ناصر
    INSERT INTO public.banners (id, title_ar, title_en, image_url, position,
                                is_active, display_order, starts_at, expires_at)
    VALUES (v_probe, 'فحص المدّة', 'schedule probe',
            'https://api.takisa.net/x.jpg', 'home_top', true, 999,
            now() - interval '2 hours', now() - interval '1 minute');

    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

    -- (ب) 🔴 **إثباتُ أن الفحصَ ليس فارغاً**: الإعفاءُ حيٌّ فعلاً الآن
    SELECT public.taki_admin_perm('action_manage_banners') INTO v_perm;
    IF NOT COALESCE(v_perm, false) THEN
        RESET ROLE;
        RAISE EXCEPTION 'الانتحالُ لم ينجح (المنادي ليس أدمن) — الفحصُ كان سيمرّ كاذباً.';
    END IF;

    SELECT count(*) INTO v_seen FROM public.banners WHERE id = v_probe;
    IF v_seen <> 1 THEN
        RESET ROLE;
        RAISE EXCEPTION 'الأدمنُ لا يرى البانرَ المنتهي من الجدول — فالإعفاءُ غائبٌ والفحصُ أجوف.';
    END IF;

    -- (ج) ومع ذلك: **حمولةُ الرئيسية لا تحمله**
    v_out := public.taki_home_payload();
    RESET ROLE;

    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_out->'banners') e
                WHERE e->>'id' = v_probe::text) THEN
        RAISE EXCEPTION 'بانرٌ منتهٍ ما زال في حمولة الرئيسية للأدمن — الإصلاحُ لم يقع.';
    END IF;

    DELETE FROM public.banners WHERE id = v_probe;

    RAISE NOTICE '✅ v16.49: الأدمنُ يرى البانرَ المنتهيَ في جدوله، ولا يراه على رئيسيّته.';
END $verify$;
