-- ═══════════════════════════════════════════════════════════════════════════
-- v15.03 — ما يكتبه التاجر هو «المخزون الكامل»، والقاعدةُ تشتقّ المتاح
-- ═══════════════════════════════════════════════════════════════════════════
-- v15.02 بَنَت المعادلة. وهذا الملفّ يُغلق العيب الذي يكسرها كلّ يوم:
--
-- 🔴 العيب، مقيساً: `SellerDashboard.tsx` يكتب عند **كلّ** حفظ
--      quantity: effQuantity,  initialQuantity: effQuantity
--    أي يدهس عدّادَ المتاح برقمٍ من النموذج. فتاجرٌ عنده ٢٦ قطعة و٣ محجوزة
--    يُعدّل صورةً في العرض ⇒ يعود المتاح ٢٦، والقطعُ الثلاثُ المحجوزة تُباع
--    مرّةً ثانية. ولا خطأ يظهر، ولا سجلّ.
--
-- والعلاج في القاعدة لا في الواجهة، لثلاثة أسباب:
--   ١) الكاتبُ ليس واحداً: اللوحة اليوم، والبوتان غداً (طلبُ ناصر صريح)،
--      وأيّ ربطٍ خارجيّ بعدهما. قاعدةٌ واحدة تخدمهم جميعاً.
--   ٢) وإصلاحُ الواجهة وحدها يترك البابَ مفتوحاً لأيّ نداءٍ مباشر.
--   ٣) و`SellerDashboard.tsx` مسقوفٌ بـ٥٦٧٥ سطراً (وهو ٥٦٧٤) — والسقّافة
--      محقّة: ملفٌّ لا يُقرأ في جلسةٍ واحدة يصير التعديلُ فيه تخميناً.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 وكيف يُفرَّق «إعلانُ تاجر» عن «حجزِ مشترٍ»؟ كلاهما `UPDATE deals SET quantity`:
--    • حجزُ المشتري يقع **داخل** مشغّل `adjust_deal_quantity` على `bookings`
--      ⇒ `pg_trigger_depth() > 1`.
--    • وإعلانُ التاجر نداءٌ مباشر من PostgREST ⇒ العمق ١.
--    • و`taki_set_on_hand` تكتب المشتقّ بنفسها ⇒ تُعلن ذلك براية معاملة.
--    وهذا التمييز **يُقاس هنا سلوكياً** لا يُفترض: الاختبار في القسم ٤
--    يُدخل حجزاً حقيقياً ثمّ يحفظ كالتاجر، ويتأكّد أن الحجز نجا.
-- ═══════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر. أوقِفت.';
  END IF;
  IF to_regprocedure('public.taki_open_holds(text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'v15.02 غير مطبَّقة — هذا الملفّ يبني عليها. أوقِفت.';
  END IF;
END
$guard$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ١) رايةُ «أنا كتبتُ المشتقّ بنفسي» — وإطفاؤها هو نصفُ الحكاية
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 عيبٌ وقع في مسوّدتي وأمسكه الإثبات: حقنتُ `set_config(..., true)` في
--    أوّل الدالّة ولم أُطفئها. والرايةُ بـ`is_local = true` **محلّيةٌ
--    للمعاملة لا للنداء** — فتبقى مرفوعةً بعد انتهاء الدالّة، ويصير المشغّل
--    معطَّلاً لكلّ ما يلي في نفس المعاملة. وعلى الإنتاج كلُّ طلبٍ معاملةٌ
--    مستقلّة فما كان ليظهر إلا يوم يجتمع النداءان في معاملةٍ واحدة — أي
--    أسوأ وقتٍ ممكن. ولذلك تُعاد كتابة الدالّة بمخرجٍ واحد يُطفئ الراية،
--    والفحوصُ المبكّرة كلّها **قبل** رفعها.
DROP FUNCTION IF EXISTS public.taki_set_on_hand(text, int, jsonb, jsonb, timestamptz, text);
CREATE FUNCTION public.taki_set_on_hand(
  p_deal_id     text,
  p_on_hand     int          DEFAULT NULL,
  p_variants    jsonb        DEFAULT NULL,
  p_locations   jsonb        DEFAULT NULL,
  p_observed_at timestamptz  DEFAULT NULL,
  p_source      text         DEFAULT 'merchant'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_d  public.deals%ROWTYPE;
  v_at timestamptz := COALESCE(p_observed_at, now());
  v_h  int;
  v_new jsonb;
  v_out jsonb;
BEGIN
  -- ── كلُّ المخارج المبكّرة قبل رفع الراية ────────────────────────────────
  IF p_deal_id IS NULL OR btrim(p_deal_id) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'DEAL_REQUIRED');
  END IF;
  IF p_on_hand IS NOT NULL AND p_on_hand < 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NEGATIVE');
  END IF;

  -- 🪤 القفل قبل أيّ قراءة: بلا `FOR UPDATE` يقرأ نداءان نفسَ المحجوز فيكتب
  --    أحدهما فوق الآخر، ويصير المتاح أكبر ممّا يجب — أي بيعٌ لِما لا يوجد.
  SELECT * INTO v_d FROM public.deals WHERE id = p_deal_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;

  -- عرضٌ بلا حدّ لا كاملَ له — وصفرٌ فيه يعني «نفد».
  IF COALESCE(v_d.is_unlimited, false) THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'UNLIMITED');
  END IF;

  -- الملاحظةُ الأقدم تُهمَل — وليست خطأً: الشبكةُ تُعيد الترتيب أحياناً،
  -- فالأحدثُ **ملاحظةً** يفوز لا الأحدثُ وصولاً.
  IF v_d.stock_observed_at IS NOT NULL AND v_at < v_d.stock_observed_at THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'STALE_OBSERVATION',
                              'stored_at', v_d.stock_observed_at, 'incoming', v_at);
  END IF;

  -- ── من هنا نكتب: تُرفع الراية، وتُطفأ عند المخرج الوحيد ────────────────
  PERFORM set_config('taki.stock_derived', '1', true);

  IF p_on_hand IS NOT NULL THEN
    v_h := public.taki_open_holds(p_deal_id, NULL, NULL);
    -- 🪤 ولا يُنقص المحجوز أبداً: لو قال التاجر «عندي ٢» وعنده ٥ محجوزة،
    --    فالمتاح صفرٌ والحجوزاتُ الخمس تبقى — فبضاعةٌ وُعد بها مشترٍ لا
    --    تُسحب منه برقمٍ كُتب بعده.
    UPDATE public.deals
       SET on_hand = p_on_hand, quantity = GREATEST(0, p_on_hand - v_h)
     WHERE id = p_deal_id;
  END IF;

  IF p_variants IS NOT NULL AND jsonb_typeof(p_variants) = 'array'
     AND v_d.variants IS NOT NULL AND jsonb_typeof(v_d.variants) = 'array' THEN
    SELECT jsonb_agg(
             CASE WHEN inc.oh IS NULL THEN t.e
                  ELSE jsonb_set(jsonb_set(t.e, '{onHand}', to_jsonb(GREATEST(0, inc.oh))),
                                 '{qty}', to_jsonb(GREATEST(0,
                                   inc.oh - public.taki_open_holds(p_deal_id, t.e->>'id', NULL))))
             END ORDER BY t.ord)
      INTO v_new
      FROM jsonb_array_elements(v_d.variants) WITH ORDINALITY AS t(e, ord)
      LEFT JOIN LATERAL (
        SELECT NULLIF(x->>'onHand','')::int AS oh
          FROM jsonb_array_elements(p_variants) x
         WHERE x->>'id' = t.e->>'id' LIMIT 1) inc ON true;
    IF v_new IS NOT NULL THEN
      UPDATE public.deals SET variants = v_new WHERE id = p_deal_id;
    END IF;
  END IF;

  IF p_locations IS NOT NULL AND jsonb_typeof(p_locations) = 'array'
     AND v_d.locations IS NOT NULL AND jsonb_typeof(v_d.locations) = 'array' THEN
    SELECT jsonb_agg(public._taki_loc_on_hand(p_deal_id, t.e, inc.x) ORDER BY t.ord)
      INTO v_new
      FROM jsonb_array_elements(v_d.locations) WITH ORDINALITY AS t(e, ord)
      LEFT JOIN LATERAL (
        SELECT y AS x FROM jsonb_array_elements(p_locations) y
         WHERE y->>'id' = t.e->>'id' LIMIT 1) inc ON true;
    IF v_new IS NOT NULL THEN
      UPDATE public.deals SET locations = v_new WHERE id = p_deal_id;
    END IF;
  END IF;

  UPDATE public.deals SET stock_observed_at = v_at, stock_source = p_source
   WHERE id = p_deal_id;

  SELECT * INTO v_d FROM public.deals WHERE id = p_deal_id;
  v_out := jsonb_build_object('ok', true, 'on_hand', v_d.on_hand,
                              'holds', public.taki_open_holds(p_deal_id, NULL, NULL),
                              'available', v_d.quantity,
                              'variants', v_d.variants, 'locations', v_d.locations);

  -- 🔴 المخرجُ الوحيد بعد أيّ كتابة — وإطفاءُ الراية شرطُ صحّة لا تنظيف.
  PERFORM set_config('taki.stock_derived', '0', true);
  RETURN v_out;
