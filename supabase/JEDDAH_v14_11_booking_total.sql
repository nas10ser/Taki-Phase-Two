-- ═══════════════════════════════════════════════════════════════════════════
-- JEDDAH_v14_11_booking_total.sql — إجمالي الطلب رقمٌ واحد يكتبه الخادم
--
-- المشكلة التي يعالجها (مقيسة على جدة ١٠ سبتمبر ٢٠٢٦):
--   إجمالي الطلب كان يُحسب في **ثلاثة أمكنة مستقلّة** بثلاث صيغ:
--     ١) الواجهة (DealDetails.tsx) — بضاعة + إضافات + توصيل ⇒ سطر «الإجمالي»
--        داخل حقل الملاحظات النصّي.
--     ٢) دالة الدفع (merchant-pay/index.ts) — بضاعة + إضافات **بلا توصيل**
--        (`grep -c delivery` = صفر). فهي التي تكتب `payment_expected` وتقارن
--        بها المقبوض ⇒ طلبٌ بـ٨٠ بضاعة و١٥ توصيلاً يُقبض عنه ٨٠ ويُختم
--        «مدفوع بالكامل» بينما الفاتورة تقول ٩٥.
--     ٣) الفاتورة (bot_booking_invoice / printInvoice.ts) — تقرأ سطر الملاحظات
--        بتعبير نمطي، فإن غاب (حجوزات البوتين لا تكتبه) سقطت على تقدير.
--   وأيّ صيغة تتغيّر وحدها ⇒ انحرافٌ صامت في المال.
--
-- العلاج: **الرقم في مكان واحد**.
--   ١) `taki_booking_amount()` — الصيغة الوحيدة: نسخٌ مختارة أو سعر×كمية،
--      ثم الإضافات (سعر الخيار × عدد القطع التي اختارته)، ثم رسوم التوصيل.
--   ٢) عمود `bookings.total_amount` يكتبه مشغّل `tr_ae_set_booking_total`
--      لحظة الإدراج — لقطةٌ مجمّدة لما وافق عليه المشتري، فتغيير التاجر
--      لسعر العرض بعدها لا يُغيّر فاتورة طلبٍ قائم.
--   ٣) العميل ممنوع من كتابته أو تعديله (حارس السلامة).
--   ٤) كل مستهلك يقرأ العمود نفسه: الدفع · الفاتورة · البوتان · الموقع.
--
-- 🔵 ملاحظة: العمود يُكتب على **كل** حجز جديد، لا على طلبات التوصيل وحدها،
--    لأن الإضافات (جبنة +٣) كانت تدخل الدفع وتغيب عن فاتورة البوتين.
--
-- آمنة للتكرار (idempotent) — تُنفَّذ مرّات بلا أثر جانبي.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

-- ───────────────────────────────────────────────────────────────────────────
-- حارس الخادم: هذا الملف للإنتاج (جدة) وحده. المختبر (طوكيو) يحمل وسماً.
-- ───────────────────────────────────────────────────────────────────────────
DO $guard$
BEGIN
  IF COALESCE(obj_description('public'::regnamespace, 'pg_namespace'), '')
     LIKE 'TAKI_LAB_TOKYO%' THEN
    RAISE EXCEPTION
      'REFUSED: this migration targets the Jeddah production server, but this database is the Tokyo lab (%).',
      obj_description('public'::regnamespace, 'pg_namespace');
  END IF;
END
$guard$;

BEGIN;

