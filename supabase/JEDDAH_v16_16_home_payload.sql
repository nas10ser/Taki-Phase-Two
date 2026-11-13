-- ═══════════════════════════════════════════════════════════════════════════
-- v16.16 — حمولةُ الصفحة الرئيسية في نداءٍ واحد
-- ═══════════════════════════════════════════════════════════════════════════
-- بلاغُ ناصر: «الموقع ثقيل والتنقّل ثقيل، وأريده أسرع شيءٍ لملايين المستخدمين».
--
-- المقيسُ على الإنتاج (١٢ نوفمبر ٢٠٢٦): فتحةُ الرئيسية تُطلق **١٩ نداءً**،
-- منها **ستّةٌ** لبناء ما فوق الشبكة وحده: أربعةُ أشرطةٍ (`browse_deals`)
-- والبنراتُ والمسابقات. وكلُّ شريطٍ قد يُطلق **ثلاثَ** جولاتٍ متتابعة حين
-- يكون للمستخدم مدينة (مدينته ← منطقته ← المملكة)، أي حتّى **اثنتي عشرة
-- جولةَ شبكةٍ متتابعة** قبل أن تكتمل الصفحة. وعلى شبكة الجوّال (٣٠٠ م.ث
-- للجولة) هذه ثلاثُ ثوانٍ انتظارٍ صافية.
--
-- ⇒ هذه الدالّة تنقل **الحلقةَ نفسَها** إلى الخادم: نفسُ التوسّع، ونفسُ
--   الاستبعاد، ونفسُ الترتيب — لكن بلا جولةِ شبكةٍ بينها. فجولةٌ واحدة.
--
-- 🔴 وأهمُّ قرارٍ أمنيٍّ هنا: **لا منطقَ جديداً ولا امتيازَ جديد.**
--   · `SECURITY INVOKER` ⇒ RLS تُطبَّق على المنادي حرفياً كما اليوم.
--   · وتنادي `public.browse_deals` نفسَها — لا نسخةً منها. فلا انحرافَ
--     ممكنٌ بين ما تراه الرئيسيةُ وما تراه بقيّةُ الشاشات (درسُ v15.00:
--     «النسخةُ الثانية تنحرف»).
--   · والبنراتُ والمسابقاتُ تُقرأ بنفس الاستعلام الذي يرسله المتصفّح اليوم
--     (`is_active` + `position` · وكلُّ المسابقات مرتّبةً تنازلياً)، فما
--     تُعيده هذه الدالّة **لا يزيد بايتاً واحداً** عمّا يستطيع الزائرُ
--     جلبَه الآن بستّة نداءات.
--
-- 🪤 ولا يُضمّ هنا `sponsors` ولا `platform_settings`: مصدرُهما `AppContext`
--    لا الصفحةُ، فضمُّهما يُضيف نسخةً ثانيةً ولا يُسقط نداءً.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── حارسٌ يرفض المختبر ────────────────────────────────────────────────────
DO $guard$
BEGIN
  IF COALESCE(obj_description('public'::regnamespace, 'pg_namespace'), '')
       LIKE 'TAKI_LAB_TOKYO_MARKER%' THEN
    RAISE EXCEPTION 'هذه هجرةُ إنتاج — ورُفضت لأنها تُنفَّذ على المختبر (طوكيو). الهدفُ خادمُ جدة.';
  END IF;
  RAISE NOTICE 'الخادم: % · القاعدة: %', inet_server_addr(), current_database();
END
$guard$;

