-- ═══════════════════════════════════════════════════════════════════════════
-- v15.02 — «المخزون الكامل» يكتبه التاجر، و«المتاح» نحسبه نحن
-- ═══════════════════════════════════════════════════════════════════════════
-- قرارُ ناصر حرفياً: «التاجر يكتب المخزون الكامل ونطرح منه المحجوز».
--
-- 🔴 العيب الذي يُغلقه هذا الملفّ — وقد قِيس على الإنتاج لا استُنتج:
--    `deals.quantity` اليوم ليست «مخزون التاجر» بل **عدّادُ المتاح**: ينقصها
--    `adjust_deal_quantity` لحظةَ الحجز ويُعيدها عند الإلغاء. ونموذجُ التاجر
--    يكتب فيها ما يكتبه مباشرةً عند **كل** حفظ — فتعديلُ صورةٍ في عرضٍ عليه
--    حجوزاتٌ قائمة يُعيد المخزونَ المحجوز إلى البيع.
--    ولا يوجد في المنصّة اليوم أيُّ مكانٍ يحمل «كم عند التاجر فعلاً»،
--    فلا شيء يمكن مزامنتُه مع نظام كاشيرٍ أصلاً — وهذا أساسُ ما طلبه ناصر.
--
-- والمعادلةُ بعد هذا الملفّ متّسقةٌ في الاتجاهات الأربعة:
--      المتاح = المخزون الكامل − المحجوز الآن
--   • حجزٌ جديد   : المحجوز +١ ⇒ المتاح −١ · الكامل ثابت
--   • إلغاء       : المحجوز −١ ⇒ المتاح +١ · الكامل ثابت
--   • بيعٌ مكتمل  : المحجوز −١ **والكامل −١** ⇒ المتاح ثابت (البضاعة خرجت)
--   • مزامنةٌ خارجية: الكامل := N ⇒ المتاح = N − المحجوز
--
-- 🪤 ولا يُمسّ الحارس الذرّيّ ولا عدّادُ المتاح: `tr_reserve_booking_stock`
--    و`adjust_deal_quantity` يبقيان حرفياً كما هما. الكاملُ يُضاف **بجانبهما**
--    لا مكانهما — فحارسٌ مجرَّبٌ يمنع البيعَ الزائد على أربعة محاور لا يُعاد
--    بناؤه لأجل ميزة.
--
-- 🪤 وأثرُ الهبوط **صفر**: الكامل يُهيَّأ = (المتاح + المحجوز الآن). قِيس على
--    الإنتاج: صفرُ حجزٍ مفتوح اليوم (١٠٥ حجزاً كلّها مكتملة أو ملغاة)،
--    فالتهيئة = المتاح نفسه، رقماً برقم.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ما صحّحه القياسُ في مسوّدتي الأولى — ثلاثةُ أخطاءٍ كانت ستُفسد الحساب:
--   ١) 🔴 **الصنف يُميَّز بالوسم `g = '__variant__'`** لا بمطابقة `c` وحدها.
--      وفي الإنتاج ٣٠ اختيارَ صنفٍ مقابل **٢٤ اختيارَ خيارٍ إضافيّ** يتشاركان
--      نفس مفتاح `c` — فبلا الوسم كنت سأحسب «حجم القهوة» مخزوناً وأخصمه.
--   ٢) 🔴 **العرض غير المحدود `quantity` فيه NULL** (٦ عروض). و
--      `COALESCE(quantity,0)` كان سيجعل كاملَه **صفراً** — أي «نفد» على عرضٍ
--      بلا حدّ. الكاملُ يبقى NULL لغير المحدود، والدوالّ تتخطّاه.
--   ٣) 🔴 **المحجوز للصنف يُقاس بكمّية الاختيار** (`s.qty`) لا بكمّية الطلب:
--      طلبٌ واحد قد يحمل صنفين بكمّيتين مختلفتين.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── حارس: هذه هجرة إنتاج (جدّة) ────────────────────────────────────────────
DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر. أوقِفت.';
  END IF;
END
$guard$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ١) أعمدة الكامل — بجانب المتاح، لا مكانه
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 ولماذا داخل صفّ العرض نفسه لا في جدولٍ ثانٍ: الحارسُ الذرّيّ يقفل صفّ
--    العرض الواحد (`FOR UPDATE`) ويفحص المحاور الأربعة تحت ذلك القفل. جدولٌ
--    منفصل = قفلان وجدولان يمكن أن ينحرفا، وهذا بالضبط ما نُصلحه.
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS on_hand int;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS stock_observed_at timestamptz;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS stock_source text;