-- ═══ ١) الصيغة الوحيدة ════════════════════════════════════════════════════
-- تُرجع تفصيلاً لا رقماً واحداً، كي يستعملها حارس الحدّ الأدنى للتوصيل
-- (يحتاج قيمة البضاعة وحدها) والدفعُ والفاتورة (يحتاجان الإجمالي).
CREATE OR REPLACE FUNCTION public.taki_booking_amount(
  p_deal_id      text,
  p_quantity     integer,
  p_selected     jsonb,
  p_delivery_fee numeric
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_price   numeric;
  v_opts    jsonb;
  v_vars    jsonb;
  v_sel     jsonb := CASE WHEN jsonb_typeof(COALESCE(p_selected, 'null'::jsonb)) = 'array'
                          THEN p_selected ELSE '[]'::jsonb END;
  v_row     jsonb;
  v_node    jsonb;
  v_base    numeric := 0;
  v_addons  numeric := 0;
  v_variant boolean := false;
  v_dlv     numeric := round(GREATEST(COALESCE(p_delivery_fee, 0), 0), 2);
BEGIN
  SELECT d.discounted_price, d.options, d.variants
    INTO v_price, v_opts, v_vars
    FROM public.deals d WHERE d.id = p_deal_id;

  -- الأساس: مجموع النسخ المختارة (لكلٍّ سعرها)، وإلا سعر العرض × الكمية.
  IF jsonb_typeof(COALESCE(v_vars, 'null'::jsonb)) = 'array' THEN
    FOR v_row IN SELECT * FROM jsonb_array_elements(v_sel) LOOP
      CONTINUE WHEN v_row->>'g' IS DISTINCT FROM '__variant__';
      SELECT e INTO v_node FROM jsonb_array_elements(v_vars) e
        WHERE e->>'id' = v_row->>'c' LIMIT 1;
      CONTINUE WHEN v_node IS NULL;
      v_variant := true;
      v_base := v_base + COALESCE(NULLIF(v_node->>'price','')::numeric, 0)
                       * GREATEST(COALESCE(NULLIF(v_row->>'qty','')::int, 1), 1);
    END LOOP;
  END IF;
  IF NOT v_variant THEN
    v_base := COALESCE(v_price, 0) * GREATEST(COALESCE(p_quantity, 1), 1);
  END IF;

  -- الإضافات: سعر كل خيار × عدد القطع التي اختارته (جبنة +٣ على برغرين = +٦).
  IF jsonb_typeof(COALESCE(v_opts, 'null'::jsonb)) = 'array' THEN
    FOR v_row IN SELECT * FROM jsonb_array_elements(v_sel) LOOP
      CONTINUE WHEN v_row->>'g' = '__variant__';
      SELECT c INTO v_node
        FROM jsonb_array_elements(v_opts) g,
             jsonb_array_elements(CASE WHEN jsonb_typeof(COALESCE(g->'choices','null'::jsonb)) = 'array'
                                       THEN g->'choices' ELSE '[]'::jsonb END) c
       WHERE g->>'id' = v_row->>'g' AND c->>'id' = v_row->>'c' LIMIT 1;
      CONTINUE WHEN v_node IS NULL;
      v_addons := v_addons + COALESCE(NULLIF(v_node->>'price','')::numeric, 0)
                           * GREATEST(COALESCE(NULLIF(v_row->>'qty','')::int, 1), 1);
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'base',     round(v_base, 2),
    'addons',   round(v_addons, 2),
    'goods',    round(v_base + v_addons, 2),
    'delivery', v_dlv,
    'total',    round(v_base + v_addons + v_dlv, 2));
END
$fn$;

-- 🪤 anon يملك تنفيذ كل دالة جديدة في public تلقائياً، و REVOKE FROM PUBLIC
--    لا يُلغيه. الصيغة ليست سرّاً لكنها تقرأ جدول العروض بصلاحية المالك.
REVOKE ALL ON FUNCTION public.taki_booking_amount(text, integer, jsonb, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_booking_amount(text, integer, jsonb, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.taki_booking_amount(text, integer, jsonb, numeric) TO service_role;

-- ═══ ٢) العمود: لقطةٌ مجمّدة لما وافق عليه المشتري ════════════════════════
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS total_amount numeric;

DO $c$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.bookings'::regclass
                    AND conname  = 'bookings_total_amount_sane') THEN
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_total_amount_sane
      CHECK (total_amount IS NULL OR (total_amount >= 0 AND total_amount <= 1000000))
      NOT VALID;   -- NOT VALID: لا نُفشل صفوفاً قديمة قبل التعبئة
  END IF;
END
$c$;

COMMENT ON COLUMN public.bookings.total_amount IS
  'إجمالي الفاتورة بالريال وقت الحجز (بضاعة + إضافات + توصيل) — يكتبه tr_ae_set_booking_total ولا يلمسه العميل';

