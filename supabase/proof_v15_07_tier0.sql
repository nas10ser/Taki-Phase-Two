-- ═══════════════════════════════════════════════════════════════════════════
-- إثباتُ v15.07 — المفتاحُ يمنع البيع فعلاً، والنافدُ اختفى من البوتين
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 ليس هجرة: يحاول حجزاً حقيقياً ويقرأ التصفّح. كلُّه داخل معاملةٍ تُلغى.
BEGIN;

-- 🪤 يُعزل الحارسُ المقصود وحده: أوّل تشغيلٍ سقط عند
--    `TAKI_DELIVERY_OUT_OF_ZONE` قبل أن يبلغ ما نختبره، فكان سيُقرأ «رُفض»
--    ويُظنّ المفتاحُ عاملاً وهو لم يُسأل أصلاً. وهذا هو الفرقُ بين «رُفض»
--    و«رُفض للسبب المقصود» — والاختبارُ أدناه يشترط الرمزَ والنصَّ معاً.
ALTER TABLE public.bookings DISABLE TRIGGER USER;
ALTER TABLE public.bookings ENABLE TRIGGER tr_booking_stock_reserve;

DO $proof$
DECLARE
  v_deal text; v_var text; v_loc text; v_buyer text; v_cols text;
  v_sql text; v_err text; v_code text; v_before int; v_after int; r jsonb;
