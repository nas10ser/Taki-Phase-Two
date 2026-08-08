-- ═══════════════════════════════════════════════════════════════════════════
-- TAKI — v13.81 — حجز الكمية **ذرّياً** تحت أي ضغط  (خادم جدة)
--
-- طلب ناصر حرفياً: «مليون يريدون عرضاً كميته ١٠٠ في نفس اللحظة — الأولوية
-- لأول ١٠٠ بدقة عالية جداً». هذا الملف يحقّق ذلك، ويشرح لماذا كان التصميم
-- السابق صحيحاً في الحساب لكنه هشّ تحت الضغط.
--
-- ── ما كان ──────────────────────────────────────────────────────────────
--  BEFORE INSERT:  SELECT * FROM deals WHERE id = ? FOR UPDATE  ← قفل الصفّ
--                  ثم فحص الكمية ورفض إن لم تكفِ.
--  AFTER  INSERT:  UPDATE deals SET quantity = GREATEST(0, quantity - n)
--
--  الحساب سليم (القفل يُسلسِل المتزامنين فلا يُباع ما لا يوجد)، لكن فيه
--  عيبين قاتلين عند الضغط الحقيقي:
--
--  (١) **كل** طالب يقف في طابور القفل — حتى بعد نفاد الكمية. مليون طلب على
--      عرض نفد يعني مليون اتصال ينتظر قفلاً على صفّ واحد؛ والقاعدة تنهار من
--      استنفاد الاتصالات لا من الحساب. الرافض يجب أن يُرفض **قبل** الطابور.
--  (٢) `GREATEST(0, …)` يبتلع الخطأ: لو تسرّب حجز فوق الكمية لأي سبب، يصير
--      المخزون صفراً بصمت بدل أن يفشل الحجز. البيع الزائد يجب أن **يفشل**،
--      لا أن يُقرَّب إلى صفر.
--
-- ── ما صار ──────────────────────────────────────────────────────────────
--  BEFORE INSERT (بلا قفل إطلاقاً): قراءة عادية + رفض فوري للحالات البيّنة
--      (العرض غير موجود / غير نشط / نفدت كميته). هذه وحدها تُبعد ٩٩٫٩٪ من
--      المليون عن طابور القفل — لا تلمس القفل ولا تؤخّر أحداً.
--      + `lock_timeout` قصير: معاملة متعثّرة لا تُجمّد طابور العرض كله.
--
--  AFTER INSERT — **الحَكَم الوحيد**: تحقّق وخصم في **عبارة واحدة**:
--      UPDATE deals SET quantity = quantity - n
--       WHERE id = ? AND quantity >= n
--      العبارة الواحدة تأخذ قفل الصفّ بنفسها، وتُعيد تقييم الشرط على **آخر
--      نسخة ملتزمة** بعد انتظارها (READ COMMITTED)، فإن لم تعد الكمية تكفي
--      رجعت بصفر صفوف ⇒ نرفع خطأً ⇒ تتراجع المعاملة كاملة.
--      النتيجة: **أول ١٠٠ بترتيب وصولهم للقفل ينجحون، والباقي يُرفض — مهما
--      بلغ عددهم، وبلا احتمال بيع زائد واحد.**
--      لا `GREATEST` ولا تقريب: العرض المسقوف يخصم بالضبط أو يفشل.
--
--  ونفس المبدأ طُبِّق على المستويات الثلاثة الأخرى (كمية الفرع، كمية النوع،
--  خلية نوع×فرع): كلها صارت «تحقّق وخصم في عبارة واحدة» بدل «افحص ثم اخصم».
--
--  ملاحظة: الخلية الغائبة أو الفارغة تعني «بلا سقف» — تمرّ بلا خصم، كما كان.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- ١) BEFORE INSERT — بوّاب سريع بلا قفل
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tr_reserve_booking_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_deal   deals%ROWTYPE;
  v_sel    jsonb;
  v_var    jsonb;
  v_need   int;
  v_avail  int;
  v_bname  text;
  v_capped boolean;