-- ═══ ٣) المشغّل: الخادم هو من يكتب الرقم ══════════════════════════════════
-- الاسم `tr_ae_` مقصود: مشغّلات نفس التوقيت تُنفَّذ **أبجدياً**، فيأتي بعد
-- `tr_ac_booking_delivery` (يثبّت delivery_fee) و`tr_ad_set_booking_hold`.
CREATE OR REPLACE FUNCTION public.tr_ae_set_booking_total()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  NEW.total_amount := (public.taki_booking_amount(
      NEW.deal_id, NEW.booked_quantity, NEW.selected_options, NEW.delivery_fee
  )->>'total')::numeric;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS tr_ae_set_booking_total ON public.bookings;
CREATE TRIGGER tr_ae_set_booking_total
  BEFORE INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.tr_ae_set_booking_total();

-- ═══ ٤) العميل لا يكتب المال ══════════════════════════════════════════════
-- نفس الحارس القائم، مضافاً إليه `total_amount` في المسارين (إدراج وتعديل).
CREATE OR REPLACE FUNCTION public.tr_guard_booking_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  -- The lifecycle RPCs, pg_cron and the payment function all run as the owner.
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN NEW;
  END IF;
  IF public.is_admin() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF coalesce(NEW.status, 'pending') <> 'pending' THEN
      RAISE EXCEPTION 'forbidden: a new booking must start as pending'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.paid_at          IS NOT NULL
    OR NEW.paid_amount      IS NOT NULL
    OR NEW.payment_provider IS NOT NULL
    OR NEW.payment_ref      IS NOT NULL
    OR NEW.payment_expected IS NOT NULL
    OR NEW.total_amount     IS NOT NULL
    OR NEW.completed_at     IS NOT NULL
    OR NEW.completed_by     IS NOT NULL
    OR NEW.cancelled_by     IS NOT NULL
    OR NEW.merchant_note    IS NOT NULL THEN
      RAISE EXCEPTION 'forbidden: payment and lifecycle fields are set by the server'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE from a client session: identity, money, stock and lifecycle frozen.
  IF NEW.barcode          IS DISTINCT FROM OLD.barcode
  OR NEW.backup_code      IS DISTINCT FROM OLD.backup_code
  OR NEW.deal_id          IS DISTINCT FROM OLD.deal_id
  OR NEW.user_id          IS DISTINCT FROM OLD.user_id
  OR NEW.store_id         IS DISTINCT FROM OLD.store_id
  OR NEW.booked_quantity  IS DISTINCT FROM OLD.booked_quantity
  OR NEW.booked_at        IS DISTINCT FROM OLD.booked_at
  OR NEW.expiry_time      IS DISTINCT FROM OLD.expiry_time
  OR NEW.status           IS DISTINCT FROM OLD.status
  OR NEW.completed_at     IS DISTINCT FROM OLD.completed_at
  OR NEW.completed_by     IS DISTINCT FROM OLD.completed_by
  OR NEW.paid_at          IS DISTINCT FROM OLD.paid_at
  OR NEW.paid_amount      IS DISTINCT FROM OLD.paid_amount
  OR NEW.payment_provider IS DISTINCT FROM OLD.payment_provider
  OR NEW.payment_ref      IS DISTINCT FROM OLD.payment_ref
  OR NEW.payment_expected IS DISTINCT FROM OLD.payment_expected
  OR NEW.total_amount     IS DISTINCT FROM OLD.total_amount
  OR NEW.payment_method   IS DISTINCT FROM OLD.payment_method
  OR NEW.selected_options IS DISTINCT FROM OLD.selected_options
  OR NEW.cancelled_by     IS DISTINCT FROM OLD.cancelled_by
  OR NEW.merchant_note    IS DISTINCT FROM OLD.merchant_note
  OR NEW.location_id      IS DISTINCT FROM OLD.location_id
  OR NEW.fulfillment      IS DISTINCT FROM OLD.fulfillment
  OR NEW.delivery_address IS DISTINCT FROM OLD.delivery_address
  OR NEW.delivery_fee     IS DISTINCT FROM OLD.delivery_fee THEN
    RAISE EXCEPTION 'forbidden: booking payment and lifecycle fields are server-managed'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