BEGIN
  SELECT d.id INTO v_deal FROM public.deals d
   WHERE d.status='active' AND d.variants IS NOT NULL
     AND jsonb_array_length(COALESCE(d.variants,'[]'::jsonb)) > 0
     AND d.loc_qty_mode='per_location' ORDER BY d.id LIMIT 1;
  IF v_deal IS NULL THEN
    SELECT d.id INTO v_deal FROM public.deals d WHERE d.status='active' ORDER BY d.id LIMIT 1;
  END IF;
  SELECT (e->>'id') INTO v_var FROM public.deals d, jsonb_array_elements(d.variants) e
   WHERE d.id=v_deal LIMIT 1;
  SELECT (e->>'id') INTO v_loc FROM public.deals d, jsonb_array_elements(d.locations) e
   WHERE d.id=v_deal LIMIT 1;
  RAISE NOTICE 'ℹ️ العرض % · صنف % · فرع %', v_deal, COALESCE(v_var,'—'), COALESCE(v_loc,'—');

  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO v_cols
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='bookings' AND is_generated='NEVER';
  EXECUTE format('CREATE TEMP TABLE _t7 AS SELECT %s FROM public.bookings LIMIT 1', v_cols);
  UPDATE _t7 SET barcode='999999921', status='pending', booked_quantity=1,
    deal_id=v_deal, location_id=NULL, selected_options='[]'::jsonb, restocked_qty=0;

  -- ── (١) قبل المفتاح: الحجزُ يمرّ ──────────────────────────────────────
  BEGIN
    EXECUTE format('INSERT INTO public.bookings (%s) SELECT %s FROM _t7', v_cols, v_cols);
    RAISE NOTICE '✅ ① قبل المفتاح: الحجزُ نجح (المسار سليم).';
    DELETE FROM public.bookings WHERE barcode='999999921';
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION '❌ الحجزُ فشل قبل رفع المفتاح (%) — الإعدادُ خاطئ، والاختبارُ بعده بلا معنى.', SQLERRM;
  END;

  -- ── (٢) 🔴 وبعده: يُرفض، وبالرمز الصحيح ───────────────────────────────
  PERFORM public._taki_set_off(v_deal, true, NULL, NULL);
  v_err := NULL; v_code := NULL;
  BEGIN
    EXECUTE format('INSERT INTO public.bookings (%s) SELECT %s FROM _t7', v_cols, v_cols);
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM; v_code := SQLSTATE;
  END;
  IF v_err IS NULL THEN
    RAISE EXCEPTION '❌ 🔴 الحجزُ مرّ والمفتاحُ مرفوع — المفتاح اقتراحٌ لا حارس.';
  END IF;
  -- 🪤 «رُفض» لا يكفي: قد يُرفض لسببٍ آخر (سقفُ مواقع، حظر، حدّ حجز).
  --    يُشترط الرمزُ P0010 **والنصّ** الذي كتبناه.
  IF v_code <> 'P0010' THEN
    RAISE EXCEPTION '❌ رُفض برمزٍ آخر (%): % — ليس رفضَ المفتاح.', v_code, v_err;
  END IF;
  IF position('أوقف التاجر البيع مؤقتاً' IN v_err) = 0 THEN
    RAISE EXCEPTION '❌ رُفض بـP0010 لكن لسببٍ آخر: %', v_err;
  END IF;
  RAISE NOTICE '✅ ② المفتاح يرفض الحجز — P0010 وبالنصّ الصحيح.';

  -- ── (٣) ولم يُمسّ رقمُ التاجر ──────────────────────────────────────────
  SELECT on_hand INTO v_after FROM public.deals WHERE id=v_deal;
  PERFORM public._taki_set_off(v_deal, false, NULL, NULL);
  SELECT on_hand INTO v_before FROM public.deals WHERE id=v_deal;
  IF v_before IS DISTINCT FROM v_after THEN
    RAISE EXCEPTION '❌ المفتاح غيّر المخزون (% ⇐ %) — وهو يجب أن يوقف البيع ويُبقي الرقم.', v_after, v_before;
  END IF;
  RAISE NOTICE '✅ ③ الرقم لم يتغيّر (كامل=%) — المفتاح يوقف البيع لا المخزون.', v_before;

  -- ── (٤) 🔴 والعرضُ النافد اختفى من تصفّح البوت ─────────────────────────
  -- 🪤 تُقرأ نتيجةُ الدالّة كما هي (مصفوفة)، ويُبحث عن **هذا العرض بعينه**
  --    لا عن تغيّرٍ في العدد: العددُ قد يتغيّر لسببٍ آخر، أو لا يتغيّر لأن
  --    السقف (p_limit=8) يُخفي الأثر. الادّعاءُ الدقيق: هل هو في القائمة؟
  SELECT count(*) INTO v_before FROM jsonb_array_elements(
    public.bot_browse_deals(p_limit := 200)) e WHERE e->>'id' = v_deal;
  IF v_before <> 1 THEN
    RAISE EXCEPTION '❌ العرض غيرُ ظاهرٍ في تصفّح البوت أصلاً (%) — الاختبارُ بعده بلا معنى.', v_before;
  END IF;
  PERFORM public._taki_set_off(v_deal, true, NULL, NULL);
  SELECT count(*) INTO v_after FROM jsonb_array_elements(
    public.bot_browse_deals(p_limit := 200)) e WHERE e->>'id' = v_deal;
  IF v_after <> 0 THEN
    RAISE EXCEPTION '❌ 🔴 تصفّحُ البوت ما زال يعرض العرض النافد — وهو التسريبُ الذي كان قائماً.';
  END IF;
  -- وفي البحث كذلك
  -- 🪤 `bot_browse_deals` تُرجع **مصفوفة** و`bot_search` تُرجع **كائناً**
  --    مفاتيحه {q, deals, stores}. الخلطُ بينهما يُسقط الاختبار بخطأ يبدو
  --    خطأَ منتجٍ وهو خطأُ قراءة.
  SELECT count(*) INTO v_after FROM jsonb_array_elements(
    COALESCE(public.bot_search((SELECT item_name FROM deals WHERE id=v_deal), 200, NULL)->'deals', '[]'::jsonb)) e
   WHERE e->>'id' = v_deal;
  IF v_after <> 0 THEN
    RAISE EXCEPTION '❌ 🔴 بحثُ البوت ما زال يُظهر العرض النافد.';
  END IF;
  RAISE NOTICE '✅ ④ العرضُ النافد اختفى من تصفّح البوت وبحثه معاً.';
  PERFORM public._taki_set_off(v_deal, false, NULL, NULL);

  -- ── (٥) ومفتاحُ الصنف يمنع اختيارَه وحده ───────────────────────────────
  IF v_var IS NOT NULL THEN
    UPDATE _t7 SET selected_options = jsonb_build_array(
      jsonb_build_object('c', v_var, 'g', '__variant__', 'qty', 1));
    PERFORM public._taki_set_off(v_deal, true, v_var, NULL);
    v_err := NULL; v_code := NULL;
    BEGIN
      EXECUTE format('INSERT INTO public.bookings (%s) SELECT %s FROM _t7', v_cols, v_cols);
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; v_code := SQLSTATE;
    END;
    IF v_err IS NULL OR v_code <> 'P0010' OR position('أوقف التاجر بيعه مؤقتاً' IN COALESCE(v_err,'')) = 0 THEN
      RAISE EXCEPTION '❌ مفتاحُ الصنف لم يمنع اختياره (% / %).', COALESCE(v_code,'—'), COALESCE(v_err,'مرّ');
    END IF;
    PERFORM public._taki_set_off(v_deal, false, v_var, NULL);
    RAISE NOTICE '✅ ⑤ مفتاحُ الصنف يمنع اختياره وحده.';
  END IF;

  RAISE NOTICE '✅ الإثبات كامل — وكلُّه داخل معاملةٍ تُلغى.';
END
$proof$;

ALTER TABLE public.bookings ENABLE TRIGGER USER;

ROLLBACK;

-- 🪤 بعد `ROLLBACK` يعود العمود `sold_out` غيرَ موجود (الهجرةُ أُلغيت معه)،
--    فلا يُستعلم عنه هنا. المفحوصُ أن لا أثرَ بقي من الحجوز الوهمية.
SELECT 'بعد الإلغاء — حجوزٌ وهميّة: ' ||
       (SELECT count(*) FROM public.bookings WHERE barcode LIKE '9999999%')::text;