COMMENT ON COLUMN public.deals.quantity IS
  'المتاح للبيع الآن = on_hand − المحجوز. تكتبه حرّاس الحجز و taki_set_on_hand وحدها (v15.02).';
COMMENT ON COLUMN public.deals.on_hand IS
  'المخزون الكامل عند التاجر (v15.02). NULL = عرضٌ بلا حدّ. لا ينقص إلا ببيعٍ مكتمل أو بمزامنة.';
COMMENT ON COLUMN public.deals.stock_observed_at IS
  'لحظةُ **ملاحظة** الرقم في نظام المصدر — لا لحظةُ وصوله. الأقدم لا يدهس الأحدث.';
COMMENT ON COLUMN public.deals.stock_source IS
  'من كتب آخر رقم: merchant | sync | sale | admin | init.';

-- والأصناف والفروع: الكامل يسكن نفس الـjsonb بمفاتيح موازية، فلا يتغيّر أيّ
-- قارئٍ حاليّ:  variants[].onHand ↔ qty  ·  locations[].onHand ↔ quantity
--               locations[].variantOnHand{} ↔ variantQtys{}

-- ═══════════════════════════════════════════════════════════════════════════
-- ٢) المحجوز الآن — يُقرأ من الحجوزات، ولا يُخزَّن
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 عدّادٌ ثانٍ = مصدرٌ ثانٍ ينحرف. والحالات المحجوزة هي بعينها التي يحجزها
--    `adjust_deal_quantity` — قُرئت من نصّه الحيّ: يُنقص عند الإدراج ويُعيد
--    عند الانتقال إلى `cancelled`. وقيدُ CHECK يحصر الحالات في أربع، فما عدا
--    `cancelled` و`completed` محجوز.
DROP FUNCTION IF EXISTS public.taki_open_holds(text, text);
DROP FUNCTION IF EXISTS public.taki_open_holds(text, text, text);
CREATE FUNCTION public.taki_open_holds(
  p_deal_id     text,
  p_variant_id  text DEFAULT NULL,
  p_location_id text DEFAULT NULL
) RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE(CASE WHEN p_variant_id IS NULL THEN (
      SELECT sum(GREATEST(COALESCE(b.booked_quantity, 1), 1))
        FROM public.bookings b
       WHERE b.deal_id = p_deal_id
         AND b.status IN ('pending', 'acknowledged')
         AND (p_location_id IS NULL OR b.location_id = p_location_id)
    ) ELSE (
      -- 🔴 الوسم `__variant__` لا مطابقة `c` وحدها: الخياراتُ الإضافية
      --    تتشارك نفس المفتاح (٢٤ منها في الإنتاج) وليست مخزوناً.
      SELECT sum(GREATEST(COALESCE((s->>'qty')::int, 1), 1))
        FROM public.bookings b,
             jsonb_array_elements(COALESCE(b.selected_options, '[]'::jsonb)) s
       WHERE b.deal_id = p_deal_id
         AND b.status IN ('pending', 'acknowledged')
         AND (p_location_id IS NULL OR b.location_id = p_location_id)
         AND s->>'g' = '__variant__'
         AND s->>'c' = p_variant_id
    ) END, 0)::int;
$fn$;