-- ── ① شريطٌ واحد: التوسّعُ التدريجيُّ على الخادم ──────────────────────────
-- توأمُ `useDealRail` في الواجهة حرفاً بحرف: مدينةٌ ← منطقةٌ ← المملكة،
-- ويتوقّف متى امتلأ، ويستبعد ما ظهر. و`p_expand=false` تعني «التزم بما
-- اختاره المستخدم صراحةً ولا توسّع».
CREATE OR REPLACE FUNCTION public.taki_home_rail(
    p_sort      text,
    p_mode      text,
    p_limit     int,
    p_city      text    DEFAULT NULL,
    p_region    text    DEFAULT NULL,
    p_expand    boolean DEFAULT true,
    p_mall      text    DEFAULT NULL,
    p_season_id text    DEFAULT NULL,
    p_blocked   text[]  DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
    v_acc    jsonb := '[]'::jsonb;
    v_seen   text[] := ARRAY[]::text[];
    v_scopes jsonb;
    v_scope  jsonb;
    v_res    jsonb;
    v_row    jsonb;
    v_id     text;
    v_need   int;
BEGIN
    IF p_limit IS NULL OR p_limit < 1 THEN RETURN v_acc; END IF;

    IF p_expand IS FALSE THEN
        v_scopes := jsonb_build_array(jsonb_build_object('city', p_city, 'region', p_region));
    ELSE
        v_scopes := '[]'::jsonb;
        IF COALESCE(p_city, '')   <> '' THEN
            v_scopes := v_scopes || jsonb_build_array(jsonb_build_object('city', p_city));
        END IF;
        IF COALESCE(p_region, '') <> '' THEN
            v_scopes := v_scopes || jsonb_build_array(jsonb_build_object('region', p_region));
        END IF;
        v_scopes := v_scopes || jsonb_build_array('{}'::jsonb);
    END IF;

    FOR v_scope IN SELECT * FROM jsonb_array_elements(v_scopes) LOOP
        v_need := p_limit - jsonb_array_length(v_acc);
        EXIT WHEN v_need <= 0;

        v_res := public.browse_deals(
            p_region      := NULLIF(v_scope->>'region', ''),
            p_city        := NULLIF(v_scope->>'city', ''),
            p_mall        := NULLIF(p_mall, ''),
            p_season_id   := NULLIF(p_season_id, ''),
            p_sort        := COALESCE(p_sort, 'new'),
            p_mode        := COALESCE(p_mode, 'live'),
            p_limit       := v_need,
            p_blocked     := p_blocked,
            p_exclude_ids := CASE WHEN array_length(v_seen, 1) > 0 THEN v_seen ELSE NULL END
        );

        FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(v_res->'rows', '[]'::jsonb)) LOOP
            v_id := v_row->>'id';
            CONTINUE WHEN v_id IS NULL OR v_id = ANY(v_seen);
            v_seen := v_seen || v_id;
            v_acc  := v_acc || jsonb_build_array(v_row);
        END LOOP;
    END LOOP;

    RETURN v_acc;
END
$fn$;

