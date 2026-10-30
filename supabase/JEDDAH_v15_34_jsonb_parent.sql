-- ═══════════════════════════════════════════════════════════════════════════
-- v15.34 — `jsonb_set` بمسارٍ مركّب: كتابتان تُرجعان «نجح» ولا تكتبان شيئاً
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 القاعدة: `jsonb_set(x, ARRAY['أب','ابن'], v, true)` تُنشئ **المفتاح
--    الأخير وحده**. فإن غاب الكائنُ الأب `أب` أعادت الدالّةُ `x` كما هو —
--    **بلا خطأ ولا تحذير**. ولا شيء في المنادي يفرّق بين «كُتبت» و«أُهملت».
--
-- وقِيس على الإنتاج (جدّة، ٣٠ أكتوبر ٢٠٢٦) على كلّ عناصر الفروع:
--      عناصر  variantOnHand  variantQtys  variantOff
--        ٥          ٠             ٢            ٠
--    أي أن **مفتاحين لم يُكتبا ولا مرّة واحدة**، وثالثٌ يُكتب لأن أباه يصل
--    من العميل أصلاً.
--
-- ما الذي تعطّل فعلياً:
--   ١) `variantOnHand` = المخزونُ **الكامل** لخليّة «نوع×فرع» (نموذج v15.02).
--      وغيابُه يجعل الشاشةَ ترتدّ إلى `variantQtys` وهو **المتاح**، فكلُّ
--      حفظٍ يُنقص المخزونَ المعلَن بمقدار المحجوز — وهو عينُ العيب الذي
--      بُني v15.02 لسدّه، باقياً على مستوى الخلايا وحدها.
--      🪤 والمسارُ يمرّ بـ`tr_b0_stock_declare` على **كلّ** تعديل عرض.
--   ٢) `variantOff` = مفتاحُ «نفد هذا النوع في هذا الفرع» (v15.07). كان
--      يُرجع `ok:true, level:'variant_at_location'` **ولا يكتب شيئاً** —
--      أي أن الدرجةَ ٠ على أدقّ مستوياتها لم تعمل ولا مرّة منذ شحنها.
--
-- 🪤 والصوابُ كان مكتوباً أصلاً في `_taki_loc_seed`:
--      `v_out := jsonb_set(v_out, '{variantOnHand}', '{}'::jsonb, true);`
--    فالعيبُ ليس جهلاً بالقاعدة بل **نسخةً ناقصة**: كُتب السطرُ في موضعٍ
--    ولم يُنسخ إلى ثلاثة. ⇒ أيُّ كتابةٍ بمسارٍ مركّب تُجرَد في القاعدة كلِّها
--    لا في الدالّة التي بين يديك (ثمانيةُ مواضع هنا).
--
-- 🪤 وبُنيت من **النصّ الحيّ** لا من المستودع.
-- ═══════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر. أوقِفت.';
  END IF;
  IF to_regprocedure('public._taki_loc_declare(text,jsonb)') IS NULL
     OR to_regprocedure('public._taki_loc_on_hand(text,jsonb,jsonb)') IS NULL
     OR to_regprocedure('public._taki_set_off(text,boolean,text,text)') IS NULL THEN
    RAISE EXCEPTION 'إحدى دوال v15.02/15.07 غائبة — الأساسُ مختلف، أوقِفت.';
  END IF;
END
$guard$;