-- ═══ ٥) تعبئة الصفوف القائمة ══════════════════════════════════════════════
-- الأولوية: ما قُبض فعلاً ⇐ ما وافق عليه المشتري (سطر الملاحظات) ⇐ إعادة حساب.
UPDATE public.bookings b
   SET total_amount = COALESCE(
         NULLIF(b.paid_amount, 0),
         NULLIF(substring(COALESCE(b.notes, '') FROM 'الإجمالي:\s*([0-9]+(?:\.[0-9]+)?)'), '')::numeric,
         (public.taki_booking_amount(b.deal_id, b.booked_quantity, b.selected_options, b.delivery_fee)->>'total')::numeric)
 WHERE b.total_amount IS NULL;

ALTER TABLE public.bookings VALIDATE CONSTRAINT bookings_total_amount_sane;

-- ═══ ٦) المبلغ المستحقّ للدفع — القارئ الوحيد لدالة الدفع ═════════════════
-- دالة الدفع (Edge Function) لا تحسب مالاً بعد اليوم: تسأل القاعدة.
CREATE OR REPLACE FUNCTION public._booking_amount_due(p_barcode text)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT round(COALESCE(
           b.total_amount,
           (public.taki_booking_amount(b.deal_id, b.booked_quantity, b.selected_options, b.delivery_fee)->>'total')::numeric,
           0), 2)
    FROM public.bookings b
   WHERE b.barcode = upper(btrim(p_barcode));
$fn$;