REVOKE ALL ON FUNCTION public.taki_open_holds(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_open_holds(text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.taki_open_holds(text, text, text) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٣) فرعٌ واحد: طبِّق الكامل عليه واشتقّ متاحه (وأصنافَه داخله)
-- ═══════════════════════════════════════════════════════════════════════════
-- فرعٌ في الإنتاج يحمل: {id, quantity, initialQuantity, variantQtys{vid:n}, …}
CREATE OR REPLACE FUNCTION public._taki_loc_on_hand(
  p_deal_id text, p_el jsonb, p_inc jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
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
$fn$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٤) الكاتبُ الوحيد للكامل — كلُّ مصدرٍ يمرّ من هنا
-- ═══════════════════════════════════════════════════════════════════════════
-- التاجرُ من لوحته، والمزامنةُ من نظامه، والبيعُ المكتمل. فموضعُ حساب المتاح
-- واحد، ولا تنحرف طريقان.
--
-- 🪤 `p_observed_at` ليست زينة: رسالتان من نظام كاشيرٍ قد تصلان مقلوبتَي
--    الترتيب — الشبكةُ لا تضمن ترتيباً. فالأحدثُ **ملاحظةً** يفوز لا الأحدثُ
--    وصولاً، وإلا كتبت رسالةٌ قديمة فوق رقمٍ أصحّ منها وباع الموقعُ ما نفد.
DROP FUNCTION IF EXISTS public.taki_set_on_hand(text, int, jsonb, timestamptz, text);
DROP FUNCTION IF EXISTS public.taki_set_on_hand(text, int, jsonb, jsonb, timestamptz, text);
CREATE FUNCTION public.taki_set_on_hand(
  p_deal_id     text,
  p_on_hand     int          DEFAULT NULL,   -- NULL = لا تغيير على الإجمالي
  p_variants    jsonb        DEFAULT NULL,   -- [{id, onHand}]
  p_locations   jsonb        DEFAULT NULL,   -- [{id, onHand, variantOnHand{}}]
  p_observed_at timestamptz  DEFAULT NULL,   -- NULL ⇒ now()
  p_source      text         DEFAULT 'merchant'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_d     public.deals%ROWTYPE;
  v_at    timestamptz := COALESCE(p_observed_at, now());
  v_holds int;
  v_new   jsonb;
BEGIN
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

  -- 🔴 عرضٌ بلا حدّ لا كاملَ له ولا متاحَ يُشتقّ — و`COALESCE(quantity,0)`
  --    عليه كان سيكتب «صفر» أي «نفد».
  IF COALESCE(v_d.is_unlimited, false) THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'UNLIMITED');
  END IF;

  -- الملاحظةُ الأقدم تُهمَل — وليست خطأً.
  IF v_d.stock_observed_at IS NOT NULL AND v_at < v_d.stock_observed_at THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'STALE_OBSERVATION',
                              'stored_at', v_d.stock_observed_at, 'incoming', v_at);
  END IF;

  -- ── الإجمالي ────────────────────────────────────────────────────────────
  IF p_on_hand IS NOT NULL THEN
    v_holds := public.taki_open_holds(p_deal_id, NULL, NULL);
    -- 🪤 ولا يُنقص المحجوز أبداً: لو قال التاجر «عندي ٢» وعنده ٥ محجوزة،
    --    فالمتاح صفرٌ والحجوزاتُ الخمس تبقى قائمة — فبضاعةٌ وُعد بها مشترٍ
    --    لا تُسحب منه برقمٍ كُتب بعده.
    UPDATE public.deals
       SET on_hand = p_on_hand,
           quantity = GREATEST(0, p_on_hand - v_holds)
     WHERE id = p_deal_id;
  END IF;

  -- ── الأصناف ─────────────────────────────────────────────────────────────
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

  -- ── الفروع (وأصنافُها داخلها) ───────────────────────────────────────────
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
  RETURN jsonb_build_object('ok', true, 'on_hand', v_d.on_hand,
                            'holds', public.taki_open_holds(p_deal_id, NULL, NULL),
                            'available', v_d.quantity,
                            'variants', v_d.variants, 'locations', v_d.locations);
END
$fn$;