BEGIN
  -- معاملة متعثّرة على صفّ العرض يجب ألا تُجمّد كل من خلفها: بعد ٥ ثوانٍ
  -- ننسحب بخطأ نظيف بدل انتظار بلا نهاية. (يسري على هذه المعاملة وحدها.)
  SET LOCAL lock_timeout = '5s';

  v_need := GREATEST(COALESCE(NEW.booked_quantity, 1), 1);

  -- قراءة **بلا** FOR UPDATE: هذه بوّابة رفضٍ سريعة لا مصدر حقيقة. الحقيقة
  -- تُحسم في الخصم الذرّي بعد الإدراج.
  SELECT * INTO v_deal FROM deals WHERE id = NEW.deal_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'العرض لم يعد موجوداً' USING ERRCODE = 'P0010';
  END IF;

  IF v_deal.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'DEAL_NOT_ACTIVE' USING ERRCODE = 'P0010';
  END IF;

  v_capped := NOT COALESCE(v_deal.is_unlimited, false)
              AND COALESCE(v_deal.initial_quantity, 0) > 0;

  -- ١) الكمية العامة
  IF v_capped AND COALESCE(v_deal.quantity, 0) < v_need THEN
    RAISE EXCEPTION 'نفدت الكمية — سبقك مشترون آخرون إليها (المتاح الآن: %)',
      GREATEST(COALESCE(v_deal.quantity, 0), 0) USING ERRCODE = 'P0010';
  END IF;

  -- ٢) كمية الفرع المختار (وضع «كمية لكل موقع») — الفرع بلا حقل quantity = مفتوح
  IF NEW.location_id IS NOT NULL
     AND v_deal.loc_qty_mode = 'per_location'
     AND v_deal.locations IS NOT NULL AND jsonb_typeof(v_deal.locations) = 'array' THEN
    SELECT NULLIF(e->>'quantity','')::int, COALESCE(NULLIF(e->>'name',''), 'الفرع')
      INTO v_avail, v_bname
      FROM jsonb_array_elements(v_deal.locations) e
     WHERE e->>'id' = NEW.location_id
     LIMIT 1;
    IF v_avail IS NOT NULL AND v_avail < v_need THEN
      RAISE EXCEPTION 'نفدت كمية «%» — المتاح الآن بهذا الفرع: %',
        v_bname, GREATEST(v_avail, 0) USING ERRCODE = 'P0010';
    END IF;
  END IF;

  -- ٣) كمية النسخة العامة (variants[].qty)
  IF v_deal.variants IS NOT NULL AND jsonb_typeof(v_deal.variants) = 'array'
     AND NEW.selected_options IS NOT NULL AND jsonb_typeof(NEW.selected_options) = 'array' THEN
    FOR v_sel IN SELECT * FROM jsonb_array_elements(NEW.selected_options) LOOP
      CONTINUE WHEN v_sel->>'g' IS DISTINCT FROM '__variant__';
      SELECT e INTO v_var FROM jsonb_array_elements(v_deal.variants) e
       WHERE e->>'id' = v_sel->>'c' LIMIT 1;
      CONTINUE WHEN v_var IS NULL OR NOT (v_var ? 'qty') OR NULLIF(v_var->>'qty','') IS NULL;
      IF (v_var->>'qty')::int < GREATEST(COALESCE((v_sel->>'qty')::int, 1), 1) THEN
        RAISE EXCEPTION 'نفدت كمية «%» — المتاح الآن: %',
          COALESCE(v_var->>'label', 'هذا النوع'), GREATEST((v_var->>'qty')::int, 0)
          USING ERRCODE = 'P0010';
      END IF;
    END LOOP;
  END IF;

  -- ٤) خلية «نوع×فرع» (locations[].variantQtys[variant]) — الغائبة = مفتوحة
  IF NEW.location_id IS NOT NULL
     AND v_deal.loc_qty_mode = 'per_location'
     AND v_deal.locations IS NOT NULL AND jsonb_typeof(v_deal.locations) = 'array'
     AND NEW.selected_options IS NOT NULL AND jsonb_typeof(NEW.selected_options) = 'array' THEN
    FOR v_sel IN SELECT * FROM jsonb_array_elements(NEW.selected_options) LOOP
      CONTINUE WHEN v_sel->>'g' IS DISTINCT FROM '__variant__';
      SELECT NULLIF(e->'variantQtys'->>(v_sel->>'c'),'')::int
        INTO v_avail
        FROM jsonb_array_elements(v_deal.locations) e
       WHERE e->>'id' = NEW.location_id AND (e ? 'variantQtys')
       LIMIT 1;
      IF v_avail IS NOT NULL AND v_avail < GREATEST(COALESCE((v_sel->>'qty')::int, 1), 1) THEN
        RAISE EXCEPTION 'نفد هذا النوع في الفرع المختار — المتاح الآن: %',
          GREATEST(v_avail, 0) USING ERRCODE = 'P0010';
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$function$;

