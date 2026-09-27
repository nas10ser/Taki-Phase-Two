-- ═══════════════════════════════════════════════════════════════════════════
-- v15.05 — ثلاثةُ أعطالٍ أحدثها v15.03 في البوتين، وحارسٌ غيرُ آمنٍ للعدم
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 لم تُكتشف هذه بالنظر بل بقياسٍ متوازٍ على الإنتاج بعد شحن v15.03 بساعات.
--    وكلُّها من نوعٍ واحد: **غيّرتُ دلالةَ رقمٍ في القاعدة ولم أُلاحق كلَّ من
--    يكتبه.** الموقعُ لوحِق (v15.04)، والبوتان لا.
--
-- العطل ١ — إعادةُ التفعيل تُحيي بضاعةً مباعة.
--   `bot_update_deal` عند إعادة تفعيل عرضٍ منتهٍ يكتب
--       quantity = COALESCE(initial_quantity, quantity)
--   وهي كتابةٌ مباشرة (عمق ١)، فيقرؤها `tr_b0_stock_declare` **إعلانَ مخزونٍ
--   كامل**. قِيس على عرضٍ حيّ: المخزون الكامل قفز من ١ إلى ١٠ — أي تسعُ قطعٍ
--   بيعت فعلاً عادت للبيع. والفجوةُ قائمةٌ في الكتالوج: عرضٌ كامله ٧٩ وأصله
--   ١٣٥، وآخر ٣٢ مقابل ٤٢.
--   والصواب: إعادةُ التفعيل تُغيّر **الحالة** لا المخزون. من أراد بضاعةً
--   جديدة يُعلنها صراحةً — فإحياءُ رقمٍ قديم تخمينٌ باسم التاجر.
--
-- العطل ٢ — «٠» تعني «بلا حدّ» لا «نفد».
--   `is_unlimited = … WHEN p_quantity IS NOT NULL THEN (p_quantity = 0)`.
--   فتاجرٌ يكتب صفراً ليقول «خلص» يجعل عرضه **لا نهائياً**، و
--   `tr_b0_stock_declare` يُفرّغ كامله إلى NULL. وهذا بالضبط ما يفعله أيُّ
--   مفتاح «نفد» يُكتب بالطريقة البديهية — فيُغلق البابُ قبل أن يُفتح.
--
-- العطل ٣ — البوت يعرض «المتاح» ويطلب من التاجر كتابته.
--   `bot_get_seller_deal`/`bot_get_seller_deals` لا تُرجعان `on_hand` إطلاقاً،
--   فيرى التاجرُ المتاحَ مكتوباً «الكمية الحالية»، ويكتبه، فينكمش مخزونه
--   الكامل بمقدار المحجوز عند **كلّ** تعديل. وهو عيبُ v15.04 نفسه، باقياً في
--   البوتين. ولا يُصلَح بالنصّ وحده: لا بدّ أن يصل الرقمُ الصحيح أوّلاً.
--
-- العطل ٤ — حارسٌ ينهار أمام NULL.
--   `IF NEW.status <> 'completed' OR OLD.status = 'completed'` يُعطي NULL حين
--   تكون الحالة NULL (والعمود يقبل NULL، وقيدُ CHECK يمرّره)، وNULL ليست
--   TRUE فلا يُنفَّذ الخروج المبكّر ⇒ **يُنقص المخزون لحجزٍ لم يكتمل**.
--   تُكتب بـ`IS DISTINCT FROM` التي لا تعرف NULL.
-- ═══════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر. أوقِفت.';
  END IF;
  IF to_regprocedure('public.taki_set_on_hand(text,integer,jsonb,jsonb,timestamptz,text)') IS NULL THEN
    RAISE EXCEPTION 'v15.02/03 غير مطبَّقتين — أوقِفت.';
  END IF;