REVOKE ALL ON FUNCTION public._booking_amount_due(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._booking_amount_due(text) FROM anon;
REVOKE ALL ON FUNCTION public._booking_amount_due(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public._booking_amount_due(text) TO service_role;

-- ═══ ٧) الحدّ الأدنى للتوصيل يُقاس بالبضاعة لا بتعبير نمطي على نصّ ════════
-- كان يقرأ سطر «الإجمالي» من الملاحظات ويطرح منه الرسوم؛ وحجوزات البوتين لا
-- تكتب ذلك السطر أصلاً، فكان الحدّ الأدنى يُقاس عندها بسعر العرض بلا إضافات.
CREATE OR REPLACE FUNCTION public.tr_guard_booking_delivery()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  v_q     jsonb;
  v_sell  jsonb;
  v_lat   float8;
  v_lng   float8;
  v_min   numeric;
  v_est   numeric;
BEGIN
  -- v14.08 (بلاغ ناصر ٨): لا بيع قبل أن يُقرّ التاجر كيف يُحاسِب. يسري على
  -- الاستلام والتوصيل معاً — متجرٌ بلا طريقة حساب لا يُحجز منه أصلاً.
  v_sell := public.store_can_sell(NEW.store_id);
  IF NOT coalesce((v_sell->>'ok')::boolean, false) THEN
    RAISE EXCEPTION 'TAKI_STORE_NO_PAYMENT:%', coalesce(v_sell->>'reason','not_declared')
      USING ERRCODE = 'P0013';
  END IF;
  -- ونقدٌ لا يقبله التاجر لا يُفرض عليه.
  IF coalesce(NEW.payment_method,'cod') = 'cod' AND NOT coalesce((v_sell->>'accepts_cod')::boolean, true) THEN
    RAISE EXCEPTION 'TAKI_STORE_CARD_ONLY' USING ERRCODE = 'P0013';
  END IF;

  IF coalesce(NEW.fulfillment, 'pickup') <> 'delivery' THEN
    NEW.fulfillment := 'pickup';
    NEW.delivery_address := NULL;
    NEW.delivery_fee := NULL;
    RETURN NEW;
  END IF;

  IF NEW.delivery_address IS NULL OR jsonb_typeof(NEW.delivery_address) <> 'object' THEN
    RAISE EXCEPTION 'TAKI_DELIVERY_NO_ADDRESS' USING ERRCODE = 'P0013';
  END IF;
  v_lat := nullif(NEW.delivery_address->>'lat', '')::float8;
  v_lng := nullif(NEW.delivery_address->>'lng', '')::float8;
  IF v_lat IS NULL OR v_lng IS NULL THEN
    RAISE EXCEPTION 'TAKI_DELIVERY_NO_ADDRESS' USING ERRCODE = 'P0013';
  END IF;

  -- ⚠️ v14.08 (بلاغ ناصر ١): النطاق يُقاس بفرع **هذا الحجز** لا بالمتجر كله،
  -- فلا يوصّل فرعُ الباحة إلى عنوانٍ داخل نطاق فرع الخبر.
  v_q := public.delivery_quote(NEW.store_id, v_lat, v_lng, NEW.location_id);
  IF NOT coalesce((v_q->>'enabled')::boolean, false) THEN
    RAISE EXCEPTION 'TAKI_DELIVERY_OFF' USING ERRCODE = 'P0013';
  END IF;
  IF NOT coalesce((v_q->>'available')::boolean, false) THEN
    RAISE EXCEPTION 'TAKI_DELIVERY_OUT_OF_ZONE' USING ERRCODE = 'P0013';
  END IF;

  IF v_q->>'payment' = 'card' THEN
    IF coalesce(NEW.payment_method, 'cod') <> 'online' THEN
      RAISE EXCEPTION 'TAKI_DELIVERY_CARD_ONLY' USING ERRCODE = 'P0013';
    END IF;
  ELSIF v_q->>'payment' = 'cod' THEN
    NEW.payment_method := 'cod';
  END IF;

  -- v14.11 — قيمة البضاعة من الصيغة الواحدة (بضاعة + إضافات، بلا رسوم).
  v_min := coalesce((v_q->>'min_order')::numeric, 0);
  IF v_min > 0 THEN
    v_est := (public.taki_booking_amount(NEW.deal_id, NEW.booked_quantity, NEW.selected_options, 0)->>'goods')::numeric;
    IF coalesce(v_est, 0) < v_min THEN
      RAISE EXCEPTION 'TAKI_DELIVERY_MIN_ORDER:%', v_min USING ERRCODE = 'P0013';
    END IF;
  END IF;

  NEW.delivery_fee := coalesce((v_q->>'fee')::numeric, 0);
  NEW.delivery_address := jsonb_strip_nulls(jsonb_build_object(
    'label',   left(coalesce(NEW.delivery_address->>'label', ''), 60),
    'details', left(coalesce(NEW.delivery_address->>'details', ''), 300),
    'city',    left(coalesce(NEW.delivery_address->>'city', ''), 60),
    'phone',   left(coalesce(NEW.delivery_address->>'phone', ''), 20),
    'lat',     v_lat,
    'lng',     v_lng,
    'zone_id', v_q->>'zone_id'));
  RETURN NEW;
END
$fn$;

COMMIT;

-- ═══ ٨) فاتورة البوتين تقرأ العمود نفسه ═══════════════════════════════════
-- كانت تستخرج الإجمالي من نصّ الملاحظات بتعبير نمطي، وحجوزات البوتين لا تكتب
-- ذلك السطر أصلاً ⇒ تسقط على «تقدير» بلا إضافات. اليوم: العمود الذي كتبه
-- الخادم = ما يُطالَب به الدفع = ما يُطبع على الفاتورة. رقم واحد لا ثلاثة.

BEGIN;

