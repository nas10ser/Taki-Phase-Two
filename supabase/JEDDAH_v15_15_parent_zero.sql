-- ═══════════════════════════════════════════════════════════════════════════
-- v15.15 — صفرٌ من زد كان سيُصفّر مخزون التاجر
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 العيب، وقد قِيس على القارئ الحيّ لا استُنتج:
--    `taki_stock_webhook` يرفض الكمّية غير الرقمية (`v_qty !~ '^[0-9]+$'`)،
--    فحمولةٌ فيها `quantity: null` تُحفظ «غير مفهومة» ولا تُكتب — وهذا سليم.
--    **لكنّ `0` رقمٌ صحيحٌ شكلاً.** ومنتجُ زد الذي له أصناف
--    (`structure: 'parent'`) يُرسل جذرَ كمّيته **صفراً** والأرقامُ الحقيقية
--    في `variants[].stocks[]` وحدها — فرسالةٌ واحدةٌ من زد كانت تكتب
--    `on_hand = 0` وتُصفّر مخزون ذلك المنتج عند التاجر.
--    (وثيقةُ زد: أمثلتُها تُظهر `structure: parent` مع `quantity: 0` و
--     `stocks: []`.)
--
-- 🪤 ولماذا لم يُمسك بعدُ: لا تطبيقَ شريكاً مسجَّلاً عند زد بعد، فلا رسالةَ
--    وصلت. العيبُ حيٌّ لكنه لم يُستثر — وهذا أرخصُ وقتٍ لإصلاحه.
--
-- والعلاجُ ليس «لا تكتب صفراً»: صفرٌ من نظامٍ آخر قد يعني «نفد» فعلاً وهو
-- صحيح. العلاجُ أن يُعلَم **متى لا يكون جذرُ الرسالة هو الحقيقة** — وذلك
-- شرطٌ يعرفه كلُّ مزوّدٍ عن نفسه، فيُكتب في خريطته: `skip_when`.
-- ═══════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر. أوقِفت.';
  END IF;
  IF to_regprocedure('public.taki_stock_webhook(text,jsonb,text)') IS NULL
     OR to_regprocedure('public._taki_jpath(jsonb,text)') IS NULL THEN
    RAISE EXCEPTION 'v15.12 غير مطبَّقة — أوقِفت.';
  END IF;
END
$guard$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ١) الخريطةُ تقول متى لا يكون جذرُها هو الحقيقة
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._taki_provider_map(p_provider text)
RETURNS jsonb
LANGUAGE sql IMMUTABLE
AS $fn$
  SELECT CASE lower(COALESCE(p_provider, ''))
    -- سلّة: غلافٌ حول المنتج (مؤكَّد من docs.salla.dev/webhook-events/products.md)
    -- 🪤 و`data.quantity` تُحلّ على `product.created` وحده: الأحداثُ الستّة
    --    الحالية لا تحمل كمّيةً إطلاقاً، فتعود الحمولةُ «غير مفهومة» وتُحفظ
    --    — وهو السلوكُ الصحيح، والرقمُ يُقرأ من `GET /products/quantities`.
    WHEN 'salla' THEN '{"id":"data.id","qty":"data.quantity","source":"salla-docs",
                        "skip_when":[{"path":"data.unlimited_quantity","equals":"true"}]}'::jsonb
    -- زد: المنتجُ في الجذر بلا غلاف (مؤكَّد من مخطّط docs.zid.sa المضمّن)
    -- 🔴 و`skip_when` هو جوهرُ v15.15: جذرُ الكمّية صفرٌ **دائماً** لمنتجٍ له
    --    أصناف، والحقيقةُ في `variants[].stocks[]`. فصفرُ الجذر لا يُكتب.
    WHEN 'zid'   THEN '{"id":"id","qty":"quantity","source":"zid-docs",
                        "skip_when":[{"path":"structure","equals":"parent"},
                                     {"path":"has_options","equals":"true"},
                                     {"path":"is_infinite","equals":"true"},
                                     {"path":"is_external_product","equals":"true"}]}'::jsonb
    ELSE NULL END;