-- ───────────────────────────────────────────────────────────────────────────
-- ٢) AFTER INSERT/UPDATE — الحَكَم: تحقّق وخصم في عبارة واحدة
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.adjust_deal_quantity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sel    jsonb;
  v_dir    int;
  v_need   int;
  v_rows   int;
  v_capped boolean;
BEGIN
    v_need := GREATEST(COALESCE(NEW.booked_quantity, 1), 1);

    IF TG_OP = 'INSERT' THEN
        v_dir := -1;
    ELSIF TG_OP = 'UPDATE' AND NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
        v_dir := 1;
    ELSE
        RETURN NEW;
    END IF;

    SELECT NOT COALESCE(d.is_unlimited, false) AND COALESCE(d.initial_quantity, 0) > 0
      INTO v_capped FROM deals d WHERE d.id = NEW.deal_id;

    -- ── الكمية العامة ──────────────────────────────────────────────────
    IF v_dir = -1 THEN
        IF COALESCE(v_capped, false) THEN
            -- 🔒 الحجز الذرّي: الشرط والخصم في عبارة واحدة. صفر صفوف = سبقك
            -- غيرك إلى آخر قطعة ⇒ نرفع فتتراجع المعاملة كاملة (ولا يُسجَّل حجز).
            UPDATE deals SET quantity = quantity - v_need
             WHERE id = NEW.deal_id AND quantity >= v_need;
            GET DIAGNOSTICS v_rows = ROW_COUNT;
            IF v_rows = 0 THEN
                RAISE EXCEPTION 'نفدت الكمية — سبقك مشترون آخرون إليها'
                    USING ERRCODE = 'P0010';
            END IF;
        ELSE
            -- عرض زمني/بلا سقف: العدّاد إرشادي فقط — يُقرَّب عند الصفر ولا يمنع.
            UPDATE deals SET quantity = GREATEST(0, COALESCE(quantity, 0) - v_need)
             WHERE id = NEW.deal_id AND COALESCE(is_unlimited, false) = FALSE;
        END IF;
    ELSE
        UPDATE deals SET quantity = COALESCE(quantity, 0) + v_need
         WHERE id = NEW.deal_id AND COALESCE(is_unlimited, false) = FALSE;
    END IF;

    -- ── كمية النسخة (variants[].qty) — تحقّق وخصم في عبارة واحدة ────────
    IF NEW.selected_options IS NOT NULL AND jsonb_typeof(NEW.selected_options) = 'array' THEN
      FOR v_sel IN SELECT * FROM jsonb_array_elements(NEW.selected_options) LOOP
        CONTINUE WHEN v_sel->>'g' IS DISTINCT FROM '__variant__';
        UPDATE deals d SET variants = (
          SELECT jsonb_agg(
            CASE WHEN e->>'id' = v_sel->>'c' AND (e ? 'qty') AND NULLIF(e->>'qty','') IS NOT NULL
                 THEN jsonb_set(e, '{qty}', to_jsonb(GREATEST(0,
                        (e->>'qty')::int + v_dir * GREATEST(COALESCE((v_sel->>'qty')::int,1),1))))
                 ELSE e END)
          FROM jsonb_array_elements(d.variants) e)
        WHERE d.id = NEW.deal_id
          AND d.variants IS NOT NULL AND jsonb_typeof(d.variants) = 'array'
          -- عند الخصم فقط: الخلية المسقوفة يجب أن تكفي وقت الكتابة نفسها.
          AND (v_dir = 1 OR COALESCE((
                SELECT NULLIF(e2->>'qty','')::int FROM jsonb_array_elements(d.variants) e2
                 WHERE e2->>'id' = v_sel->>'c' LIMIT 1), 2147483647)
              >= GREATEST(COALESCE((v_sel->>'qty')::int,1),1));
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        IF v_dir = -1 AND v_rows = 0
           AND EXISTS (SELECT 1 FROM deals d2
                        WHERE d2.id = NEW.deal_id
                          AND d2.variants IS NOT NULL
                          AND jsonb_typeof(d2.variants) = 'array') THEN
            RAISE EXCEPTION 'نفدت كمية النوع المختار — سبقك مشترون آخرون إليه'
                USING ERRCODE = 'P0010';
        END IF;
      END LOOP;
    END IF;

    -- ── كمية الفرع (locations[].quantity) — تحقّق وخصم في عبارة واحدة ───
    IF NEW.location_id IS NOT NULL THEN
      UPDATE deals d SET locations = (
        SELECT jsonb_agg(
          CASE WHEN e->>'id' = NEW.location_id AND (e ? 'quantity') AND NULLIF(e->>'quantity','') IS NOT NULL
               THEN jsonb_set(e, '{quantity}', to_jsonb(GREATEST(0,
                      (e->>'quantity')::int + v_dir * v_need)))
               ELSE e END)
        FROM jsonb_array_elements(d.locations) e)
      WHERE d.id = NEW.deal_id
        AND d.loc_qty_mode = 'per_location'
        AND d.locations IS NOT NULL AND jsonb_typeof(d.locations) = 'array'
        AND (v_dir = 1 OR COALESCE((
              SELECT NULLIF(e2->>'quantity','')::int FROM jsonb_array_elements(d.locations) e2
               WHERE e2->>'id' = NEW.location_id LIMIT 1), 2147483647) >= v_need);
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_dir = -1 AND v_rows = 0
         AND EXISTS (SELECT 1 FROM deals d2
                      WHERE d2.id = NEW.deal_id AND d2.loc_qty_mode = 'per_location'
                        AND d2.locations IS NOT NULL AND jsonb_typeof(d2.locations) = 'array') THEN
          RAISE EXCEPTION 'نفدت كمية هذا الفرع — سبقك مشترون آخرون إليها'
              USING ERRCODE = 'P0010';
      END IF;
    END IF;

    -- ── خلية «نوع×فرع» (locations[].variantQtys[variant]) ──────────────
    IF NEW.location_id IS NOT NULL
       AND NEW.selected_options IS NOT NULL AND jsonb_typeof(NEW.selected_options) = 'array' THEN
      FOR v_sel IN SELECT * FROM jsonb_array_elements(NEW.selected_options) LOOP
        CONTINUE WHEN v_sel->>'g' IS DISTINCT FROM '__variant__';
        UPDATE deals d SET locations = (
          SELECT jsonb_agg(
            CASE WHEN e->>'id' = NEW.location_id
                  AND (e ? 'variantQtys')
                  AND ((e->'variantQtys') ? (v_sel->>'c'))
                  AND NULLIF(e->'variantQtys'->>(v_sel->>'c'),'') IS NOT NULL
                 THEN jsonb_set(e, ARRAY['variantQtys', v_sel->>'c'], to_jsonb(GREATEST(0,
                        (e->'variantQtys'->>(v_sel->>'c'))::int + v_dir * GREATEST(COALESCE((v_sel->>'qty')::int,1),1))))
                 ELSE e END)
          FROM jsonb_array_elements(d.locations) e)
        WHERE d.id = NEW.deal_id
          AND d.loc_qty_mode = 'per_location'
          AND d.locations IS NOT NULL AND jsonb_typeof(d.locations) = 'array'
          AND (v_dir = 1 OR COALESCE((
                SELECT NULLIF(e2->'variantQtys'->>(v_sel->>'c'),'')::int
                  FROM jsonb_array_elements(d.locations) e2
                 WHERE e2->>'id' = NEW.location_id AND (e2 ? 'variantQtys') LIMIT 1), 2147483647)
              >= GREATEST(COALESCE((v_sel->>'qty')::int,1),1));
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        IF v_dir = -1 AND v_rows = 0
           AND EXISTS (SELECT 1 FROM deals d2
                        WHERE d2.id = NEW.deal_id AND d2.loc_qty_mode = 'per_location'
                          AND d2.locations IS NOT NULL AND jsonb_typeof(d2.locations) = 'array') THEN
            RAISE EXCEPTION 'نفد هذا النوع في الفرع المختار — سبقك مشترون آخرون إليه'
                USING ERRCODE = 'P0010';
        END IF;
      END LOOP;
    END IF;

    RETURN NEW;
END;
$function$;

COMMIT;
