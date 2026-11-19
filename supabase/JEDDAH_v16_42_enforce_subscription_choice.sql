-- ═══════════════════════════════════════════════════════════════════════════
-- v16.42 — إلزامُ الاشتراك: يُوقف النشاط ويترك التاجرَ يختار باقتَه
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 بلاغُ ناصر (١٩ نوفمبر ٢٠٢٦): «عند تفعيل إلزام الاشتراك … يتم تحويل
--    البائعين النشطين للباقة الأولى، والمفروض **يوقف نشاطه ويحوّله لباقة
--    الاشتراكات وهو يختار الباقة المناسبة له**».
--
-- والمقيسُ على جدة قبل الإصلاح — وهو يؤكّد البلاغ حرفاً:
--    `store_profiles`: تاجران على `premium` بمبلغ **٤٩٩٫٩٩** لم يختاراه،
--    وهو ناتجُ زرّ «الدفع للجميع» في لوحة الإدارة.
--
-- 🪤 **ومسارُ انتهاء التجربة كان سليماً أصلاً** (خلافاً لما خُمّن): الوظيفةُ
--    الساعيّة `taki_subscription_maintenance` تفعل الصواب عند الانتهاء —
--    تُجمّد العروض، وتُخفي البانرات، وتُنزّل الخطّة إلى `free` فيختار التاجر.
--    فالعيبُ في **زرّ الإدارة وحده**، لا في دورة حياة الاشتراك.
--    ⇒ هذه الدالّةُ تُطبّق **نفسَ** خطوات تلك الوظيفة فوراً على الجميع، بدل
--      أن تفرض باقةً ومبلغاً. فلا منطقَ ثانٍ ينحرف عن الأوّل.
--
-- 🔴 **ولا يُمسّ حسابُ الإدارة**: `checkSub` في لوحة التاجر تُمرّر الأدمنَ
--    بلا اشتراك («Admins are not paying merchants»)، ومتجرُ تاكي مملوكٌ
--    لحساب أدمن — فتجميدُ عروضه يُطفئ كتالوج المنصّة نفسَه.
--
-- 🪤 وهي عمليّةٌ **هادمة** (تُجمّد عروضاً حيّة)، فتُرجع الأعداد ليعرضها
--    الزرُّ قبل التنفيذ وبعده — ولا تُنفَّذ إلّا بتأكيدٍ صريحٍ من الأدمن.
-- 🪤 و`p_dry_run` يقيس بلا أن يكتب: الأدمنُ يرى كم عرضاً سيتوقّف **قبل** أن
--    يضغط. (وزرٌّ هادمٌ بلا معاينةٍ هو ما أوقع ناصرَ في هذا أصلاً.)
-- ═══════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
    IF COALESCE(obj_description('public'::regnamespace, 'pg_namespace'), '')
       LIKE '%TAKI_LAB_TOKYO_MARKER%' THEN
        RAISE EXCEPTION 'هذه هجرةُ إنتاج — ورُفض تنفيذُها على المختبر (طوكيو).';
    END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.admin_enforce_subscription_choice(p_dry_run boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_frozen  int := 0;
    v_banners int := 0;
    v_reset   int := 0;
    v_stores  int := 0;
BEGIN
    -- الصلاحيةُ أوّلاً: هذه عمليّةٌ تُوقف بيعَ المنصّة كلِّها.
    IF NOT public.taki_admin_perm('tab_sellers') THEN
        RAISE EXCEPTION 'forbidden: sellers permission required';
    END IF;

    -- المستهدَفون: بائعون غيرُ موقوفين، **وليس الأدمن**.
    CREATE TEMP TABLE _targets ON COMMIT DROP AS
    SELECT u.id AS store_id
      FROM public.users u
     WHERE u.user_type = 'seller'
       AND u.deleted_at IS NULL
       AND COALESCE(u.is_suspended, false) = false;

    SELECT count(*) INTO v_stores FROM _targets;

    IF p_dry_run THEN
        SELECT count(*) INTO v_frozen FROM public.deals d
         WHERE d.status = 'active' AND d.store_id IN (SELECT store_id FROM _targets);
        SELECT count(*) INTO v_banners FROM public.banners b
         WHERE b.is_active AND b.store_id IN (SELECT store_id FROM _targets);
        SELECT count(*) INTO v_reset FROM public.store_profiles sp
         WHERE sp.store_id IN (SELECT store_id FROM _targets)
           AND lower(COALESCE(sp.subscription_plan, 'free')) <> 'free';
        RETURN jsonb_build_object('dry_run', true, 'stores', v_stores,
            'deals_to_pause', v_frozen, 'banners_to_hide', v_banners, 'plans_to_reset', v_reset);
    END IF;

    -- (أ) يُوقف النشاط — نفسُ جملة `taki_subscription_maintenance` حرفاً.
    WITH froze AS (
        UPDATE public.deals d
           SET status = 'paused', subscription_frozen = TRUE
         WHERE d.status = 'active'
           AND d.store_id IN (SELECT store_id FROM _targets)
        RETURNING d.id
    ) SELECT count(*) INTO v_frozen FROM froze;

    WITH bfroze AS (
        UPDATE public.banners b
           SET is_active = FALSE, frozen_reason = 'subscription_expired'
         WHERE b.is_active
           AND b.store_id IS NOT NULL
           AND b.store_id IN (SELECT store_id FROM _targets)
        RETURNING b.id
    ) SELECT count(*) INTO v_banners FROM bfroze;

    -- (ب) ويُترك الاختيارُ له: لا باقةَ مفروضةً ولا مبلغ. `free` تعني هنا
    --     «بلا اشتراكٍ نشط» — ومع البوّابة مفعّلةً تظهر له شاشةُ الباقات.
    --     🪤 ولا تُمسّ `max_branches`: هي سقفُ مواقعَ يعود مع الباقة التي
    --        سيختارها، وتصفيرُها يُفقد إعداداتِ فروعه.
    WITH reset AS (
        UPDATE public.store_profiles sp
           SET subscription_plan = 'free',
               subscription_amount = 0,
               subscription_expires_at = NULL,
               updated_at = NOW()
         WHERE sp.store_id IN (SELECT store_id FROM _targets)
           AND lower(COALESCE(sp.subscription_plan, 'free')) <> 'free'
        RETURNING sp.store_id
    ) SELECT count(*) INTO v_reset FROM reset;

    RETURN jsonb_build_object('dry_run', false, 'stores', v_stores,
        'deals_paused', v_frozen, 'banners_hidden', v_banners, 'plans_reset', v_reset);
END $function$;

REVOKE ALL ON FUNCTION public.admin_enforce_subscription_choice(boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_enforce_subscription_choice(boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_enforce_subscription_choice(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_enforce_subscription_choice(boolean) TO service_role;

DO $verify$
DECLARE v_src text; v_acl text;
BEGIN
    SELECT pg_get_functiondef(p.oid), array_to_string(p.proacl, ' | ') INTO v_src, v_acl
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname='admin_enforce_subscription_choice' AND p.prokind='f';
    IF v_src IS NULL THEN RAISE EXCEPTION 'الدالّة غير موجودة'; END IF;

    v_src := regexp_replace(v_src, '--[^\n]*', '', 'g');   -- تجريدُ التعليق قبل الفحص

    IF position('taki_admin_perm' in v_src) = 0 THEN
        RAISE EXCEPTION 'حارسُ الصلاحية غائبٌ عن الجسم';
    END IF;
    IF v_acl IS NOT NULL AND position('anon=' in v_acl) > 0 THEN
        RAISE EXCEPTION 'ممنوحةٌ لـanon — وهي توقف بيع المنصّة: %', v_acl;
    END IF;
    -- 🔴 لا تُفرض باقةٌ ولا مبلغ: هذا هو جوهرُ الإصلاح.
    IF position('''premium''' in v_src) > 0 THEN
        RAISE EXCEPTION 'الدالّةُ تفرض باقةً — والمطلوب أن يختار التاجرُ بنفسه';
    END IF;
    -- 🔴 ولا تمسّ الأدمن: تجميدُ عروضه يُطفئ كتالوج المنصّة.
    IF position('''seller''' in v_src) = 0 THEN
        RAISE EXCEPTION 'المستهدَفون غيرُ محصورين بالبائعين — حسابُ الإدارة سيُجمَّد';
    END IF;
    -- 🔴 والمعاينةُ قائمة: زرٌّ هادمٌ بلا معاينةٍ هو ما أوقع البلاغَ أصلاً.
    IF position('p_dry_run' in v_src) = 0 THEN
        RAISE EXCEPTION 'لا معاينة — الأدمنُ لن يرى كم عرضاً سيتوقّف قبل الضغط';
    END IF;

    RAISE NOTICE '✅ admin_enforce_subscription_choice: بلا باقةٍ مفروضة · البائعون وحدهم · ومعاينةٌ قبل التنفيذ';
END $verify$;