REVOKE ALL ON FUNCTION public.taki_set_on_hand(text, int, jsonb, jsonb, timestamptz, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_set_on_hand(text, int, jsonb, jsonb, timestamptz, text) FROM anon;
REVOKE ALL ON FUNCTION public.taki_set_on_hand(text, int, jsonb, jsonb, timestamptz, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.taki_set_on_hand(text, int, jsonb, jsonb, timestamptz, text) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٥) بابُ التاجر — يكتب مخزونه الكامل ولا يلمس المتاح
-- ═══════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.merchant_set_stock(text, int, jsonb);
DROP FUNCTION IF EXISTS public.merchant_set_stock(text, int, jsonb, jsonb);
CREATE FUNCTION public.merchant_set_stock(
  p_deal_id   text,
  p_on_hand   int   DEFAULT NULL,
  p_variants  jsonb DEFAULT NULL,
  p_locations jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_me text := NULLIF((SELECT auth.uid())::text, ''); v_owner text; v_admin boolean;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED'); END IF;
  SELECT store_id INTO v_owner FROM public.deals WHERE id = p_deal_id;
  IF v_owner IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;

  -- تاجرٌ يعدّل مخزون عرضٍ ليس له = تخريب. والإدارةُ مستثناةٌ بصلاحيتها وحدها.
  v_admin := (v_owner IS DISTINCT FROM v_me) AND public.taki_admin_perm('action_delete_deals');
  IF v_owner IS DISTINCT FROM v_me AND NOT v_admin THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_YOUR_DEAL');
  END IF;

  RETURN public.taki_set_on_hand(p_deal_id, p_on_hand, p_variants, p_locations, now(),
                                 CASE WHEN v_admin THEN 'admin' ELSE 'merchant' END);
END
$fn$;

REVOKE ALL ON FUNCTION public.merchant_set_stock(text, int, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merchant_set_stock(text, int, jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.merchant_set_stock(text, int, jsonb, jsonb) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٦) البيعُ المكتمل ينقص الكامل — وإلا بقي الرقمُ كما هو إلى الأبد
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 ولا يُمسّ `quantity` هنا: نقصَ لحظةَ الحجز. فالمحجوز ينقص والكاملُ ينقص
--    معاً، والفرقُ (المتاح) يبقى ثابتاً — وهذا هو الاتّساق المطلوب بالضبط.
CREATE OR REPLACE FUNCTION public.tr_on_hand_on_sale()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_need int; v_sel jsonb;
BEGIN
  IF NEW.status <> 'completed' OR OLD.status = 'completed' THEN RETURN NEW; END IF;
  v_need := GREATEST(COALESCE(NEW.booked_quantity, 1), 1);

  UPDATE public.deals
     SET on_hand = GREATEST(0, on_hand - v_need),
         stock_observed_at = now(), stock_source = 'sale'
   WHERE id = NEW.deal_id AND on_hand IS NOT NULL
     AND COALESCE(is_unlimited, false) = false;

  -- الفرع
  IF NEW.location_id IS NOT NULL THEN
    UPDATE public.deals d SET locations = (
      SELECT jsonb_agg(
        CASE WHEN e->>'id' = NEW.location_id AND (e ? 'onHand')
                  AND NULLIF(e->>'onHand','') IS NOT NULL
             THEN jsonb_set(e, '{onHand}', to_jsonb(GREATEST(0, (e->>'onHand')::int - v_need)))
             ELSE e END ORDER BY t.ord)
      FROM jsonb_array_elements(d.locations) WITH ORDINALITY AS t(e, ord))
     WHERE d.id = NEW.deal_id AND d.loc_qty_mode = 'per_location'
       AND d.locations IS NOT NULL AND jsonb_typeof(d.locations) = 'array';
  END IF;

  -- الأصناف (وأصنافُ الفرع) — بالوسم `__variant__` وحده
  IF NEW.selected_options IS NOT NULL AND jsonb_typeof(NEW.selected_options) = 'array' THEN
    FOR v_sel IN SELECT * FROM jsonb_array_elements(NEW.selected_options) LOOP
      CONTINUE WHEN v_sel->>'g' IS DISTINCT FROM '__variant__';

      UPDATE public.deals d SET variants = (
        SELECT jsonb_agg(
          CASE WHEN e->>'id' = v_sel->>'c' AND (e ? 'onHand')
                    AND NULLIF(e->>'onHand','') IS NOT NULL
               THEN jsonb_set(e, '{onHand}', to_jsonb(GREATEST(0, (e->>'onHand')::int
                      - GREATEST(COALESCE((v_sel->>'qty')::int, 1), 1))))
               ELSE e END ORDER BY t.ord)
        FROM jsonb_array_elements(d.variants) WITH ORDINALITY AS t(e, ord))
       WHERE d.id = NEW.deal_id
         AND d.variants IS NOT NULL AND jsonb_typeof(d.variants) = 'array';

      IF NEW.location_id IS NOT NULL THEN
        UPDATE public.deals d SET locations = (
          SELECT jsonb_agg(
            CASE WHEN e->>'id' = NEW.location_id AND (e ? 'variantOnHand')
                      AND ((e->'variantOnHand') ? (v_sel->>'c'))
                      AND NULLIF(e->'variantOnHand'->>(v_sel->>'c'),'') IS NOT NULL
                 THEN jsonb_set(e, ARRAY['variantOnHand', v_sel->>'c'],
                        to_jsonb(GREATEST(0, (e->'variantOnHand'->>(v_sel->>'c'))::int
                          - GREATEST(COALESCE((v_sel->>'qty')::int, 1), 1))))
                 ELSE e END ORDER BY t.ord)
          FROM jsonb_array_elements(d.locations) WITH ORDINALITY AS t(e, ord))
         WHERE d.id = NEW.deal_id AND d.loc_qty_mode = 'per_location'
           AND d.locations IS NOT NULL AND jsonb_typeof(d.locations) = 'array';
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END
$fn$;

-- 🪤 الاسم `tr_zx_…` يسبق `tr_zy_issue_order_invoice` ويلي `trg_adjust_deal_quantity`
--    ترتيباً أبجدياً — ولا يهمّ هنا (`adjust` لا يفعل شيئاً عند الإكمال)،
--    لكنّ الترتيبَ يُقصد لا يُترك.
DROP TRIGGER IF EXISTS tr_zx_on_hand_on_sale ON public.bookings;
CREATE TRIGGER tr_zx_on_hand_on_sale
  AFTER UPDATE OF status ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.tr_on_hand_on_sale();

-- ═══════════════════════════════════════════════════════════════════════════
-- ٦٫٥) بذرةُ الفرع — الكامل = المتاح + المحجوز، لكل فرعٍ ولكل صنفٍ فيه
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 ولا تُكتب فوق قيمةٍ موجودة: التهيئة تجري مرّةً واحدة، وإعادةُ تشغيل
--    الهجرة (وهي آمنةُ التكرار) يجب ألّا تدهس رقماً كتبه تاجرٌ بعدها.
CREATE OR REPLACE FUNCTION public._taki_loc_seed(p_deal_id text, p_el jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_out jsonb := p_el; v_loc text := p_el->>'id'; k text; v int;
BEGIN
  IF (p_el ? 'quantity') AND NULLIF(p_el->>'quantity','') IS NOT NULL
     AND NOT (p_el ? 'onHand') THEN
    v_out := jsonb_set(v_out, '{onHand}', to_jsonb(GREATEST(0,
               (p_el->>'quantity')::int + public.taki_open_holds(p_deal_id, NULL, v_loc))));
  END IF;

  IF (p_el ? 'variantQtys') AND jsonb_typeof(p_el->'variantQtys') = 'object'
     AND NOT (p_el ? 'variantOnHand') THEN
    v_out := jsonb_set(v_out, '{variantOnHand}', '{}'::jsonb, true);
    FOR k, v IN SELECT key, NULLIF(value #>> '{}','')::int
                  FROM jsonb_each(p_el->'variantQtys') LOOP
      CONTINUE WHEN v IS NULL;
      v_out := jsonb_set(v_out, ARRAY['variantOnHand', k], to_jsonb(GREATEST(0,
                 v + public.taki_open_holds(p_deal_id, k, v_loc))), true);
    END LOOP;
  END IF;

  RETURN v_out;
END
$fn$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٧) التهيئة — بأثرٍ صفر على ما يراه المشتري
-- ═══════════════════════════════════════════════════════════════════════════
-- الكامل = المتاح + المحجوز الآن، على كل محور. وغيرُ المحدود يُترك NULL.
UPDATE public.deals d
   SET on_hand = GREATEST(0, d.quantity + public.taki_open_holds(d.id, NULL, NULL)),
       stock_observed_at = COALESCE(d.stock_observed_at, now()),
       stock_source = COALESCE(d.stock_source, 'init')
 WHERE d.on_hand IS NULL
   AND COALESCE(d.is_unlimited, false) = false
   AND d.quantity IS NOT NULL;

UPDATE public.deals d SET variants = (
  SELECT jsonb_agg(
    CASE WHEN (e ? 'qty') AND NULLIF(e->>'qty','') IS NOT NULL AND NOT (e ? 'onHand')
         THEN jsonb_set(e, '{onHand}', to_jsonb(
                GREATEST(0, (e->>'qty')::int + public.taki_open_holds(d.id, e->>'id', NULL))))
         ELSE e END ORDER BY t.ord)
  FROM jsonb_array_elements(d.variants) WITH ORDINALITY AS t(e, ord))
 WHERE d.variants IS NOT NULL AND jsonb_typeof(d.variants) = 'array'
   AND jsonb_array_length(d.variants) > 0;

UPDATE public.deals d SET locations = (
  SELECT jsonb_agg(public._taki_loc_seed(d.id, t.e) ORDER BY t.ord)
  FROM jsonb_array_elements(d.locations) WITH ORDINALITY AS t(e, ord))
 WHERE d.loc_qty_mode = 'per_location'
   AND d.locations IS NOT NULL AND jsonb_typeof(d.locations) = 'array'
   AND jsonb_array_length(d.locations) > 0;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٨) تحقّقٌ يرفع استثناءً — والأهمّ فيه: أثرُ الهبوط صفر على المحاور الأربعة
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 جدول «✅/❌» لا يُفشل `psql` (صفٌّ يقول ❌ ليس خطأً في SQL). كلُّ تحقّقٍ
--    هنا `RAISE EXCEPTION` داخل معاملة — فالفشلُ يُرجع كلَّ شيء.
DO $verify$
DECLARE
  n int; v_bad int; v_res jsonb;
  v_id text; v_q int; v_oh int; v_var jsonb; v_loc jsonb; v_vid text;
BEGIN
  -- ── (أ) البنية والصلاحيات ───────────────────────────────────────────────
  IF to_regprocedure('public.taki_open_holds(text,text,text)') IS NULL
     OR to_regprocedure('public.taki_set_on_hand(text,integer,jsonb,jsonb,timestamptz,text)') IS NULL
     OR to_regprocedure('public.merchant_set_stock(text,integer,jsonb,jsonb)') IS NULL
     OR to_regprocedure('public._taki_loc_on_hand(text,jsonb,jsonb)') IS NULL
     OR to_regprocedure('public._taki_loc_seed(text,jsonb)') IS NULL THEN
    RAISE EXCEPTION '❌ إحدى الدوال الخمس لم تُنشأ.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='deals'
                    AND column_name IN ('on_hand','stock_observed_at','stock_source')
                 HAVING count(*) = 3) THEN
    RAISE EXCEPTION '❌ أعمدة المخزون الكامل ناقصة.';
  END IF;
  IF has_function_privilege('anon','public.merchant_set_stock(text,integer,jsonb,jsonb)','EXECUTE')
     OR has_function_privilege('anon','public.taki_open_holds(text,text,text)','EXECUTE') THEN
    RAISE EXCEPTION '❌ الزائر يصل إلى المخزون.';
  END IF;
  -- 🔴 الكاتبُ الداخليّ لا يُفتح لكلّ موثَّق: فتحُه يلتفّ على فحص الملكية
  --    في `merchant_set_stock` — أي تاجرٌ يكتب مخزون تاجرٍ آخر.
  IF has_function_privilege('authenticated',
       'public.taki_set_on_hand(text,integer,jsonb,jsonb,timestamptz,text)','EXECUTE') THEN
    RAISE EXCEPTION '❌ الكاتبُ الداخليّ مفتوحٌ لكل موثَّق — التفافٌ على فحص الملكية.';
  END IF;

  -- ── (ب) 🔴 أثرُ الهبوط صفر — المحور الأوّل: إجمالي العرض ────────────────
  SELECT count(*) INTO v_bad FROM public.deals d
   WHERE d.on_hand IS NOT NULL
     AND COALESCE(d.quantity,-1) <> GREATEST(0, d.on_hand - public.taki_open_holds(d.id, NULL, NULL));
  IF v_bad > 0 THEN
    RAISE EXCEPTION '❌ % عرضاً متاحُه ≠ (الكامل − المحجوز) — المعادلة مكسورةٌ من أوّل يوم.', v_bad;
  END IF;

  -- ── (ج) المحور الثاني: كلّ صنف ──────────────────────────────────────────
  SELECT count(*) INTO v_bad
    FROM public.deals d, jsonb_array_elements(d.variants) e
   WHERE d.variants IS NOT NULL AND jsonb_typeof(d.variants)='array'
     AND (e ? 'onHand') AND (e ? 'qty')
     AND (e->>'qty')::int <> GREATEST(0, (e->>'onHand')::int
            - public.taki_open_holds(d.id, e->>'id', NULL));
  IF v_bad > 0 THEN RAISE EXCEPTION '❌ % صنفاً متاحُه ≠ (كامله − محجوزه).', v_bad; END IF;

  -- ── (د) المحور الثالث: كلّ فرع ──────────────────────────────────────────
  SELECT count(*) INTO v_bad
    FROM public.deals d, jsonb_array_elements(d.locations) e
   WHERE d.loc_qty_mode='per_location' AND jsonb_typeof(d.locations)='array'
     AND (e ? 'onHand') AND (e ? 'quantity')
     AND (e->>'quantity')::int <> GREATEST(0, (e->>'onHand')::int
            - public.taki_open_holds(d.id, NULL, e->>'id'));
  IF v_bad > 0 THEN RAISE EXCEPTION '❌ % فرعاً متاحُه ≠ (كامله − محجوزه).', v_bad; END IF;

  -- ── (هـ) المحور الرابع: صنفٌ داخل فرع ───────────────────────────────────
  SELECT count(*) INTO v_bad
    FROM public.deals d, jsonb_array_elements(d.locations) e, jsonb_each(e->'variantQtys') vq
   WHERE d.loc_qty_mode='per_location' AND jsonb_typeof(d.locations)='array'
     AND (e ? 'variantOnHand') AND ((e->'variantOnHand') ? vq.key)
     AND (vq.value #>> '{}')::int <> GREATEST(0, (e->'variantOnHand'->>vq.key)::int
            - public.taki_open_holds(d.id, vq.key, e->>'id'));
  IF v_bad > 0 THEN RAISE EXCEPTION '❌ % (صنف×فرع) متاحُه ≠ (كامله − محجوزه).', v_bad; END IF;

  -- ── (و) غيرُ المحدود يبقى بلا كامل ──────────────────────────────────────
  SELECT count(*) INTO v_bad FROM public.deals
   WHERE COALESCE(is_unlimited,false) AND on_hand IS NOT NULL;
  IF v_bad > 0 THEN
    RAISE EXCEPTION '❌ % عرضاً بلا حدّ أُعطي كاملاً — وصفرٌ منه يعني «نفد».', v_bad;
  END IF;

  -- ── (ز) وكلُّ عرضٍ محدودٍ صار له كامل ───────────────────────────────────
  SELECT count(*) INTO n FROM public.deals
   WHERE on_hand IS NULL AND COALESCE(is_unlimited,false)=false AND quantity IS NOT NULL;
  IF n > 0 THEN RAISE EXCEPTION '❌ % عرضاً محدوداً بلا كاملٍ بعد التهيئة.', n; END IF;

  -- ── (ح) قياسٌ سلوكيّ على صفٍّ حقيقي بأصناف، ثمّ يُعاد حرفياً ────────────
  SELECT d.id, d.quantity, d.on_hand, d.variants INTO v_id, v_q, v_oh, v_var
    FROM public.deals d
   WHERE d.on_hand IS NOT NULL AND d.variants IS NOT NULL
     AND jsonb_array_length(COALESCE(d.variants,'[]'::jsonb)) > 0
   ORDER BY d.id LIMIT 1;
  IF v_id IS NULL THEN
    SELECT d.id, d.quantity, d.on_hand, d.variants INTO v_id, v_q, v_oh, v_var
      FROM public.deals d WHERE d.on_hand IS NOT NULL ORDER BY d.id LIMIT 1;
  END IF;

  IF v_id IS NOT NULL THEN
    -- الكتابةُ تشتقّ المتاح
    v_res := public.taki_set_on_hand(v_id, v_oh + 7, NULL, NULL, now(), 'verify');
    IF NOT COALESCE((v_res->>'ok')::boolean,false) THEN
      RAISE EXCEPTION '❌ الكتابة فشلت: %', v_res::text;
    END IF;
    IF (v_res->>'available')::int
       <> GREATEST(0, (v_oh + 7) - public.taki_open_holds(v_id, NULL, NULL)) THEN
      RAISE EXCEPTION '❌ المتاح المحسوب خاطئ: %', v_res::text;
    END IF;

    -- والصنفُ يُشتقّ بمفرده
    v_vid := v_var->0->>'id';
    IF v_vid IS NOT NULL AND (v_var->0 ? 'onHand') THEN
      v_res := public.taki_set_on_hand(v_id, NULL,
                 jsonb_build_array(jsonb_build_object('id', v_vid, 'onHand', 3)),
                 NULL, now(), 'verify');
      SELECT (e->>'qty')::int INTO n FROM public.deals d,
             jsonb_array_elements(d.variants) e WHERE d.id=v_id AND e->>'id'=v_vid;
      IF n <> GREATEST(0, 3 - public.taki_open_holds(v_id, v_vid, NULL)) THEN
        RAISE EXCEPTION '❌ متاحُ الصنف لم يُشتقّ من كامله (صار %).', n;
      END IF;
    END IF;

    -- والملاحظةُ الأقدم تُهمَل — لا تدهس
    v_res := public.taki_set_on_hand(v_id, 99999, NULL, NULL, now() - interval '1 hour', 'verify');
    IF COALESCE(v_res->>'skipped','') <> 'STALE_OBSERVATION' THEN
      RAISE EXCEPTION '❌ ملاحظةٌ أقدم دهست أحدثَ منها — ترتيبُ الرسائل غيرُ محميّ: %', v_res::text;
    END IF;

    -- الاستعادة الحرفية
    PERFORM public.taki_set_on_hand(v_id, v_oh, NULL, NULL, now(), 'init');
    UPDATE public.deals SET variants = v_var WHERE id = v_id;
    SELECT quantity INTO n FROM public.deals WHERE id = v_id;
    IF n IS DISTINCT FROM v_q THEN
      RAISE EXCEPTION '❌ العرض % لم يعد إلى متاحه (% ≠ %).', v_id, n, v_q;
    END IF;
    RAISE NOTICE '✅ سلوكيّاً على صفٍّ حقيقي (%): المتاح مشتقّ · الصنف مشتقّ · الأقدم مُهمَل · الصفّ أُعيد.', v_id;
  END IF;

  -- ── (ط) والحارسُ ضدّ البيع الزائد لم يُمسّ ──────────────────────────────
  -- 🔴 تصحيحُ اعتقادٍ كان عندي: `tr_reserve_booking_stock` **لا يقفل الصفّ**
  --    (`SELECT … INTO` عارٍ بلا `FOR UPDATE`) — وقِيس: صفرُ دالّةٍ تمسّ
  --    `deals` فيها `FOR UPDATE` قبل هذه الهجرة. فذلك المشغّل فحصٌ مسبقٌ
  --    لطيفٌ يعطي رسالةً مفهومة، لا حَكَم.
  --    والحَكَمُ الحقيقيّ في `adjust_deal_quantity`: **مقارنةٌ وتبديلٌ في
  --    عبارةٍ واحدة** (`SET quantity = quantity - n WHERE quantity >= n`
  --    ثمّ `ROW_COUNT = 0 ⇒ P0010`). وهي ذرّيّةٌ بحكم قفل العبارة نفسها:
  --    المتزامنُ يَحجُب ثمّ يُعيد تقييم الشرط على النسخة الجديدة.
  --    ولذلك تُحرَس **الصيغة** لا كلمةُ القفل — ولو أُبدلت بقراءةٍ ثمّ
  --    كتابةٍ منفصلتين لعاد البيعُ الزائد صامتاً.
  IF pg_get_functiondef('public.adjust_deal_quantity()'::regprocedure)
       !~ 'SET quantity = quantity - v_need[\s]*\n?[\s]*WHERE id = NEW\.deal_id AND quantity >= v_need' THEN
    RAISE EXCEPTION '❌ عدّادُ المتاح فقد «المقارنة والتبديل» — البيعُ الزائد يعود بلا صوت.';
  END IF;
  IF position('P0010' IN pg_get_functiondef('public.adjust_deal_quantity()'::regprocedure)) = 0
     OR position('P0010' IN pg_get_functiondef('public.tr_reserve_booking_stock()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '❌ أحدُ مشغّلَي المخزون فقد رفضَه (P0010).';
  END IF;
  -- وكاتبُنا نحن يقفل الصفّ فعلاً — فهو يقرأ المحجوز ثمّ يكتب المشتقّ منه
  IF position('FOR UPDATE' IN pg_get_functiondef(
       'public.taki_set_on_hand(text,integer,jsonb,jsonb,timestamptz,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '❌ كاتبُ المخزون بلا قفل — نداءان يقرآن نفس المحجوز فيبيعان ما لا يوجد.';
  END IF;

  RAISE NOTICE '✅ v15.02: الكامل للتاجر · المتاح مشتقّ على أربعة محاور · البيعُ ينقص الكامل · وأثرُ الهبوط صفر.';
END
$verify$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٩) لوحُ الحال — للقراءة وحدها (التحقّق أعلاه هو الحَكَم)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT 'خادم' AS بند, current_setting('server_version') AS قيمة,
       COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'جدة/الإنتاج') AS ملاحظة
UNION ALL SELECT 'عروضٌ لها كامل', count(*)::text, 'من ' || (SELECT count(*) FROM public.deals)::text
  FROM public.deals WHERE on_hand IS NOT NULL
UNION ALL SELECT 'عروضٌ بلا حدّ', count(*)::text, 'تُركت بلا كامل عمداً'
  FROM public.deals WHERE COALESCE(is_unlimited,false)
UNION ALL SELECT 'المحجوز الآن', COALESCE(sum(public.taki_open_holds(id,NULL,NULL)),0)::text, 'مجموع كل العروض'
  FROM public.deals;
