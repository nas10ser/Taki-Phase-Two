-- ═══════════════════════════════════════════════════════════════════════════
-- v16.20 — صفحةُ المتجر في نداءٍ واحد
-- ═══════════════════════════════════════════════════════════════════════════
-- أمرُ ناصر: «أكمل بصفحة المتجر والـ٤٠ كيلوبايت».
--
-- المقيسُ على الإنتاج (١٣ نوفمبر ٢٠٢٦، فتحٌ **مباشر** لا تنقّلٌ داخليّ):
-- `/store/<id>` تُطلق **١٩ نداءً**. سبعةٌ منها عن **نفس المتجر**:
--     users?select=*  ·  sellers_public(ثانيةً)  ·  store_is_verified
--     store_policies  ·  store_follower_count    ·  store_branches
--     store_profiles?select=max_branches
--
-- 🔴 وأغربُها مقيس: `users?select=*` تعود **`[]` لكلّ زائر** — لأن RLS على
--    `users` تحصرها في صفّك أو الأدمن. أي جولةُ شبكةٍ كاملةٌ تُهدر في كلّ
--    فتحةٍ لصفحةِ متجرٍ من كلّ زائر، ولا تُرجع بايتاً واحداً مفيداً.
--    (وللمالك تُرجع صفَّه — فالحاجةُ قائمةٌ له وحده.)
--
-- ── الأمان: نفسُ سطحِ اليوم بالضبط، لا أوسع ──────────────────────────────
-- `SECURITY INVOKER` ⇒ كلُّ قراءةٍ هنا تمرّ بـRLS **وبمنحِ الأعمدة** على
-- المنادي حرفياً. فما تُعيده هذه الدالّة **مجموعةٌ جزئيّةٌ مما يستطيع
-- المنادي جلبَه الآن بسبعة نداءات** — لا أكثر. وأعمدةُ `users` مقصورةٌ على
-- ما تعرضه الصفحةُ فعلاً (الموقعُ والعنوان)، لا `to_jsonb(u)` كاملاً.
-- 🪤 و`store_profiles` ممنوحةٌ لـ`anon` **بالأعمدة لا بالجدول** (قِيس:
--    `select=*` تردّ 42501 و`select=max_branches` تردّ القيمة). فلا يُقرأ
--    منها هنا إلّا `max_branches` — وإلّا انفجرت الدالّةُ عند كلّ زائر.
-- ═══════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF COALESCE(obj_description('public'::regnamespace, 'pg_namespace'), '')
       LIKE 'TAKI_LAB_TOKYO_MARKER%' THEN
    RAISE EXCEPTION 'هذه هجرةُ إنتاج — ورُفضت لأنها تُنفَّذ على المختبر (طوكيو).';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.taki_store_page(p_store_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
    v_owner_me boolean := (auth.uid()::text IS NOT NULL AND auth.uid()::text = p_store_id);
    v_cap      int;
    v_branches jsonb;
BEGIN
    IF COALESCE(p_store_id, '') = '' THEN
        RETURN jsonb_build_object('store', NULL);
    END IF;

    -- سقفُ الباقة: العمودُ الوحيدُ الممنوح لـanon من هذا الجدول.
    SELECT sp.max_branches INTO v_cap
      FROM public.store_profiles sp WHERE sp.store_id = p_store_id;

    -- الفروع: المالكُ يرى كلَّ النشط (يبدّل المعروضَ منها)، والزائرُ يرى
    -- المعروضَ مسقوفاً بالباقة — نفسُ `listByMerchant` / `listDisplayed`.
    IF v_owner_me THEN
        SELECT COALESCE(jsonb_agg(to_jsonb(b) ORDER BY b.created_at ASC), '[]'::jsonb)
          INTO v_branches
          FROM public.store_branches b
         WHERE b.merchant_id = p_store_id AND b.is_active = true;
    ELSE
        -- 🔴 **ولا قَصَّ بالسقف هنا — وهذا مقيسٌ لا إهمال.** كتبتُه أوّلاً
        --    (`x.rn <= v_cap`) نقلاً عن `listDisplayed` في الواجهة، ثمّ
        --    جرّبتُ أن أُنتج الحالةَ التي يُفترض أن يحرسها — أن يتجاوز
        --    المعروضُ السقفَ — **فرفضتها القاعدةُ نفسُها**:
        --        UPDATE store_branches SET show_on_store_page = true …
        --        ⇒ ERROR: BRANCH_DISPLAY_CAP:3
        --    (المشغّلان `tg_enforce_branch_display_cap` على الفروع و
        --     `tg_branch_display_on_plan_change` على الباقة.) فالحالةُ
        --    **مستحيلةٌ بنيوياً**، والبندُ فرعٌ لا يُنفَّذ أبداً — وفرعٌ
        --    لا يُختبر هو عينُ ما نرفضه. والسقفُ يُعاد في الحمولة ليستعمله
        --    المالكُ في شاشته، لا ليُرشّح هنا.
        SELECT COALESCE(jsonb_agg(to_jsonb(b)
                   ORDER BY b.is_primary DESC, b.created_at ASC), '[]'::jsonb)
          INTO v_branches
          FROM public.store_branches b
         WHERE b.merchant_id = p_store_id
           AND b.show_on_store_page = true AND b.is_active = true;
    END IF;

    RETURN jsonb_build_object(
        'is_owner',     v_owner_me,
        'store',        (SELECT to_jsonb(s) FROM public.sellers_public s WHERE s.id = p_store_id),
        -- 🪤 أعمدةٌ بعينها لا `*`: الصفحةُ تعرض الموقعَ والعنوان وحدهما،
        --    و`users` تحمل ما لا يخصّ هذه الشاشة إطلاقاً.
        'owner',        (SELECT jsonb_build_object(
                             'id', u.id, 'name', u.name, 'shop', u.shop,
                             'lat', u.lat, 'lng', u.lng,
                             'google_maps_link', u.google_maps_link,
                             'address', u.address)
                           FROM public.users u WHERE u.id = p_store_id),
        'verified',     COALESCE(public.store_is_verified(p_store_id), false),
        'policies',     public.store_policies(p_store_id),
        'followers',    COALESCE(public.store_follower_count(p_store_id), 0),
        'branches',     v_branches,
        'max_branches', v_cap
    );
END
$fn$;

REVOKE ALL ON FUNCTION public.taki_store_page(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.taki_store_page(text) TO anon, authenticated, service_role;

-- ── التحقّق ──────────────────────────────────────────────────────────────
DO $verify$
DECLARE
    v_sid    text;
    v_p      jsonb;
    v_k      text;
    v_direct int;
    v_want   jsonb;
    v_got    jsonb;
    v_err    text;
BEGIN
    SELECT u.id INTO v_sid FROM public.users u
     WHERE u.user_type IN ('seller','admin')
       AND EXISTS (SELECT 1 FROM public.deals d WHERE d.store_id = u.id)
     ORDER BY u.id LIMIT 1;
    IF v_sid IS NULL THEN
        RAISE EXCEPTION 'لا متجرَ له عروضٌ — لا يمكن إثباتُ الحزمة';
    END IF;

    -- (أ) الشكلُ كامل
    v_p := public.taki_store_page(v_sid);
    FOREACH v_k IN ARRAY ARRAY['is_owner','store','owner','verified','policies','followers','branches','max_branches'] LOOP
        IF NOT (v_p ? v_k) THEN RAISE EXCEPTION 'الحمولةُ بلا المفتاح %', v_k; END IF;
    END LOOP;
    IF jsonb_typeof(v_p->'branches') <> 'array' THEN
        RAISE EXCEPTION 'الفروعُ ليست مصفوفة بل %', jsonb_typeof(v_p->'branches');
    END IF;

    -- (ب) 🔴 كلُّ قيمةٍ تطابق مصدرَها المباشر — لا «موجودة» بل **مطابقة**
    IF (v_p->>'verified')::boolean IS DISTINCT FROM COALESCE(public.store_is_verified(v_sid), false) THEN
        RAISE EXCEPTION 'التوثيقُ انحرف عن store_is_verified';
    END IF;
    IF (v_p->'policies') IS DISTINCT FROM public.store_policies(v_sid) THEN
        RAISE EXCEPTION 'السياسةُ انحرفت عن store_policies';
    END IF;
    IF (v_p->>'followers')::int IS DISTINCT FROM COALESCE(public.store_follower_count(v_sid), 0) THEN
        RAISE EXCEPTION 'عددُ المتابعين انحرف عن store_follower_count';
    END IF;
    IF (v_p->'store') IS DISTINCT FROM (SELECT to_jsonb(s) FROM public.sellers_public s WHERE s.id = v_sid) THEN
        RAISE EXCEPTION 'صفُّ المتجر انحرف عن sellers_public';
    END IF;

    -- (ج) 🔴 **نطاقُ الزائر — بالهويّة لا بالعدد.**
    --     أوّلُ صيغةٍ كتبتُها قارنت **العدد** وحده، فمرّت كسرتان:
    --     ① نزعُ ترشيح `show_on_store_page` ⇒ تدخل خمسةُ فروعٍ بدل ثلاثة،
    --        ثمّ **يقصّها السقفُ إلى ثلاثة** فيبقى العددُ كما هو — والزائرُ
    --        يرى فرعين لم يُرِد التاجرُ إظهارَهما. عدٌّ سليمٌ وهويّةٌ خاطئة.
    --     ② وإهمالُ السقف لا يظهر أصلاً حين يكون المعروضُ ≤ السقف.
    --     ⇒ تُقارن **قائمةُ المعرّفات مرتَّبةً**، ويُضيَّق السقفُ عمداً.
    SET LOCAL ROLE anon;
    v_p := public.taki_store_page(v_sid);
    RESET ROLE;
    IF (v_p->>'is_owner')::boolean THEN
        RAISE EXCEPTION 'الزائرُ حُسب مالكاً';
    END IF;
    IF v_p->'owner' IS DISTINCT FROM 'null'::jsonb THEN
        RAISE EXCEPTION 'الزائرُ استلم صفَّ users — وRLS تمنعه اليوم';
    END IF;

    SELECT COALESCE(jsonb_agg(x.id ORDER BY x.rn), '[]'::jsonb) INTO v_want
      FROM (
        SELECT b.id, row_number() OVER (ORDER BY b.is_primary DESC, b.created_at ASC) AS rn
          FROM public.store_branches b
         WHERE b.merchant_id = v_sid AND b.show_on_store_page = true AND b.is_active = true
      ) x
     WHERE (SELECT sp.max_branches FROM public.store_profiles sp WHERE sp.store_id = v_sid) IS NULL
        OR x.rn <= (SELECT sp.max_branches FROM public.store_profiles sp WHERE sp.store_id = v_sid);
    SELECT COALESCE(jsonb_agg(e->>'id'), '[]'::jsonb) INTO v_got
      FROM jsonb_array_elements(v_p->'branches') e;
    IF v_got IS DISTINCT FROM v_want THEN
        RAISE EXCEPTION 'فروعُ الزائر انحرفت: % مقابل المتوقَّع %', v_got, v_want;
    END IF;

    -- (ج‑٢) 🔴 **الافتراضُ الذي بُني عليه الحذفُ يُفحص هو.**
    --       أُسقط قَصُّ السقف لأن القاعدةَ تمنع تجاوزَه. فلو زال ذلك
    --       المشغّلُ يوماً صار الزائرُ يرى فروعاً فوق باقة التاجر بلا أن
    --       يصرخ شيء. هذا الفحصُ يصرخ: يحاول إنتاجَ الحالة المستحيلة
    --       ويشترط أن **تُرفض** — وبالرمز المقصود لا بأيّ خطأ.
    BEGIN
        v_err := '';
        BEGIN
            UPDATE public.store_branches SET show_on_store_page = true
             WHERE merchant_id = v_sid AND is_active = true;
        EXCEPTION WHEN OTHERS THEN
            GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        END;
        IF v_err NOT LIKE 'BRANCH_DISPLAY_CAP%' THEN
            RAISE EXCEPTION 'القاعدةُ لم تعد تمنع تجاوزَ سقف العرض (%) — أعِد قَصَّ السقف في taki_store_page',
                COALESCE(NULLIF(v_err, ''), 'قُبل التعديل بلا رفض');
        END IF;
        RAISE EXCEPTION 'TAKI_PROBE_ROLLBACK';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'TAKI_PROBE_ROLLBACK' THEN RAISE; END IF;
    END;

    -- (ج‑٣) 🔴 **ومسارُ المالك يُقاس بانتحالِ هويّته.** بلا ذلك لا تُنفَّذ
    --       نصفُ الدالّة إطلاقاً: جلسةُ الهجرة بلا `auth.uid()` فهي «زائر»
    --       دائماً — ومرّت كسرةُ «المالكُ يُحسب زائراً» خضراء.
    BEGIN
        PERFORM set_config('request.jwt.claims',
            json_build_object('sub', v_sid, 'role', 'authenticated')::text, true);
        v_p := public.taki_store_page(v_sid);
        PERFORM set_config('request.jwt.claims', '', true);
        IF NOT (v_p->>'is_owner')::boolean THEN
            RAISE EXCEPTION 'المالكُ حُسب زائراً — ولن يرى فروعَه المخفيّة ولا موقعَه';
        END IF;
        SELECT count(*) INTO v_direct FROM public.store_branches b
         WHERE b.merchant_id = v_sid AND b.is_active = true;
        IF jsonb_array_length(v_p->'branches') <> v_direct THEN
            RAISE EXCEPTION 'المالكُ رأى % فرعاً والنشطُ %',
                jsonb_array_length(v_p->'branches'), v_direct;
        END IF;
        -- 🔴 **وصفُّ المالك مقصورٌ على ما تعرضه الشاشة، لا `to_jsonb(u)`.**
        --    كُشف بكسرة: استبدلتُ البناءَ المحدَّد بالصفّ كاملاً فمرّ الفحصُ
        --    أخضر — لأنه كان يتحقّق من الزائر وحده (الذي تحجبه RLS أصلاً)
        --    ولا يقول شيئاً عن المالك. و`users` تحمل `telegram_link_otp`
        --    و`consent_ip` و`delivery_address` — لا شأنَ لصفحة المتجر بها،
        --    وإرسالُها إلى المتصفّح توسيعُ سطحٍ بلا سبب.
        SELECT COALESCE(jsonb_agg(k ORDER BY k), '[]'::jsonb) INTO v_got
          FROM jsonb_object_keys(v_p->'owner') k;
        IF v_got IS DISTINCT FROM
           '["address","google_maps_link","id","lat","lng","name","shop"]'::jsonb THEN
            RAISE EXCEPTION 'مفاتيحُ صفّ المالك انحرفت عن العقد: %', v_got;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        PERFORM set_config('request.jwt.claims', '', true);
        RAISE;
    END;

    -- (د) الأمان: INVOKER — وإلّا تجاوزت RLS وأعطت الزائرَ صفَّ المالك
    IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname = 'public' AND p.proname = 'taki_store_page' AND p.prosecdef) THEN
        RAISE EXCEPTION 'taki_store_page يجب أن تكون SECURITY INVOKER';
    END IF;

    -- (هـ) ولا يُقرأ من `store_profiles` إلّا العمودُ الممنوح لـanon
    IF EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'taki_store_page'
           AND regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g')
               ~ 'store_profiles[^;]*\*') THEN
        RAISE EXCEPTION 'قراءةُ * من store_profiles تنفجر عند كلّ زائر (منحُ أعمدةٍ لا جدول)';
    END IF;

    RAISE NOTICE '✅ taki_store_page: الشكلُ والتطابقُ ونطاقُ الزائر والأمان — كلُّها مقيسة.';
END
$verify$;