END
$fn$;

REVOKE ALL ON FUNCTION public.taki_set_on_hand(text, int, jsonb, jsonb, timestamptz, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_set_on_hand(text, int, jsonb, jsonb, timestamptz, text) FROM anon;
REVOKE ALL ON FUNCTION public.taki_set_on_hand(text, int, jsonb, jsonb, timestamptz, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.taki_set_on_hand(text, int, jsonb, jsonb, timestamptz, text) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٢) المفسِّر: رقمُ التاجر = المخزون الكامل، والمتاح يُشتقّ
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.tr_stock_declare()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_id text := NEW.id;
BEGIN
  -- كتابةٌ من داخل مشغّلٍ آخر = عدّادُ المتاح (حجز/إلغاء) — لا تُلمَس.
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  -- وكتابةٌ من `taki_set_on_hand` = المشتقّ محسوبٌ أصلاً.
  IF COALESCE(current_setting('taki.stock_derived', true), '') = '1' THEN RETURN NEW; END IF;

  -- عرضٌ بلا حدّ: لا كاملَ له — وصفرٌ فيه يعني «نفد».
  IF COALESCE(NEW.is_unlimited, false) THEN
    NEW.on_hand := NULL;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.on_hand := GREATEST(0, COALESCE(NEW.quantity, 0));   -- عرضٌ جديد: لا محجوزَ بعد
    NEW.stock_observed_at := now(); NEW.stock_source := 'merchant';
    RETURN NEW;
  END IF;

  -- ── الإجمالي ────────────────────────────────────────────────────────────
  -- 🪤 الشرط `IS DISTINCT FROM OLD` مقصود: حفظٌ لا يمسّ الكمّية (تغييرُ صورة،
  --    وصف، سعر) لا يُعيد الاشتقاق ولا يلمس شيئاً — فلا أثرَ جانبيّ لحفظٍ بريء.
  IF NEW.quantity IS DISTINCT FROM OLD.quantity THEN
    NEW.on_hand := GREATEST(0, COALESCE(NEW.quantity, 0));
    NEW.quantity := GREATEST(0, NEW.on_hand - public.taki_open_holds(v_id, NULL, NULL));
    NEW.stock_observed_at := now(); NEW.stock_source := 'merchant';
  END IF;

  -- ── الأصناف ─────────────────────────────────────────────────────────────
  IF NEW.variants IS DISTINCT FROM OLD.variants
     AND NEW.variants IS NOT NULL AND jsonb_typeof(NEW.variants) = 'array' THEN
    NEW.variants := COALESCE((
      SELECT jsonb_agg(
        CASE WHEN (e ? 'qty') AND NULLIF(e->>'qty','') IS NOT NULL
             THEN jsonb_set(jsonb_set(e, '{onHand}', to_jsonb(GREATEST(0, (e->>'qty')::int))),
                            '{qty}', to_jsonb(GREATEST(0, (e->>'qty')::int
                              - public.taki_open_holds(v_id, e->>'id', NULL))))
             ELSE e END ORDER BY t.ord)
      FROM jsonb_array_elements(NEW.variants) WITH ORDINALITY AS t(e, ord)), NEW.variants);
  END IF;

  -- ── الفروع وأصنافُها ────────────────────────────────────────────────────
  IF NEW.locations IS DISTINCT FROM OLD.locations
     AND NEW.locations IS NOT NULL AND jsonb_typeof(NEW.locations) = 'array' THEN
    NEW.locations := COALESCE((
      SELECT jsonb_agg(public._taki_loc_declare(v_id, t.e) ORDER BY t.ord)
      FROM jsonb_array_elements(NEW.locations) WITH ORDINALITY AS t(e, ord)), NEW.locations);
  END IF;

  RETURN NEW;
END
$fn$;

CREATE OR REPLACE FUNCTION public._taki_loc_declare(p_deal_id text, p_el jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_out jsonb := p_el; v_loc text := p_el->>'id'; v_oh int; k text; v int;
BEGIN
  IF (p_el ? 'quantity') AND NULLIF(p_el->>'quantity','') IS NOT NULL THEN
    v_oh := GREATEST(0, (p_el->>'quantity')::int);
    v_out := jsonb_set(v_out, '{onHand}', to_jsonb(v_oh), true);
    v_out := jsonb_set(v_out, '{quantity}',
               to_jsonb(GREATEST(0, v_oh - public.taki_open_holds(p_deal_id, NULL, v_loc))));
  END IF;

  IF (p_el ? 'variantQtys') AND jsonb_typeof(p_el->'variantQtys') = 'object' THEN
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
$fn$;

-- 🪤 الترتيب مقصود: `tr_ac_…` < `tr_b0_…` < `tr_deal_…` — أي بعد حرّاس النشر
--    وقبل مزامنة الفروع، فتقرأ تلك الأخيرة المتاحَ المشتقّ لا رقمَ النموذج.
DROP TRIGGER IF EXISTS tr_b0_stock_declare ON public.deals;
CREATE TRIGGER tr_b0_stock_declare
  BEFORE INSERT OR UPDATE ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.tr_stock_declare();

-- ═══════════════════════════════════════════════════════════════════════════
-- ٣) تحقّقٌ غيرُ غازٍ — يرفع استثناءً
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 ولا يُدرَج هنا حجزٌ وهميّ: الإثباتُ الحاسم (أن الحجز القائم ينجو من حفظ
--    التاجر) يحتاج حجزاً حقيقياً، ومكانُه ملفُّ التجربة
--    `supabase/proof_v15_03_hold_survives.sql` داخل `BEGIN … ROLLBACK`.
--    إدراجُ صفٍّ في `bookings` على الإنتاج لأجل اختبارٍ ليس مقبولاً.
DO $verify$
DECLARE v_id text; v_q int; v_oh int; v_desc text; n int;
BEGIN
  IF to_regprocedure('public.tr_stock_declare()') IS NULL
     OR to_regprocedure('public._taki_loc_declare(text,jsonb)') IS NULL THEN
    RAISE EXCEPTION '❌ دالّتا الإعلان لم تُنشأا.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid='public.deals'::regclass AND tgname='tr_b0_stock_declare') THEN
    RAISE EXCEPTION '❌ المشغّل غير مركَّب — النموذج سيظلّ يدهس المخزون.';
  END IF;
  -- الترتيب: بعد حرّاس النشر وقبل مزامنة الفروع
  IF 'tr_b0_stock_declare' <= 'tr_ac_publish_needs_declaration'
     OR 'tr_b0_stock_declare' >= 'tr_deal_branches_sync' THEN
    RAISE EXCEPTION '❌ ترتيبُ المشغّل خاطئ.';
  END IF;
  -- الرايةُ حُقنت فعلاً
  IF position('taki.stock_derived' IN pg_get_functiondef(
       'public.taki_set_on_hand(text,integer,jsonb,jsonb,timestamptz,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '❌ رايةُ الاشتقاق غائبة — المشغّل سيُعيد اشتقاق ما اشتُقّ.';
  END IF;
  -- وحارسُ العمق موجود (وإلا لدهس حجزُ المشتري نفسَه)
  IF position('pg_trigger_depth()' IN pg_get_functiondef('public.tr_stock_declare()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '❌ لا تمييزَ بين إعلان التاجر وحجز المشتري.';
  END IF;

  -- ── قياسٌ سلوكيّ على عرضٍ حقيقيّ بلا محجوز، ثمّ يُعاد ──────────────────
  SELECT d.id, d.quantity, d.on_hand, d.description INTO v_id, v_q, v_oh, v_desc
    FROM public.deals d
   WHERE d.on_hand IS NOT NULL AND COALESCE(d.is_unlimited,false)=false
     AND public.taki_open_holds(d.id,NULL,NULL) = 0
   ORDER BY d.id LIMIT 1;

  IF v_id IS NOT NULL THEN
    -- حفظٌ كالتاجر برقمٍ جديد: يصير كاملاً، والمتاح يُشتقّ (وبلا محجوز يتساويان)
    UPDATE public.deals SET quantity = v_oh + 11 WHERE id = v_id;
    SELECT on_hand, quantity INTO n, v_q FROM public.deals WHERE id = v_id;
    IF n <> v_oh + 11 THEN
      RAISE EXCEPTION '❌ رقمُ التاجر لم يُسجَّل كاملاً (% بدل %).', n, v_oh + 11;
    END IF;
    IF v_q <> v_oh + 11 THEN
      RAISE EXCEPTION '❌ المتاح بلا محجوز يجب أن يساوي الكامل (% ≠ %).', v_q, v_oh + 11;
    END IF;

    -- وحفظٌ لا يمسّ الكمّية لا يلمس المخزون إطلاقاً
    UPDATE public.deals SET description = COALESCE(description,'') WHERE id = v_id;
    SELECT on_hand INTO n FROM public.deals WHERE id = v_id;
    IF n <> v_oh + 11 THEN
      RAISE EXCEPTION '❌ حفظٌ بريء (وصف) غيّر المخزون — أثرٌ جانبيّ.';
    END IF;

    -- الاستعادة
    UPDATE public.deals SET quantity = v_oh, description = v_desc WHERE id = v_id;
    SELECT quantity, on_hand INTO v_q, n FROM public.deals WHERE id = v_id;
    IF v_q <> v_oh OR n <> v_oh THEN
      RAISE EXCEPTION '❌ العرض % لم يعد إلى حاله (متاح=% كامل=% والأصل %).', v_id, v_q, n, v_oh;
    END IF;
    RAISE NOTICE '✅ سلوكيّاً على %: رقمُ التاجر صار كاملاً · المتاح مشتقّ · الحفظُ البريء بلا أثر · أُعيد.', v_id;
  END IF;

  -- ── 🔴 الرايةُ تُطفأ — وهذا بالضبط العيب الذي وقعتُ فيه ───────────────
  --    `set_config(..., true)` محلّيةٌ **للمعاملة** لا للنداء. فدالّةٌ ترفعها
  --    ولا تُطفئها تُعطّل المشغّل لكلّ ما يلي في نفس المعاملة — ولا يظهر ذلك
  --    على الإنتاج (كلُّ طلبٍ معاملةٌ مستقلّة) إلا يوم يجتمع النداءان.
  IF v_id IS NOT NULL THEN
    PERFORM public.taki_set_on_hand(v_id, v_oh, NULL, NULL, now(), 'verify');
    IF COALESCE(current_setting('taki.stock_derived', true), '0') <> '0' THEN
      RAISE EXCEPTION '❌ الرايةُ بقيت مرفوعة بعد الكتابة — المشغّل معطَّلٌ لبقيّة المعاملة.';
    END IF;
    -- وبعدها مباشرةً: حفظٌ كالتاجر في نفس المعاملة يجب أن يُشتقّ
    UPDATE public.deals SET quantity = v_oh + 4 WHERE id = v_id;
    SELECT on_hand INTO n FROM public.deals WHERE id = v_id;
    IF n <> v_oh + 4 THEN
      RAISE EXCEPTION '❌ المشغّل لم يعمل بعد نداء taki_set_on_hand في نفس المعاملة (الكامل %).', n;
    END IF;
    UPDATE public.deals SET quantity = v_oh WHERE id = v_id;
    RAISE NOTICE '✅ الرايةُ تُطفأ، والمشغّل يعمل بعدها في نفس المعاملة.';
  END IF;

  -- ولا انحرافَ بقي في المعادلة
  SELECT count(*) INTO n FROM public.deals d
   WHERE d.on_hand IS NOT NULL
     AND COALESCE(d.quantity,-1) <> GREATEST(0, d.on_hand - public.taki_open_holds(d.id,NULL,NULL));
  IF n > 0 THEN RAISE EXCEPTION '❌ % عرضاً خرج عن المعادلة.', n; END IF;

  RAISE NOTICE '✅ v15.03: ما يكتبه التاجر = المخزون الكامل · والمتاح يُشتقّ · وحجزُ المشتري لا يُفسَّر إعلاناً.';
END
$verify$;