CREATE OR REPLACE FUNCTION public.bot_get_booking_invoice(p_uid text, p_barcode text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_b       public.bookings%ROWTYPE;
  v_d       public.deals%ROWTYPE;
  v_is_buyer  boolean;
  v_is_seller boolean;
  v_vat     jsonb;
  v_vat_no  text;
  v_cr      text;
  v_total   numeric;
  v_rate    numeric;
  v_base    numeric;
  v_tax     numeric;
  v_items   jsonb := '[]'::jsonb;
  v_sel     jsonb;
  v_row     jsonb;
  v_grp     jsonb;
  v_choice  jsonb;
  v_label   text;
  v_has_variant boolean := false;
  v_loc_name text;
  v_shop    text;
  v_buyer_note text;
BEGIN
  IF NOT public._bot_gate_ok() THEN RAISE EXCEPTION 'GATE'; END IF;

  SELECT * INTO v_b FROM public.bookings WHERE barcode = upper(btrim(p_barcode));
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  v_is_buyer  := v_b.user_id IS NOT DISTINCT FROM p_uid;
  v_is_seller := v_b.store_id IS NOT DISTINCT FROM p_uid;
  IF NOT (v_is_buyer OR v_is_seller) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  SELECT * INTO v_d FROM public.deals WHERE id = v_b.deal_id;
  SELECT coalesce(nullif(v_d.shop_name,''), nullif(u.shop,''), u.name) INTO v_shop FROM public.users u WHERE u.id = v_b.store_id;

  -- ── الإجمالي ──────────────────────────────────────────────────────────────
  -- v14.11 — الرقم من العمود الذي كتبه الخادم لحظة الحجز: هو نفسه الذي يُطالَب
  -- به الدفع الإلكتروني، فلا تفترق الفاتورة عن المقبوض. القراءة من الملاحظات
  -- بقيت للحجوزات القديمة وحدها (ما قبل الهجرة)، ثم إعادة حساب كملاذ أخير.
  v_total := COALESCE(
    NULLIF(v_b.paid_amount, 0),
    v_b.total_amount,
    NULLIF(substring(coalesce(v_b.notes, '') FROM 'الإجمالي:\s*([0-9]+(?:\.[0-9]+)?)'), '')::numeric,
    (public.taki_booking_amount(v_b.deal_id, v_b.booked_quantity, v_b.selected_options, v_b.delivery_fee)->>'total')::numeric);

  -- ── الضريبة ───────────────────────────────────────────────────────────────
  v_vat := public.bot_vat_mode();
  SELECT sp.vat_number, sp.cr_number INTO v_vat_no, v_cr
    FROM public.store_profiles sp WHERE sp.store_id = v_b.store_id;

  IF coalesce((v_vat->>'enabled')::boolean, false)
     AND nullif(btrim(coalesce(v_vat_no, '')), '') IS NOT NULL
     AND v_total IS NOT NULL THEN
    v_rate := coalesce((v_vat->>'rate')::numeric, 15);
    IF coalesce((v_vat->>'add_on_top')::boolean, false) THEN
      v_base := round(v_total, 2);
      v_tax  := round(v_total * v_rate / 100, 2);
    ELSE
      v_base := round(v_total / (1 + v_rate / 100), 2);
      v_tax  := round(v_total - v_base, 2);
    END IF;
  END IF;

  -- ── العناصر: الأنواع (بدل الصنف الأساسي) والإضافات — كل عنصر برمز كاشيره ─
  v_sel := CASE WHEN jsonb_typeof(coalesce(v_b.selected_options, 'null'::jsonb)) = 'array'
                THEN v_b.selected_options ELSE '[]'::jsonb END;

  FOR v_row IN SELECT * FROM jsonb_array_elements(v_sel) LOOP
    IF v_row->>'g' = '__variant__' THEN
      SELECT vv INTO v_choice
        FROM jsonb_array_elements(coalesce(v_d.variants, '[]'::jsonb)) vv
       WHERE vv->>'id' = v_row->>'c' LIMIT 1;
      v_label := coalesce(v_choice->>'label', v_row->>'c');
      v_has_variant := true;
      v_items := v_items || jsonb_build_object(
        'label', v_label,
        'qty',   coalesce((v_row->>'qty')::int, 1),
        'sku',   nullif(btrim(coalesce(v_choice->>'posSku','')),''),
        'kind',  'variant');
    ELSE
      SELECT gg INTO v_grp
        FROM jsonb_array_elements(coalesce(v_d.options, '[]'::jsonb)) gg
       WHERE gg->>'id' = v_row->>'g' LIMIT 1;
      SELECT cc INTO v_choice
        FROM jsonb_array_elements(coalesce(v_grp->'choices', '[]'::jsonb)) cc
       WHERE cc->>'id' = v_row->>'c' LIMIT 1;
      IF v_choice IS NULL THEN CONTINUE; END IF;
      v_label := CASE WHEN v_grp->>'title' IS NOT NULL
                      THEN (v_grp->>'title') || ': ' || coalesce(v_choice->>'label', '')
                      ELSE coalesce(v_choice->>'label', '') END;
      v_items := v_items || jsonb_build_object(
        'label', v_label,
        'qty',   coalesce((v_row->>'qty')::int, 1),
        'sku',   nullif(btrim(coalesce(v_choice->>'posSku','')),''),
        'kind',  'addon');
    END IF;
  END LOOP;

  -- الصنف الأساسي يُطبع كعنصر (برمز كاشيره) فقط حين لا أنواع — كالموقع تماماً
  IF NOT v_has_variant THEN
    v_items := jsonb_build_array(jsonb_build_object(
      'label', v_d.item_name, 'qty', coalesce(v_b.booked_quantity, 1),
      'sku', nullif(btrim(coalesce(v_d.pos_sku,'')),''), 'kind', 'main')) || v_items;
  END IF;

  -- اسم الفرع المختار (عرض متعدد المواقع)
  IF v_b.location_id IS NOT NULL AND jsonb_typeof(coalesce(v_d.locations,'null'::jsonb)) = 'array' THEN
    SELECT nullif(e->>'name','') INTO v_loc_name FROM jsonb_array_elements(v_d.locations) e
     WHERE e->>'id' = v_b.location_id LIMIT 1;
  END IF;

  -- ملاحظة المشتري الحرّة (بعد 📝 وقبل سطر 💰) — نفس منطق الموقع
  v_buyer_note := nullif(btrim(coalesce(substring(coalesce(v_b.notes,'') FROM '📝\s*([^\n]*(?:\n(?!💰)[^\n]*)*)'), '')), '');

  RETURN jsonb_build_object(
    'ok',            true,
    'role',          CASE WHEN v_is_seller THEN 'seller' ELSE 'buyer' END,
    'barcode',       v_b.barcode,
    'backup_code',   v_b.backup_code,
    'status',        v_b.status,
    'cancelled_by',  v_b.cancelled_by,
    'item_name',     v_d.item_name,
    'main_sku',      nullif(btrim(coalesce(v_d.pos_sku,'')),''),
    'shop_name',     v_shop,
    'store_id',      v_b.store_id,
    'quantity',      v_b.booked_quantity,
    'unit_price',    v_d.discounted_price,
    'original_price',v_d.original_price,
    'total',         v_total,
    'total_source',  CASE WHEN v_b.paid_amount > 0     THEN 'paid'
                          WHEN v_b.total_amount IS NOT NULL THEN 'order'
                          WHEN v_b.notes ~ 'الإجمالي:'   THEN 'order'
                          ELSE 'estimate' END,
    'vat_number',    v_vat_no,
    'cr_number',     v_cr,
    'vat_rate',      v_rate,
    'vat_base',      v_base,
    'vat_amount',    v_tax,
    'paid',          v_b.paid_at IS NOT NULL,
    'paid_amount',   v_b.paid_amount,
    'payment_method',v_b.payment_method,
    'items',         v_items,
    'buyer_name',    CASE WHEN v_is_seller THEN v_b.user_name ELSE NULL END,
    'buyer_phone',   CASE WHEN v_is_seller THEN v_b.user_phone ELSE NULL END,
    'prep_time',     v_b.prep_time,
    'notes',         v_b.notes,
    'buyer_note',    v_buyer_note,
    'merchant_note', v_b.merchant_note,
    'location_name', v_loc_name,
    'fulfillment',   coalesce(v_b.fulfillment, 'pickup'),
    'delivery_fee',  v_b.delivery_fee,
    'delivery',      v_b.delivery_address,
    'booked_at',     v_b.booked_at,
    'completed_at',  v_b.completed_at
  );
END;
$fn$;


COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- جدول التحقّق — أوّل سطر فيه اسم الخادم، فلا يُخلط الإنتاج بالمختبر
-- ═══════════════════════════════════════════════════════════════════════════
SELECT 'الخادم' AS "الفحص",
       COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'standard public schema')
         || ' @ ' || COALESCE(inet_server_addr()::text, current_setting('cluster_name', true), 'local') AS "النتيجة",
       CASE WHEN COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'') NOT LIKE 'TAKI_LAB_TOKYO%'
            THEN '✅ جدة (إنتاج)' ELSE '❌ المختبر' END AS "الحالة";