-- ── ② الحمولةُ كاملةً ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.taki_home_payload(
    p_city         text    DEFAULT NULL,
    p_region       text    DEFAULT NULL,
    p_expand       boolean DEFAULT true,
    p_mall         text    DEFAULT NULL,
    p_season_id    text    DEFAULT NULL,
    p_blocked      text[]  DEFAULT NULL,
    p_rail_limit   int     DEFAULT 8,
    p_season_limit int     DEFAULT 12
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
    v_rail_limit   int := LEAST(GREATEST(COALESCE(p_rail_limit, 8), 1), 24);
    v_season_limit int := LEAST(GREATEST(COALESCE(p_season_limit, 12), 1), 24);
BEGIN
    RETURN jsonb_build_object(
        'trending', public.taki_home_rail('reliability', 'live', v_rail_limit,
                        p_city, p_region, p_expand, p_mall, NULL, p_blocked),
        'discount', public.taki_home_rail('discount', 'live', v_rail_limit,
                        p_city, p_region, p_expand, p_mall, NULL, p_blocked),
        -- الموسمُ لا يُسأل إلّا إن كان هناك موسمٌ أصلاً (استعلامٌ موفَّر).
        'season',   CASE WHEN COALESCE(p_season_id, '') = '' THEN '[]'::jsonb
                         ELSE public.taki_home_rail('discount', 'live', v_season_limit,
                                p_city, p_region, p_expand, p_mall, p_season_id, p_blocked) END,
        'coming',   public.taki_home_rail('soon', 'coming_soon', v_season_limit,
                        p_city, p_region, p_expand, p_mall, NULL, p_blocked),
        'banners',  COALESCE((
                        SELECT jsonb_agg(to_jsonb(b) ORDER BY b.display_order ASC NULLS LAST)
                        FROM public.banners b
                        WHERE b.is_active = true AND b.position = 'home_top'
                    ), '[]'::jsonb),
        'contests', COALESCE((
                        SELECT jsonb_agg(to_jsonb(c) ORDER BY c.created_at DESC)
                        FROM public.contests c
                    ), '[]'::jsonb)
    );
END
$fn$;

-- ── ③ الصلاحيات: نفسُ سطح `browse_deals` بالضبط، لا أوسع ─────────────────
REVOKE ALL ON FUNCTION public.taki_home_rail(text,text,int,text,text,boolean,text,text,text[])    FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_home_payload(text,text,boolean,text,text,text[],int,int)       FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.taki_home_rail(text,text,int,text,text,boolean,text,text,text[]) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.taki_home_payload(text,text,boolean,text,text,text[],int,int)    TO anon, authenticated, service_role;

-- ── ④ التحقّق: كتلةٌ ترفع استثناءً، لا جدولُ ✅/❌ ────────────────────────
DO $verify$
DECLARE
    v_payload jsonb;
    v_rail    jsonb;
    v_direct  jsonb;
    v_k       text;
    v_region  text;
    v_n       int;
    v_total   int;
    v_cap     int;
    v_city    text;
BEGIN
    -- (أ) الشكلُ كاملٌ وكلُّ مفتاحٍ مصفوفة
    v_payload := public.taki_home_payload();
    FOREACH v_k IN ARRAY ARRAY['trending','discount','season','coming','banners','contests'] LOOP
        IF v_payload->v_k IS NULL THEN
            RAISE EXCEPTION 'الحمولةُ بلا المفتاح %', v_k;
        END IF;
        IF jsonb_typeof(v_payload->v_k) <> 'array' THEN
            RAISE EXCEPTION 'المفتاح % ليس مصفوفة بل %', v_k, jsonb_typeof(v_payload->v_k);
        END IF;
    END LOOP;

    -- (ب) الشريطُ يطابق `browse_deals` المباشرة حرفاً بحرف (بلا نطاق)
    v_rail   := public.taki_home_rail('discount', 'live', 8);
    v_direct := COALESCE(public.browse_deals(p_sort := 'discount', p_mode := 'live', p_limit := 8)->'rows', '[]'::jsonb);
    IF v_rail <> v_direct THEN
        RAISE EXCEPTION 'الشريطُ انحرف عن browse_deals: % صفّاً مقابل %',
            jsonb_array_length(v_rail), jsonb_array_length(v_direct);
    END IF;

    -- (ج) 🔴 **التوسّعُ عبر نطاقين، لا نطاقٍ واحد — والمرجعُ `browse_deals`
    --     نفسُها لا جدولُ `deals`.**
    --     خطآن وقعا هنا قبل الاعتماد، وكلاهما أمسكه التشغيلُ الجافّ:
    --     ① كتبتُ الفحصَ أوّلاً على نداءٍ **بلا نطاق**، فالحلقةُ خطوةٌ واحدة
    --        ولا يمكن للسقف أن يُتجاوَز أصلاً ⇒ مرّت كسرةُ «لا تخصم ما جُمع»
    --        خضراء. الفحصُ العقيمُ أسوأ من لا فحص.
    --     ② ثمّ قِستُ «الكلّ» بـ`count(*) WHERE status='active'` (ستّة)
    --        بينما `browse_deals` تُعيد **خمسة** — فيها عرضٌ `sold_out`.
    --        تعريفان لـ«النشط» ⇒ فشلٌ كاذبٌ على كودٍ سليم. المرجعُ الوحيد
    --        هو الدالّةُ التي نقيسها.
    v_direct := COALESCE(public.browse_deals(p_sort := 'discount', p_mode := 'live',
                                             p_limit := 200)->'rows', '[]'::jsonb);
    v_total  := jsonb_array_length(v_direct);
    IF v_total < 2 THEN
        RAISE EXCEPTION 'لا تكفي البياناتُ لإثبات التوسّع (% عرضاً حيّاً) — ولا يُقبل فحصٌ عقيم', v_total;
    END IF;

    -- 🔴 **وتُختار المنطقةُ بأقلِّ عروضٍ حيّة، لا بأوّلِ ما يقع.**
    --     قِيس: منطقةُ آخرِ عرضٍ كانت `eastern` وفيها **٤ من ٥** ⇒ السقفُ
    --     يساوي الكلَّ، فالمخزونُ ينفد قبل أن يفيض أيُّ عطبٍ ⇒ مرّت كسرتان
    --     («لا تخصم ما جُمع» و«لا تتوقّف عند الامتلاء») خضراوَين.
    --     فالشرطُ: منطقةٌ صغيرةٌ **وخلفها فائضٌ لا يقلّ عن عرضين** — وإلّا
    --     فالفحصُ لا يستطيع أن يفشل، ويُرفع استثناءٌ بدل أن يُدَّعى نجاح.
    v_region := NULL;
    v_n      := NULL;
    FOR v_k IN SELECT DISTINCT x->>'region' FROM jsonb_array_elements(v_direct) x
               WHERE COALESCE(x->>'region', '') <> '' LOOP
        v_cap := jsonb_array_length(COALESCE(public.browse_deals(
                     p_region := v_k, p_sort := 'discount', p_mode := 'live',
                     p_limit := 200)->'rows', '[]'::jsonb));
        IF v_n IS NULL OR v_cap < v_n THEN v_region := v_k; v_n := v_cap; END IF;
    END LOOP;
    IF v_region IS NULL OR (v_total - v_n) < 2 THEN
        RAISE EXCEPTION 'لا تكفي البياناتُ لإثبات السقف: أصغرُ منطقةٍ «%» فيها % والكلّ % — يلزم فائضٌ ≥ ٢',
            COALESCE(v_region, '∅'), COALESCE(v_n, 0), v_total;
    END IF;

    -- والآن الادّعاءُ نفسُه: مدينةٌ لا وجودَ لها ⇒ صفر · ثمّ المنطقةُ ⇒ v_n ·
    -- ثمّ المملكةُ تُكمل واحداً. فالطولُ **يساوي** السقفَ تماماً: لا نقصٌ
    -- (توسّعٌ لا يعمل) ولا زيادةٌ (سقفٌ لا يُحترم).
    -- 🪤 وكان هذا السطرُ قد سقط سهواً في تحريرٍ سابق، فبقي الفحصُ يختار
    --    المنطقةَ **ولا يدّعي شيئاً** — ومرّت كسرتان خضراوَين. الفحصُ الذي
    --    لا ادّعاءَ فيه ليس فحصاً.
    v_cap  := v_n + 1;
    v_rail := public.taki_home_rail('discount', 'live', v_cap,
                '__لا_مدينة_بهذا_الاسم__', v_region, true);
    IF jsonb_array_length(v_rail) <> v_cap THEN
        RAISE EXCEPTION 'التوسّعُ عبر النطاقات: % صفّاً والسقفُ % (منطقة=% فيها=% · الكلّ=%)',
            jsonb_array_length(v_rail), v_cap, v_region, v_n, v_total;
    END IF;

    -- (د) 🔴 **ولا يتكرّر عرضٌ بنطاقاتٍ متداخلةٍ حقيقيّة.**
    --     وهذا أيضاً كُتب أوّلاً على نطاقاتٍ **غيرِ متداخلة** فلم يستطع أن
    --     يرى تكراراً: نزعتُ حارسَي الاستبعاد معاً ومرّ أخضر. فالنطاقُ هنا
    --     **مدينةٌ حقيقيّةٌ داخل منطقتها** — كلُّ عرضٍ فيها هو في المنطقة
    --     وفي المملكة، فلا يُنقذ من التكرار إلّا الاستبعادُ نفسُه.
    v_city   := v_direct->0->>'city';
    v_region := v_direct->0->>'region';
    IF COALESCE(v_city, '') = '' OR COALESCE(v_region, '') = '' THEN
        RAISE EXCEPTION 'عرضٌ حيٌّ بلا مدينةٍ أو منطقة — لا يمكن إثباتُ منع التكرار';
    END IF;
    v_rail := public.taki_home_rail('discount', 'live', v_total, v_city, v_region, true);
    IF (SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(v_rail) x)
       <> jsonb_array_length(v_rail) THEN
        RAISE EXCEPTION 'التوسّعُ كرّر عرضاً بين نطاقين متداخلين (مدينة=% منطقة=%)', v_city, v_region;
    END IF;
    IF jsonb_array_length(v_rail) <> v_total THEN
        RAISE EXCEPTION 'التوسّعُ من المدينة إلى المملكة لم يجمع الكلّ: % من %',
            jsonb_array_length(v_rail), v_total;
    END IF;

    -- (هـ) البنراتُ تطابق ما يجلبه المتصفّح اليوم
    IF jsonb_array_length(v_payload->'banners') <>
       (SELECT count(*) FROM public.banners WHERE is_active = true AND position = 'home_top') THEN
        RAISE EXCEPTION 'عددُ البنرات لا يطابق الاستعلامَ المباشر';
    END IF;

    -- (و) الأمانُ: الاثنتان INVOKER — وإلّا تجاوزتا RLS للمنادي
    IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname = 'public'
                 AND p.proname IN ('taki_home_rail','taki_home_payload')
                 AND p.prosecdef) THEN
        RAISE EXCEPTION 'دالّةُ الرئيسية يجب أن تكون SECURITY INVOKER — DEFINER تتجاوز RLS';
    END IF;

    RAISE NOTICE '✅ taki_home_payload: الشكلُ والتطابقُ والسقفُ والأمانُ — كلُّها مقيسة.';
END
$verify$;