END
$guard$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ١) الحارس يصير آمناً أمام العدم
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.tr_on_hand_on_sale()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_need int; v_sel jsonb;
BEGIN
  -- 🪤 `<>` و`=` كلاهما يُعطي NULL أمام NULL، وNULL ليست TRUE فلا يقع الخروج
  --    المبكّر ⇒ كان يُنقص المخزون لحجزٍ حالتُه NULL. و`IS DISTINCT FROM`
  --    لا تعرف NULL فتُجيب دائماً TRUE أو FALSE.
  IF NEW.status IS DISTINCT FROM 'completed' THEN RETURN NEW; END IF;
  IF OLD.status IS NOT DISTINCT FROM 'completed' THEN RETURN NEW; END IF;

  v_need := GREATEST(COALESCE(NEW.booked_quantity, 1), 1);

  UPDATE public.deals
     SET on_hand = GREATEST(0, on_hand - v_need),
         stock_observed_at = now(), stock_source = 'sale'
   WHERE id = NEW.deal_id AND on_hand IS NOT NULL
     AND COALESCE(is_unlimited, false) = false;

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

-- ═══════════════════════════════════════════════════════════════════════════
-- ٢) bot_update_deal — رقعتان من النصّ الحيّ
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 من النصّ الحيّ لا من نسخةٍ في الهجرة: الدالّة ٢٢ معامِلاً وتحمل منطقَ
--    حدودٍ وجدولةٍ وصورٍ لا علاقة له بالمخزون، وإعادةُ كتابتها تدهس ما لا أعلمه.
DO $patch$
DECLARE src text; src0 text;
BEGIN
  src := pg_get_functiondef('public.bot_update_deal(bigint,text,text,numeric,numeric,integer,text,text,text,text,text,text,integer,bigint,boolean,boolean,text[],text,text,integer,integer,integer)'::regprocedure);
  src0 := src;

  -- (أ) «٠» لم تعد تعني «بلا حدّ»
  IF position('WHEN p_quantity IS NOT NULL THEN (p_quantity = 0)' IN src) = 0 THEN
    RAISE EXCEPTION '❌ مرساة «صفر = بلا حدّ» غير موجودة — الدالّة تغيّرت. أوقِفت بدل الرقع الأعمى.';
  END IF;
  src := replace(src,
    'WHEN p_quantity IS NOT NULL THEN (p_quantity = 0)',
    'WHEN p_quantity IS NOT NULL THEN false  -- v15.05: صفرٌ يعني «نفد» لا «بلا حدّ»');

  -- (ب) إعادةُ التفعيل تغيّر الحالة وحدها
  -- 🪤 تُحذف الجملةُ بتعبيرٍ نمطيّ لا بمطابقةٍ حرفية: المسافاتُ في مُخرَج
  --    `pg_get_functiondef` ليست عقداً، ومطابقةٌ حرفية تفشل بصمت لو تغيّرت.
  IF position('COALESCE(initial_quantity, quantity)' IN src) = 0 THEN
    RAISE EXCEPTION '❌ مرساة إعادة التفعيل غير موجودة — أوقِفت.';
  END IF;
  src := regexp_replace(src,
    ',[[:space:]]*quantity[[:space:]]*=[[:space:]]*CASE WHEN is_unlimited THEN NULL ELSE COALESCE\(initial_quantity, quantity\) END',
    '');

  IF src = src0 THEN RAISE EXCEPTION '❌ لم تقع أيُّ رقعة — `replace` على نصٍّ غائب لا يُخطئ.'; END IF;
  EXECUTE src;

  -- والتحقّق من وقوع الحقن فعلاً، لا من عدد الاستبدالات
  src := pg_get_functiondef('public.bot_update_deal(bigint,text,text,numeric,numeric,integer,text,text,text,text,text,text,integer,bigint,boolean,boolean,text[],text,text,integer,integer,integer)'::regprocedure);
  IF position('(p_quantity = 0)' IN src) > 0 THEN
    RAISE EXCEPTION '❌ «صفر = بلا حدّ» ما زالت في النصّ.';
  END IF;
  IF position('COALESCE(initial_quantity, quantity)' IN src) > 0 THEN
    RAISE EXCEPTION '❌ إعلانُ initial_quantity ما زال في النصّ.';
  END IF;