SELECT 'عمود bookings.total_amount' AS "الفحص",
       count(*)::text || '/1' AS "النتيجة",
       CASE WHEN count(*) = 1 THEN '✅' ELSE '❌' END AS "الحالة"
  FROM information_schema.columns
 WHERE table_schema='public' AND table_name='bookings' AND column_name='total_amount';

SELECT 'مشغّل tr_ae_set_booking_total (بعد tr_ac/tr_ad أبجدياً)' AS "الفحص",
       count(*)::text || '/1' AS "النتيجة",
       CASE WHEN count(*) = 1 THEN '✅' ELSE '❌' END AS "الحالة"
  FROM pg_trigger WHERE tgrelid='public.bookings'::regclass AND tgname='tr_ae_set_booking_total';

SELECT 'حجوزات بلا إجمالي (يجب صفر)' AS "الفحص",
       count(*)::text AS "النتيجة",
       CASE WHEN count(*) = 0 THEN '✅' ELSE '❌' END AS "الحالة"
  FROM public.bookings WHERE total_amount IS NULL;

SELECT 'إجمالي التوصيل = بضاعة + رسوم (الحجوزات القائمة)' AS "الفحص",
       count(*)::text || ' منحرف' AS "النتيجة",
       CASE WHEN count(*) = 0 THEN '✅' ELSE '❌' END AS "الحالة"
  FROM public.bookings b
 WHERE b.status IN ('pending','acknowledged')
   AND COALESCE(b.fulfillment,'pickup') = 'delivery'
   AND b.paid_amount IS NULL
   AND abs(COALESCE(b.total_amount,0)
           - (public.taki_booking_amount(b.deal_id, b.booked_quantity, b.selected_options, b.delivery_fee)->>'total')::numeric) > 0.011;