-- ١) الدوالّ الثلاث ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._taki_loc_declare(p_deal_id text, p_el jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_out jsonb := p_el; v_loc text := p_el->>'id'; v_oh int; k text; v int;
BEGIN
  IF (p_el ? 'quantity') AND NULLIF(p_el->>'quantity','') IS NOT NULL THEN
    v_oh := GREATEST(0, (p_el->>'quantity')::int);
    v_out := jsonb_set(v_out, '{onHand}', to_jsonb(v_oh), true);
    v_out := jsonb_set(v_out, '{quantity}',
               to_jsonb(GREATEST(0, v_oh - public.taki_open_holds(p_deal_id, NULL, v_loc))));
  END IF;

  IF (p_el ? 'variantQtys') AND jsonb_typeof(p_el->'variantQtys') = 'object' THEN
      -- 🔴 v15.34 — `jsonb_set` ذو المسار المركّب يُنشئ **المفتاح الأخير وحده**،
      -- فإن غاب الكائنُ الأب أعاد المُدخَلَ كما هو **بلا خطأ**. والقياس: صفرٌ من
      -- خمسة فروعٍ في الإنتاج يحمل `variantOnHand` مقابل اثنين يحملان `variantQtys`.
      -- (والصوابُ مكتوبٌ أصلاً في `_taki_loc_seed` ولم يُنسخ إلى أخواته.)
    IF NOT (v_out ? 'variantOnHand') THEN v_out := jsonb_set(v_out, '{variantOnHand}', '{}'::jsonb, true); END IF;
    FOR k, v IN SELECT key, NULLIF(value #>> '{}','')::int
                  FROM jsonb_each(p_el->'variantQtys') LOOP
      CONTINUE WHEN v IS NULL;
      v_out := jsonb_set(v_out, ARRAY['variantOnHand', k], to_jsonb(GREATEST(0, v)), true);
      v_out := jsonb_set(v_out, ARRAY['variantQtys', k],
                 to_jsonb(GREATEST(0, v - public.taki_open_holds(p_deal_id, k, v_loc))), true);
    END LOOP;
  END IF;

  RETURN v_out;
END
$function$;

CREATE OR REPLACE FUNCTION public._taki_loc_on_hand(p_deal_id text, p_el jsonb, p_inc jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_out jsonb := p_el; v_loc text := p_el->>'id'; v_oh int; k text; v int;
BEGIN
  IF p_inc IS NULL THEN RETURN v_out; END IF;

  IF (p_inc ? 'onHand') AND NULLIF(p_inc->>'onHand','') IS NOT NULL THEN
    v_oh := GREATEST(0, (p_inc->>'onHand')::int);
    v_out := jsonb_set(v_out, '{onHand}', to_jsonb(v_oh));
    v_out := jsonb_set(v_out, '{quantity}',
                       to_jsonb(GREATEST(0, v_oh - public.taki_open_holds(p_deal_id, NULL, v_loc))));
  END IF;

  IF (p_inc ? 'variantOnHand') AND jsonb_typeof(p_inc->'variantOnHand') = 'object' THEN
      -- 🔴 v15.34 — `jsonb_set` ذو المسار المركّب يُنشئ **المفتاح الأخير وحده**،
      -- فإن غاب الكائنُ الأب أعاد المُدخَلَ كما هو **بلا خطأ**. والقياس: صفرٌ من
      -- خمسة فروعٍ في الإنتاج يحمل `variantOnHand` مقابل اثنين يحملان `variantQtys`.
      -- (والصوابُ مكتوبٌ أصلاً في `_taki_loc_seed` ولم يُنسخ إلى أخواته.)
    IF NOT (v_out ? 'variantOnHand') THEN v_out := jsonb_set(v_out, '{variantOnHand}', '{}'::jsonb, true); END IF;
    IF NOT (v_out ? 'variantQtys')   THEN v_out := jsonb_set(v_out, '{variantQtys}',   '{}'::jsonb, true); END IF;
    FOR k, v IN SELECT key, NULLIF(value #>> '{}','')::int
                  FROM jsonb_each(p_inc->'variantOnHand') LOOP
      CONTINUE WHEN v IS NULL;
      v_out := jsonb_set(v_out, ARRAY['variantOnHand', k], to_jsonb(GREATEST(0, v)), true);
      v_out := jsonb_set(v_out, ARRAY['variantQtys', k],
                 to_jsonb(GREATEST(0, v - public.taki_open_holds(p_deal_id, k, v_loc))), true);
    END LOOP;
  END IF;

  RETURN v_out;
END
$function$;

CREATE OR REPLACE FUNCTION public._taki_set_off(p_deal_id text, p_on boolean, p_variant_id text, p_location_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_on boolean := COALESCE(p_on, false); v_new jsonb;
BEGIN
  -- (أ) العرضُ كلُّه
  IF p_variant_id IS NULL AND p_location_id IS NULL THEN
    UPDATE public.deals SET sold_out = v_on WHERE id = p_deal_id;
    RETURN jsonb_build_object('ok', true, 'level', 'deal', 'off', v_on);
  END IF;

  -- (ب) صنفٌ في كلّ الفروع
  IF p_variant_id IS NOT NULL AND p_location_id IS NULL THEN
    UPDATE public.deals d SET variants = (
      SELECT jsonb_agg(CASE WHEN e->>'id' = p_variant_id
                            THEN jsonb_set(e, '{off}', to_jsonb(v_on), true) ELSE e END ORDER BY t.ord)
        FROM jsonb_array_elements(d.variants) WITH ORDINALITY AS t(e, ord))
     WHERE d.id = p_deal_id AND d.variants IS NOT NULL AND jsonb_typeof(d.variants) = 'array';
    RETURN jsonb_build_object('ok', true, 'level', 'variant', 'off', v_on);
  END IF;

  -- (ج) فرعٌ كاملاً، أو (د) صنفٌ داخل فرع
  UPDATE public.deals d SET locations = (
    SELECT jsonb_agg(CASE WHEN e->>'id' <> p_location_id THEN e
                          WHEN p_variant_id IS NULL THEN jsonb_set(e, '{off}', to_jsonb(v_on), true)
                          -- 🔴 v15.34 — نفسُ سهو المسار المركّب: `variantOff` غائبٌ عن
                          -- كلّ عنصرٍ في الإنتاج (صفرٌ من خمسة)، فكان زرُّ «نفد هذا النوع
                          -- في هذا الفرع» يُرجع ok:true ولا يكتب شيئاً **منذ v15.07**.
                          ELSE jsonb_set(CASE WHEN e ? 'variantOff' THEN e
                                              ELSE jsonb_set(e, '{variantOff}', '{}'::jsonb, true) END,
                                         ARRAY['variantOff', p_variant_id], to_jsonb(v_on), true)
                     END ORDER BY t.ord)
      FROM jsonb_array_elements(d.locations) WITH ORDINALITY AS t(e, ord))
   WHERE d.id = p_deal_id AND d.locations IS NOT NULL AND jsonb_typeof(d.locations) = 'array';
  RETURN jsonb_build_object('ok', true,
    'level', CASE WHEN p_variant_id IS NULL THEN 'location' ELSE 'variant_at_location' END, 'off', v_on);
END
$function$;

-- ٢) تعويضُ ما ضاع ─────────────────────────────────────────────────────────
-- 🪤 الكاملُ = المتاحُ المخزَّن + الحجوزاتُ المفتوحة. و`_taki_loc_seed` تحسبه
--    هكذا بالضبط — فتُستعمل هي، لا صيغةٌ ثانيةٌ تنحرف عنها.
-- 🪤 و`set_config(...,true)` **محلّيّةُ المعاملة**، فالتعويضُ داخل معاملةٍ
--    صريحة: بدونها يعود المشغّلُ فيدهس الكاملَ بالمتاح (ناقصاً الحجوزات).
BEGIN;
SELECT set_config('taki.stock_derived', '1', true);
UPDATE public.deals d
   SET locations = (SELECT jsonb_agg(public._taki_loc_seed(d.id, t.e) ORDER BY t.ord)
                      FROM jsonb_array_elements(d.locations) WITH ORDINALITY AS t(e, ord))
 WHERE d.locations IS NOT NULL AND jsonb_typeof(d.locations) = 'array'
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(d.locations) e2
                WHERE (e2 ? 'variantQtys') AND NOT (e2 ? 'variantOnHand'));
COMMIT;

-- ٣) تحقّقٌ سلوكيّ يُفشل الهجرة إن كذبت ──────────────────────────────────────
-- 🪤 ولا يُقبل «لم يُخطئ» دليلاً — يُقاس **وقوعُ الأثر**: مفتاحٌ ظهر، وقيمةٌ
--    تبدّلت. وهذا بالضبط ما كان العيبُ يُخفيه.
BEGIN;
DO $test$
DECLARE el jsonb; out jsonb; v_deal text; v_var text; v_loc text; r jsonb; v_before jsonb; v_after jsonb;
BEGIN
  -- (أ) `_taki_loc_declare` تُنشئ الأبَ الغائب
  el := '{"id":"primary","quantity":7,"variantQtys":{"v1":3,"v2":0}}'::jsonb;
  out := public._taki_loc_declare('__no_such_deal__', el);
  IF NOT (out ? 'variantOnHand') THEN RAISE EXCEPTION '❌ declare: الأبُ لم يُنشأ — الكتابةُ ما زالت صامتة'; END IF;
  IF (out->'variantOnHand'->>'v1') IS DISTINCT FROM '3' THEN RAISE EXCEPTION '❌ declare: قيمةٌ خاطئة %', out->'variantOnHand'; END IF;
  IF (out->'variantOnHand'->>'v2') IS DISTINCT FROM '0' THEN RAISE EXCEPTION '❌ declare: الصفرُ ضاع %', out->'variantOnHand'; END IF;

  -- (ب) حالةٌ موجبة: أبٌ موجودٌ لا يُدهَس
  el := '{"id":"primary","variantQtys":{"v1":5},"variantOnHand":{"v9":99}}'::jsonb;
  out := public._taki_loc_declare('__no_such_deal__', el);
  IF (out->'variantOnHand'->>'v9') IS DISTINCT FROM '99' THEN RAISE EXCEPTION '❌ declare: دهسَ مفتاحاً قائماً %', out->'variantOnHand'; END IF;

  -- (ج) `_taki_loc_on_hand` تُنشئ الأبوين
  out := public._taki_loc_on_hand('__no_such_deal__', '{"id":"primary"}'::jsonb,
                                  '{"variantOnHand":{"v1":4}}'::jsonb);
  IF NOT (out ? 'variantOnHand') OR NOT (out ? 'variantQtys') THEN
    RAISE EXCEPTION '❌ on_hand: أحدُ الأبوين لم يُنشأ — %', out; END IF;

  -- (د) `_taki_set_off` تكتب فعلاً على صنفٍ داخل فرع
  SELECT d.id, e->>'id' INTO v_deal, v_loc
    FROM public.deals d, jsonb_array_elements(d.locations) e
   WHERE d.locations IS NOT NULL AND jsonb_typeof(d.locations)='array' LIMIT 1;
  IF v_deal IS NULL THEN RAISE EXCEPTION '❌ لا عرضَ بفروعٍ للاختبار — الفحصُ لم يُجرَ، وهذا فشل'; END IF;
  v_var := '__probe_variant__';
  SELECT e->'variantOff' INTO v_before FROM public.deals d, jsonb_array_elements(d.locations) e
   WHERE d.id = v_deal AND e->>'id' = v_loc;
  r := public._taki_set_off(v_deal, true, v_var, v_loc);
  SELECT e->'variantOff' INTO v_after FROM public.deals d, jsonb_array_elements(d.locations) e
   WHERE d.id = v_deal AND e->>'id' = v_loc;
  IF (r->>'level') IS DISTINCT FROM 'variant_at_location' THEN RAISE EXCEPTION '❌ set_off: مستوىً خاطئ %', r; END IF;
  IF v_after IS NULL OR (v_after->>v_var) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION '❌ set_off: قال ok:true ولم يكتب — قبل=% بعد=%', coalesce(v_before::text,'∅'), coalesce(v_after::text,'∅'); END IF;

  RAISE NOTICE '✅ مُثبَت: الأبُ يُنشأ ولا يُدهَس · الصفرُ ينجو · والإطفاءُ على صنفٍ داخل فرعٍ يكتب فعلاً';
END
$test$;
ROLLBACK;

-- ٤) جدولُ القراءة ─────────────────────────────────────────────────────────
SELECT 'المختبر؟' AS البند, coalesce(obj_description('public'::regnamespace,'pg_namespace'),'لا — جدّة') AS القيمة
UNION ALL SELECT 'عناصر الفروع', (SELECT count(*)::text FROM public.deals d, jsonb_array_elements(d.locations) e)
UNION ALL SELECT 'منها بـvariantQtys',
  (SELECT count(*)::text FROM public.deals d, jsonb_array_elements(d.locations) e WHERE e ? 'variantQtys')
UNION ALL SELECT 'منها بـvariantOnHand (كان صفراً)',
  (SELECT count(*)::text FROM public.deals d, jsonb_array_elements(d.locations) e WHERE e ? 'variantOnHand')
UNION ALL SELECT 'حارسُ الأب في declare',
  CASE WHEN position('variantOnHand}' IN pg_get_functiondef(to_regprocedure('public._taki_loc_declare(text,jsonb)')::oid)) > 0
       THEN '✅ مشحون' ELSE '❌ غائب' END
UNION ALL SELECT 'حارسُ الأب في set_off',
  CASE WHEN position('variantOff}' IN pg_get_functiondef(to_regprocedure('public._taki_set_off(text,boolean,text,text)')::oid)) > 0
       THEN '✅ مشحون' ELSE '❌ غائب' END;