END
$patch$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٣) البوتان يريان المخزون الكامل (وأصنافه وفروعه)
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 إضافةٌ لا تبديل: الحمولة `jsonb_build_object` صريحة، فالمفاتيح القائمة
--    تبقى كما هي وأيُّ قارئٍ حاليّ لا ينكسر.
DO $patch2$
DECLARE src text; src0 text;
BEGIN
  -- (أ) بطاقةُ العرض الواحد: الكامل + الأصناف + الفروع (الدرجة ٠ تحتاجها كلّها)
  src := pg_get_functiondef('public.bot_get_seller_deal(bigint,text,text)'::regprocedure);
  IF position('on_hand' IN src) = 0 THEN
    src0 := src;
    -- 🪤 نصٌّ عاديّ لا E-string: `\1` مرجعٌ خلفيّ كما هو بلا مضاعفة.
    src := regexp_replace(src,
      '''quantity'', ([A-Za-z_]+)\.quantity,',
      '''quantity'', \1.quantity, ''on_hand'', \1.on_hand, ''variants'', \1.variants, ''locations'', \1.locations, ''loc_qty_mode'', \1.loc_qty_mode,');
    IF src = src0 THEN RAISE EXCEPTION '❌ الحقن لم يقع في bot_get_seller_deal.'; END IF;
    EXECUTE src;
    RAISE NOTICE '✅ bot_get_seller_deal: الكامل + الأصناف + الفروع.';
  END IF;

  -- (ب) قائمةُ العروض: الكامل وحده — والأصنافُ والفروع تُثقل بطاقةَ قائمة
  --     بلا فائدة، وسقفُ رسالة البوت يُقاس بالحروف لا بالنيّة.
  src := pg_get_functiondef('public.bot_get_seller_deals(bigint,text)'::regprocedure);
  IF position('on_hand' IN src) = 0 THEN
    src0 := src;
    src := replace(src, '''quantity'', quantity, ''is_unlimited''',
                        '''quantity'', quantity, ''on_hand'', on_hand, ''is_unlimited''');
    IF src = src0 THEN RAISE EXCEPTION '❌ الحقن لم يقع في bot_get_seller_deals — المرساة تغيّرت.'; END IF;
    EXECUTE src;
    RAISE NOTICE '✅ bot_get_seller_deals: الكامل.';
  END IF;

  IF position('on_hand' IN pg_get_functiondef('public.bot_get_seller_deal(bigint,text,text)'::regprocedure)) = 0
     OR position('on_hand' IN pg_get_functiondef('public.bot_get_seller_deals(bigint,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '❌ إحدى الدالّتين ما زالت بلا on_hand بعد التنفيذ.';
  END IF;
END
$patch2$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٤) تحقّقٌ يرفع استثناءً
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 والسلوكيُّ منه (نداءُ `bot_update_deal` بهويّة تاجرٍ حقيقيّ) في
--    `supabase/proof_v15_05_bot_stock.sql` داخل معاملةٍ تُلغى — فلا تُعدَّل
--    عروضُ تاجرٍ حيّ داخل هجرة.
DO $verify$
DECLARE src text; n int;
BEGIN
  -- (أ) «صفر = بلا حدّ» زالت، وإعلانُ initial_quantity زال
  src := pg_get_functiondef('public.bot_update_deal(bigint,text,text,numeric,numeric,integer,text,text,text,text,text,text,integer,bigint,boolean,boolean,text[],text,text,integer,integer,integer)'::regprocedure);
  src := regexp_replace(src, '--[^\n]*', '', 'g');   -- 🪤 التعليقُ يشرحُ العيب فلا يُفحص
  IF position('(p_quantity = 0)' IN src) > 0 THEN
    RAISE EXCEPTION '❌ «٠ = بلا حدّ» ما زالت — مفتاحُ «نفد» سيجعل العرض لا نهائياً.';
  END IF;
  IF position('COALESCE(initial_quantity, quantity)' IN src) > 0 THEN
    RAISE EXCEPTION '❌ إعادةُ التفعيل ما زالت تُعلن initial_quantity مخزوناً كاملاً.';
  END IF;
  IF position('status     = ''active''' IN src) = 0 THEN
    RAISE EXCEPTION '❌ إعادةُ التفعيل فقدت تغييرَ الحالة نفسه — الرقعة أفسدت الدالّة.';
  END IF;

  -- (ب) البوتان يريان الكامل
  FOR n IN 1..1 LOOP NULL; END LOOP;
  IF position('on_hand' IN pg_get_functiondef('public.bot_get_seller_deal(bigint,text,text)'::regprocedure)) = 0
     OR position('on_hand' IN pg_get_functiondef('public.bot_get_seller_deals(bigint,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '❌ إحدى دالّتَي جلب عروض التاجر ما زالت بلا on_hand — التاجر يرى المتاح ويكتبه.';
  END IF;
  IF position('variants' IN pg_get_functiondef('public.bot_get_seller_deal(bigint,text,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '❌ الأصناف لا تصل البوت — الدرجة ٠ مستحيلة عليه.';
  END IF;

  -- (ج) الحارس آمنٌ أمام العدم
  src := regexp_replace(pg_get_functiondef('public.tr_on_hand_on_sale()'::regprocedure), '--[^\n]*', '', 'g');
  IF position('IS DISTINCT FROM ''completed''' IN src) = 0
     OR position('IS NOT DISTINCT FROM ''completed''' IN src) = 0 THEN
    RAISE EXCEPTION '❌ حارسُ المشغّل ما زال يقارن بـ<>/= — حالةٌ NULL تُنقص المخزون.';
  END IF;
  -- وبرهانٌ منطقيّ مباشر: التعبير القديم يُعطي NULL، والجديد يُعطي TRUE
  IF (NULL::text <> 'completed') IS NOT NULL THEN
    RAISE EXCEPTION '❌ افتراضي عن NULL خاطئ.';
  END IF;
  IF NOT ((NULL::text IS DISTINCT FROM 'completed')) THEN
    RAISE EXCEPTION '❌ IS DISTINCT FROM لم تُعطِ TRUE أمام NULL.';
  END IF;

  -- (د) ولم يُمسّ ما لا يخصّنا
  IF position('max_bookings_per_buyer' IN pg_get_functiondef('public.bot_update_deal(bigint,text,text,numeric,numeric,integer,text,text,text,text,text,text,integer,bigint,boolean,boolean,text[],text,text,integer,integer,integer)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '❌ الرقعة أسقطت منطق حدود الحجز.';
  END IF;

  -- (هـ) والمعادلة ما زالت سليمة على كل عرض
  SELECT count(*) INTO n FROM public.deals d
   WHERE d.on_hand IS NOT NULL
     AND COALESCE(d.quantity,-1) <> GREATEST(0, d.on_hand - public.taki_open_holds(d.id,NULL,NULL));
  IF n > 0 THEN RAISE EXCEPTION '❌ % عرضاً خرج عن المعادلة.', n; END IF;

  RAISE NOTICE '✅ v15.05: إعادةُ التفعيل لا تُحيي مبيعاً · «٠» تعني نفد · البوتان يريان الكامل · والحارس آمنٌ أمام NULL.';
END
$verify$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٥) لوحُ الحال — والفجوةُ التي خلّفها العطل الأوّل
-- ═══════════════════════════════════════════════════════════════════════════
-- هذه ليست بيانات فاسدة: `initial_quantity` هو ما أعلنه التاجر يوم النشر،
-- و`on_hand` ما بقي بعد البيع. الفرقُ طبيعيّ — لكنّه كان سيُحيا عند أوّل
-- إعادة تفعيلٍ من البوت. يُعرض ليُعلم، لا ليُصلَح.
SELECT id AS العرض, on_hand AS الكامل, initial_quantity AS "الأصلي المعلَن",
       initial_quantity - on_hand AS "كان سيُحيا عند إعادة التفعيل"
  FROM public.deals
 WHERE on_hand IS NOT NULL AND initial_quantity IS NOT NULL
   AND initial_quantity > on_hand
 ORDER BY (initial_quantity - on_hand) DESC;