SELECT 'anon ممنوع من taki_booking_amount' AS "الفحص",
       CASE WHEN has_function_privilege('anon','public.taki_booking_amount(text,integer,jsonb,numeric)','EXECUTE')
            THEN 'يملكها' ELSE 'ممنوع' END AS "النتيجة",
       CASE WHEN has_function_privilege('anon','public.taki_booking_amount(text,integer,jsonb,numeric)','EXECUTE')
            THEN '❌' ELSE '✅' END AS "الحالة";

SELECT 'anon + authenticated ممنوعان من _booking_amount_due' AS "الفحص",
       CASE WHEN has_function_privilege('anon','public._booking_amount_due(text)','EXECUTE')
              OR has_function_privilege('authenticated','public._booking_amount_due(text)','EXECUTE')
            THEN 'أحدهما يملكها' ELSE 'ممنوعان' END AS "النتيجة",
       CASE WHEN has_function_privilege('anon','public._booking_amount_due(text)','EXECUTE')
              OR has_function_privilege('authenticated','public._booking_amount_due(text)','EXECUTE')
            THEN '❌' ELSE '✅' END AS "الحالة";

SELECT 'service_role يملك _booking_amount_due' AS "الفحص",
       CASE WHEN has_function_privilege('service_role','public._booking_amount_due(text)','EXECUTE')
            THEN 'نعم' ELSE 'لا' END AS "النتيجة",
       CASE WHEN has_function_privilege('service_role','public._booking_amount_due(text)','EXECUTE')
            THEN '✅' ELSE '❌' END AS "الحالة";

SELECT 'فاتورة البوتين تقرأ total_amount' AS "الفحص",
       CASE WHEN pg_get_functiondef('public.bot_get_booking_invoice(text,text)'::regprocedure) LIKE '%v_b.total_amount%'
            THEN 'نعم' ELSE 'لا' END AS "النتيجة",
       CASE WHEN pg_get_functiondef('public.bot_get_booking_invoice(text,text)'::regprocedure) LIKE '%v_b.total_amount%'
            THEN '✅' ELSE '❌' END AS "الحالة";

SELECT 'حارس السلامة يجمّد total_amount' AS "الفحص",
       CASE WHEN pg_get_functiondef('public.tr_guard_booking_integrity()'::regprocedure) LIKE '%NEW.total_amount%'
            THEN 'نعم' ELSE 'لا' END AS "النتيجة",
       CASE WHEN pg_get_functiondef('public.tr_guard_booking_integrity()'::regprocedure) LIKE '%NEW.total_amount%'
            THEN '✅' ELSE '❌' END AS "الحالة";