$fn$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٢) والقارئ يحترمه — رقعةٌ من النصّ الحيّ
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 من النصّ الحيّ لا بإعادة كتابة: الدالّة تحمل قائمةَ تعلّمٍ من ١١ مرشّحاً
--    ومنطقَ مفتاحٍ وحفظِ حمولة، وإعادةُ كتابتها تدهس ما لا أتذكّره.
DO $patch$
DECLARE src text; src0 text;
BEGIN
  src := pg_get_functiondef('public.taki_stock_webhook(text,jsonb,text)'::regprocedure);
  src0 := src;
  IF position('skip_when' IN src) > 0 THEN
    RAISE NOTICE 'ℹ️ مرقوعةٌ أصلاً.'; RETURN;
  END IF;

  IF position(E'  IF v_id IS NULL OR v_qty IS NULL OR v_qty !~ ''^[0-9]+$'' THEN' IN src) = 0 THEN
    RAISE EXCEPTION '❌ مرساة الفحص الرقميّ غير موجودة — أوقِفت بدل الرقع الأعمى.';
  END IF;

  -- 🔴 يُدرَج **قبل** الفحص الرقميّ: بعده يكون الصفرُ قد مرّ.
  src := replace(src,
    E'  IF v_id IS NULL OR v_qty IS NULL OR v_qty !~ ''^[0-9]+$'' THEN',
    E'  -- v15.15 — هل يقول المزوّدُ إنّ جذرَ رسالته ليس الحقيقة؟\n  --           (زد: منتجٌ له أصناف جذرُ كمّيته صفرٌ دائماً.)\n  IF v_qty IS NOT NULL AND jsonb_typeof(COALESCE(v_map->''skip_when'',''null''::jsonb)) = ''array''\n     AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_map->''skip_when'') c\n                  WHERE lower(COALESCE(public._taki_jpath(p_body, c->>''path''),'''''''')) \n                        = lower(c->>''equals'')) THEN\n    -- يُقلَّد الفرعُ القائم حرفياً: وسمٌ على الاتصال، والحمولةُ محفوظةٌ\n    -- في `last_payload` بمشغّلٍ قائم. ولا جدولَ آخر — `stock_inbox`\n    -- سجلُّ تكرارٍ لا مخزنُ حمولات (قِيس قبل الكتابة).\n    UPDATE public.stock_integrations SET last_note = ''PARENT_OR_UNLIMITED'' WHERE id = v_i.id;\n    RETURN jsonb_build_object(''ok'', true, ''stored'', true, ''unmapped'', true,\n      ''reason'', ''PARENT_OR_UNLIMITED'',\n      ''hint'', ''this product keeps its real stock per variant or per location, not at the root'');\n  END IF;\n  IF v_id IS NULL OR v_qty IS NULL OR v_qty !~ ''^[0-9]+$'' THEN');

  IF src = src0 THEN RAISE EXCEPTION '❌ لم تقع الرقعة.'; END IF;
  EXECUTE src;

  IF position('skip_when' IN pg_get_functiondef('public.taki_stock_webhook(text,jsonb,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '❌ الرقعة لم تُنفَّذ.';
  END IF;
  RAISE NOTICE '✅ القارئ يحترم skip_when.';
END
$patch$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٣) تحقّقٌ سلوكيّ بحمولة زد الموثَّقة نفسها
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE
  v_me text; v_int uuid; v_deal text; v_key text := 'taki_v1515_probe_0123456789abcdef';
  v_oh0 int; v_oh int; r jsonb;
BEGIN
  -- (أ) البنية
  IF position('skip_when' IN pg_get_functiondef('public._taki_provider_map(text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '❌ الخريطةُ بلا skip_when.';
  END IF;
  IF position('structure' IN public._taki_provider_map('zid')::text) = 0 THEN
    RAISE EXCEPTION '❌ خريطةُ زد لا تعرف `structure` — وجذرُ المنتج الأب صفرٌ دائماً.';
  END IF;
  IF position('skip_when' IN pg_get_functiondef('public.taki_stock_webhook(text,jsonb,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '❌ القارئ لا يحترم skip_when.';
  END IF;

  -- (ب) 🔴 قياسٌ سلوكيّ: حمولةُ زد لمنتجٍ له أصناف — جذرُها صفر
  SELECT id INTO v_me FROM public.users
   WHERE user_type IN ('seller','admin') AND deleted_at IS NULL ORDER BY id LIMIT 1;
  SELECT id, on_hand INTO v_deal, v_oh0 FROM public.deals
   WHERE store_id = v_me AND on_hand IS NOT NULL AND on_hand > 0 ORDER BY id LIMIT 1;
  IF v_deal IS NULL THEN RAISE NOTICE 'ℹ️ لا عرضَ صالحٌ للقياس — تخطّي السلوكيّ.'; RETURN; END IF;

  INSERT INTO public.stock_integrations
    (store_id, provider, segment, label, api_key_hash, api_key_last4)
  VALUES (v_me, 'zid', 'ecommerce', 'v1515-verify',
          encode(extensions.digest(v_key,'sha256'),'hex'), right(v_key,4))
  RETURNING id INTO v_int;
  INSERT INTO public.stock_links (integration_id, store_id, deal_id, external_id)
  VALUES (v_int, v_me, v_deal, 'ZID-PARENT-1');

  -- حمولةٌ بشكل مثال زد: منتجٌ أبٌ جذرُ كمّيته صفر و stocks فارغة
  r := public.taki_stock_webhook(v_key, jsonb_build_object(
         'id', 'ZID-PARENT-1', 'quantity', 0, 'structure', 'parent', 'stocks', '[]'::jsonb));
  SELECT on_hand INTO v_oh FROM public.deals WHERE id = v_deal;
  IF v_oh <> v_oh0 THEN
    RAISE EXCEPTION '❌ 🔴 صفرُ الجذر كُتب فعلاً: % ⇐ % — مخزونُ التاجر صُفّر.', v_oh0, v_oh;
  END IF;
  IF COALESCE(r->>'reason','') <> 'PARENT_OR_UNLIMITED' THEN
    RAISE EXCEPTION '❌ لم يُرفض لسببه الصحيح: %', r::text;
  END IF;
  RAISE NOTICE '✅ منتجٌ أبٌ بجذرٍ صفر: لم يُكتب شيءٌ (الكامل ثابتٌ عند %) والسببُ مُعلَن.', v_oh;

  -- (ج) ورقمٌ حقيقيٌّ من منتجٍ عاديّ **يُكتب** — وإلا لصار الحارسُ يمنع الربط كلّه
  r := public.taki_stock_webhook(v_key, jsonb_build_object(
         'id', 'ZID-PARENT-1', 'quantity', v_oh0 + 5, 'structure', 'simple'));
  SELECT on_hand INTO v_oh FROM public.deals WHERE id = v_deal;
  IF v_oh <> v_oh0 + 5 THEN
    RAISE EXCEPTION '❌ رقمٌ صحيحٌ لم يُكتب (% بدل %) — الحارسُ يمنع ما يجب أن يمرّ: %',
      v_oh, v_oh0 + 5, r::text;
  END IF;
  RAISE NOTICE '✅ ومنتجٌ عاديّ: الرقمُ كُتب (% ⇐ %).', v_oh0, v_oh;

  -- (د) الاستعادةُ والتنظيف
  PERFORM public.taki_set_on_hand(v_deal, v_oh0, NULL, NULL, now(), 'verify');
  DELETE FROM public.stock_integrations WHERE id = v_int;
  SELECT on_hand INTO v_oh FROM public.deals WHERE id = v_deal;
  IF v_oh <> v_oh0 THEN RAISE EXCEPTION '❌ العرضُ لم يعد إلى %.', v_oh0; END IF;
  IF EXISTS (SELECT 1 FROM public.stock_integrations WHERE label = 'v1515-verify') THEN
    RAISE EXCEPTION '❌ بقيّةُ فحصٍ لم تُحذف.';
  END IF;

  RAISE NOTICE '✅ v15.15: صفرُ الجذر لا يُصفّر مخزوناً · والرقمُ الحقيقيّ يمرّ · ولا بقايا.';
END
$verify$;
