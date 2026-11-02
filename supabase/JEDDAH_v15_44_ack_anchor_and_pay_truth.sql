-- ═══════════════════════════════════════════════════════════════════════════
-- v15.44 — ساعةُ «استلمتُ طلبي» تبدأ من تأكيد التاجر · وطريقةُ الحساب حقيقةٌ واحدة
-- ═══════════════════════════════════════════════════════════════════════════
-- أمرُ ناصر (اثنان):
--   ١) «استلمت طلبي بعد ١٠ دقائق — أريدها من بعد ما يستلم التاجر الطلب ويضغط
--      تم الاستلام، وليس من بداية إرسال الطلب».
--   ٢) «طريقة الدفع تظهر ٣ مرّات، مرّتان في موضعهما والثالثة (التي بالأحمر)
--      احذفها» — وهي بطاقة «طريقة الحساب» بعد أن يُقرّ التاجر.
--
-- 🔴 والثاني كشف عيباً حيّاً على متجر ناصر نفسِه، قِيس على جدّة:
--      store_profiles.accepts_cod = false   (أقرّ: بطاقة فقط)
--      merchant_gateways.payment_modes = 'both'  (المعروض للمشتري: نقد + بطاقة)
--    فصفحةُ العرض تعرض «الدفع عند الاستلام» (تقرأ `deal_payment_mode` ⇐ المفتاح
--    الثاني)، والقاعدةُ ترفضه لحظةَ الحجز بـ`TAKI_STORE_CARD_ONLY` (تقرأ الأوّل).
--    أي أن **كلَّ مشترٍ يختار الدفع عند الاستلام من متجر ناصر يُرفض حجزُه**.
--    ⇒ لا يجوز حذفُ البطاقة الثالثة قبل توحيد المصدرين، وإلّا صار التناقضُ
--      بلا شاشةٍ تُصلحه.
-- ═══════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF COALESCE(obj_description('public'::regnamespace, 'pg_namespace'), '')
     = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر. أوقِفت.';
  END IF;
  IF to_regprocedure('public.taki_self_close_minutes()') IS NULL
     OR to_regprocedure('public.merchant_handover_booking(text)') IS NULL
     OR to_regprocedure('public.merchant_set_payment_modes(text)') IS NULL
     OR to_regprocedure('public.store_can_sell(text)') IS NULL THEN
    RAISE EXCEPTION 'أساسُ v14.08/v15.42 غائب — أوقِفت.';
  END IF;
END
$guard$;

-- ═══ الجزء أ — لحظةُ تأكيد التاجر تُسجَّل ═════════════════════════════════
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz;

-- 🪤 والتسجيلُ بمشغّل لا بتعديل الدالّتين: `acknowledge_booking` (الموقع) و
--    `bot_acknowledge_booking` (البوتان) كلاهما `UPDATE … SET status`، وأيُّ
--    مسارٍ ثالث يُضاف غداً (أدمن · كرون · تكامل) سينسى العمود. المشغّلُ يرى
--    كلَّ تحوّلٍ مهما كان مصدرُه — وهذا نفسُ سببِ وجود `tr_ad_set_booking_hold`.
-- 🪤 ويُجبَر على القيمة القديمة فيما عدا لحظةَ التحوّل: فلا يُزوَّر من المتصفّح
--    (التاجرُ يملك `UPDATE` على طلبه) ولا يُمحى بتعديلٍ لاحق.
CREATE OR REPLACE FUNCTION public.tr_ag_stamp_ack()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.acknowledged_at := NULL;          -- كلُّ حجزٍ يبدأ `pending`
    RETURN NEW;
  END IF;
  IF NEW.status = 'acknowledged' AND COALESCE(OLD.status,'') <> 'acknowledged' THEN
    NEW.acknowledged_at := now();
  ELSE
    NEW.acknowledged_at := OLD.acknowledged_at;
  END IF;
  RETURN NEW;
END;
$function$;

-- الاسم `tr_ag_` ليقع **بعد** `tr_af_order_invoice_draft` وبعد حارس التجميد
-- `tr_ab_guard_booking_integrity`: مشغّلٌ يسبق الحارسَ ويغيّر عموداً مجمَّداً
-- يجعل الحارسَ يرفض كتابتَنا نحن.
DROP TRIGGER IF EXISTS tr_ag_stamp_ack ON public.bookings;
CREATE TRIGGER tr_ag_stamp_ack
  BEFORE INSERT OR UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.tr_ag_stamp_ack();

-- ── لحظةُ فتح الزرّ — ولا تكون عدماً أبداً ────────────────────────────────
-- أمرُ ناصر: الساعةُ تبدأ من تأكيد التاجر. وهذا هو المسار الأوّل أدناه.
--
-- 🔴 لكنّ «لا تأكيدَ ⇒ لا زرَّ أبداً» تُسقط المشتري في الهاوية، وقِيس على جدّة
--    لا استنتاجاً: **٨ من ٥٧ طلباً مكتملاً (١٤٪) لم يُؤكَّد قطّ**، و**واحدٌ من
--    الختمين الذاتيّين اللذين وقعا أصلاً كان على طلبٍ لم يؤكّده تاجرُه** — أي
--    أن الحالةَ التي سنمنعها هي نصفُ الاستعمال الحقيقيّ للميزة. ومشتريةٌ
--    استلمت بضاعتَها ودفعت نقداً ثم لم يختم التاجرُ الطلبَ تجد طلبَها «ملغى»
--    وكمّيتَها تُباع لغيرها، بلا فاتورةٍ ولا تقييمٍ ولا أثر.
-- 🔴 وأسوأُ منه بنيوياً بعد v15.43: أرضيّةُ المهلة ربعُ ساعة، فتاجرٌ يضبطها
--    على ١٥ دقيقة مع مهلةِ ختمٍ ١٠ دقائق لا يترك للمشترية نافذةً إن تأخّر
--    تأكيدُه خمسَ دقائق — ومتوسّطُ التأخير المقيس ٤٫٩ دقيقة وأقصاه ٥٩٫٥.
--
-- ⇒ فالزرُّ يُفتح عند **الأسبقِ المعقول**:
--      • أكّد التاجر   ⇒ بعد `self_close_minutes` من تأكيده (أمرُ ناصر حرفياً).
--      • لم يؤكّد      ⇒ في آخر `self_close_minutes` من المهلة، ولا قبل
--                        `self_close_minutes` من الحجز أبداً.
--    فلا زرَّ لحظةَ الحجز (وهو ما كرهه ناصر)، ولا مشتريةٌ بلا مخرجٍ (وهو ما
--    يقتل الميزةَ أصلاً). ولا رقمَ جديد: نفسُ الدقائق في الطرفين.
CREATE OR REPLACE FUNCTION public.taki_self_close_opens_at(p_booking public.bookings)
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- 🔴 والسقفُ الخارجيّ ليس تجميلاً: بلا `LEAST` كان فرعُ «أُكِّد» ينفجر.
  --    مهلةُ ١٥ دقيقة (أرضيّةُ v15.43) + تأكيدٌ بعد ٦ ⇒ فتحةٌ عند +١٦ ومهلةٌ
  --    تنتهي عند +١٥ ⇒ **نافذةٌ خالية**، ثمّ يُلغى الطلب. وقِيس أن ٩٫١٪ من
  --    التأكيدات تقع بعد خمس دقائق — فليست حالةً نادرة. ومثلُه أدمنيّاً:
  --    `self_close_minutes` يقبل حتى ١٤٤٠ دقيقة، فرقمٌ كبير كان يُقفل الميزةَ
  --    على المنصّة كلّها بلا أن يقول أحدٌ شيئاً.
  -- ⇒ الزرُّ يُفتح دائماً قبل انتهاء المهلة بدقيقةٍ على الأقلّ، ولا يُفتح
  --   أبداً قبل مهلةِ الختم من لحظة الحجز.
  SELECT LEAST(
    CASE
      WHEN p_booking.acknowledged_at IS NOT NULL
        THEN GREATEST(COALESCE(p_booking.booked_at, 0) + v.ms,
                      (EXTRACT(EPOCH FROM p_booking.acknowledged_at)*1000)::bigint + v.ms)
      WHEN p_booking.status = 'acknowledged'      -- صفٌّ أُكِّد قبل v15.44
        THEN COALESCE(p_booking.booked_at, 0) + v.ms
      ELSE GREATEST(COALESCE(p_booking.booked_at, 0) + v.ms,
                    COALESCE(p_booking.expiry_time, 0) - v.ms)
    END,
    COALESCE(NULLIF(p_booking.expiry_time, 0), 9223372036854775807) - 60000)
  FROM (SELECT (public.taki_self_close_minutes() * 60000)::bigint AS ms) v;
$function$;

REVOKE ALL ON FUNCTION public.taki_self_close_opens_at(public.bookings) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_self_close_opens_at(public.bookings) FROM anon;
GRANT EXECUTE ON FUNCTION public.taki_self_close_opens_at(public.bookings) TO authenticated, service_role;

-- ═══ الجزء ب — طريقةُ الحساب: حقيقةٌ واحدة لا اثنتان ══════════════════════
-- 🔴 العيبُ الحيّ (قِيس على جدّة ٢ نوفمبر ٢٠٢٦):
--      متجر ناصر  accepts_cod=false · payment_modes='both'
--    والواجهةُ تقرأ `deal_payment_mode` (⇐ payment_modes) فتعرض «الدفع عند
--    الاستلام»، والحارسُ يقرأ `accepts_cod` فيرفضه. أي أن المشتري يختار خياراً
--    معروضاً فيُردّ حجزُه — بلا سببٍ يفهمه هو ولا التاجر.
-- والعلاجُ بنيويّ لا ترقيعيّ: **الحارسُ يقرأ ما تقرؤه الواجهة**.

CREATE OR REPLACE FUNCTION public.tr_guard_booking_delivery()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
  -- 🔴 v15.44 — والمرجعُ صار `deal_payment_mode()` لا `accepts_cod` الخام، لأن
  --    الثاني **ينحرف عن المعروض للمشتري**. قِيس على متجر ناصر يوم ٢ نوفمبر:
  --    `accepts_cod=false` بينما `payment_modes='both'` ⇒ صفحةُ العرض تعرض
  --    «الدفع عند الاستلام» (تقرأ `deal_payment_mode`) والحارسُ يرفضه (يقرأ
  --    `accepts_cod`) ⇒ كلُّ مشترٍ يختار النقد يُرفض حجزُه بلا سببٍ مفهوم.
  --    و`deal_payment_mode` هو المصدرُ الذي تقرؤه الواجهة فعلاً، وهو يُسقط
  --    البوّابةَ المعطوبة إلى 'cod' وحده — فقراءتُه تُغلق الباب على الانحراف
  --    كلِّه بدل ترقيع قارئٍ بعد قارئ.
  -- 🪤 والحالةُ «أقرّ بطاقةً فقط بلا بوّابة» لا تمرّ من هنا أصلاً:
  --    `store_can_sell` تردّها قبلَه بـ`no_method`.
  IF coalesce(NEW.payment_method,'cod') = 'cod'
     AND public.deal_payment_mode(NEW.store_id) = 'online' THEN
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
$function$;

-- وبعدها تبقى `accepts_cod` إقراراً للمتجر **بلا بوّابة** (تستعملها
-- `store_can_sell` لمنع متجرٍ لا يملك وسيلةَ تحصيلٍ أصلاً). ولئلّا تنحرف عن
-- اختيار التاجر الظاهر، تُزامَن عند كلّ تغييرٍ لأوضاع الدفع — بمشغّلٍ لا
-- بتعديل دالّةٍ واحدة، فأيُّ مسارٍ يكتب `payment_modes` يرثُ المزامنة.
CREATE OR REPLACE FUNCTION public.tr_sync_accepts_cod()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- 🔴 لا يُقِرُّ المشغّلُ عن تاجرٍ لم ينطق: `payment_declared_at` تبقى بيد
  --    `merchant_set_payment_declaration` وحدها. وكانت الصيغةُ الأولى تختمها
  --    هنا، و`merchant_gateways.payment_modes` افتراضُها `'cod'` NOT NULL
  --    و`merchant_set_gateway` لا تذكرها — فتاجرٌ يحفظ مفاتيح بوّابته **قبل**
  --    أن يُقرّ كان يصير «يقبل النقد» بإقرارٍ لم يقله، ثمّ تختفي عنه البطاقةُ
  --    التي كانت ستسأله. (والمتجر `fa5e533c` على هذه الحافة اليوم: بلا إقرار.)
  -- 🪤 ولذلك المشغّلُ `UPDATE OF` وحده — بلا `INSERT`: عند الإدراج تكون `OLD`
  --    فارغةً فيبدو الافتراضيُّ تغييراً وهو ليس اختياراً من أحد.
  IF NEW.payment_modes IS DISTINCT FROM OLD.payment_modes THEN
    UPDATE public.store_profiles
       SET accepts_cod = (NEW.payment_modes <> 'online'),
           updated_at = now()
     WHERE store_id = NEW.merchant_id
       AND payment_declared_at IS NOT NULL;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS tr_sync_accepts_cod ON public.merchant_gateways;
CREATE TRIGGER tr_sync_accepts_cod
  AFTER UPDATE OF payment_modes ON public.merchant_gateways
  FOR EACH ROW EXECUTE FUNCTION public.tr_sync_accepts_cod();

-- ── وتسويةُ الانحراف القائم ────────────────────────────────────────────────
-- 🪤 والاتجاهُ مقصود: تُسوَّى `accepts_cod` إلى ما **يراه المشتري** لا العكس.
--    العكسُ كان سيسحب خيارَ دفعٍ معروضاً اليوم على صفحة العرض بلا أن يطلب
--    التاجرُ ذلك. والتاجرُ يملك عكسَها بضغطةٍ من بطاقة البوّابة.
UPDATE public.store_profiles sp
   SET accepts_cod = (mg.payment_modes <> 'online'),
       updated_at = now()
  FROM public.merchant_gateways mg
 WHERE mg.merchant_id = sp.store_id
   AND sp.accepts_cod IS DISTINCT FROM (mg.payment_modes <> 'online');

-- ── كاشفُ الانحراف، كي لا يُكتشف بعد إصدارين ──────────────────────────────
CREATE OR REPLACE FUNCTION public.taki_audit_payment_drift()
 RETURNS TABLE(store_id text, accepts_cod boolean, payment_modes text, effective_mode text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT sp.store_id, sp.accepts_cod, mg.payment_modes,
         public.deal_payment_mode(sp.store_id)
    FROM public.store_profiles sp
    JOIN public.merchant_gateways mg ON mg.merchant_id = sp.store_id
   WHERE sp.accepts_cod IS DISTINCT FROM (mg.payment_modes <> 'online');
$function$;

REVOKE ALL ON FUNCTION public.taki_audit_payment_drift() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_audit_payment_drift() FROM anon;
GRANT EXECUTE ON FUNCTION public.taki_audit_payment_drift() TO service_role;

-- ═══ الجزء ج — البوّابات الثلاث تقرأ المرساةَ الجديدة ═════════════════════
-- 🪤 وبُنيت من **النصّ الحيّ** لا من نسخة المستودع (درسٌ مدفوع: النسخُ تنحرف).
CREATE OR REPLACE FUNCTION public.buyer_confirm_receipt(p_barcode text)
 RETURNS bookings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid  text := auth.uid()::text;
  v_b    public.bookings%ROWTYPE;
  v_trk  text;
  v_left integer;
  v_anchor bigint;
  v_out  public.bookings;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_b FROM public.bookings WHERE barcode = upper(btrim(p_barcode));
  IF NOT FOUND OR v_b.user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'لم يتم العثور على الطلب' USING ERRCODE = 'P0002';
  END IF;
  -- v15.41 — الزرُّ لكلّ طلبٍ حيّ، والتوصيلُ وحده يشترط انطلاقَ المندوب.
  IF v_b.status NOT IN ('pending','acknowledged') THEN
    RAISE EXCEPTION 'الطلب مغلق بالفعل' USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(v_b.fulfillment,'pickup') = 'delivery' THEN
    SELECT status INTO v_trk FROM public.delivery_tracks WHERE barcode = v_b.barcode;
    IF COALESCE(v_trk,'') NOT IN ('on_the_way','arrived','delivered') THEN
      RAISE EXCEPTION 'لم يبدأ التاجر التوصيل بعد' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- 🔴 v15.42 — المهلةُ قبل أن يُسمح بالختم الذاتيّ.
  -- 🪤 ولا تُصاغ الدقائقُ نصّاً هنا: العربيّةُ تحتاج خمسَ صيغٍ للمعدود، ومحرّكُها
  --    في ثلاثة مواضع مقيسة (`arPlural`) — ورابعٌ في SQL يعني انحرافاً. فالرسالةُ
  --    تخلو من المعدود، والثواني المتبقّية في `DETAIL` تصوغها الواجهة.
  -- 🔴 v15.44 (أمرُ ناصر) — الساعةُ تبدأ من **تأكيد التاجر**؛ وإن لم يؤكّد
  --    فتحةٌ احتياطيّة في آخر المهلة كي لا تبقى المشترية بلا مخرج (١٤٪ من
  --    الطلبات المكتملة لم تُؤكَّد قطّ — قِيس). والرمزُ يفرّق **سببَ** الانتظار
  --    فتقول الشاشةُ الصدق: أتنتظرُ شخصاً أم وقتاً.
  v_anchor := public.taki_self_close_opens_at(v_b);
  v_left := ceil((v_anchor - (EXTRACT(EPOCH FROM NOW())*1000)::bigint) / 1000.0);
  IF v_left > 0 AND v_b.acknowledged_at IS NULL AND v_b.status <> 'acknowledged' THEN
    RAISE EXCEPTION 'لم يؤكّد التاجر استلام طلبك بعد'
      USING ERRCODE = 'P0029', DETAIL = v_left::text;
  END IF;
  IF v_left > 0 THEN
    RAISE EXCEPTION 'لم تمضِ المهلة بعد استلام المتجر للطلب'
      USING ERRCODE = 'P0028', DETAIL = v_left::text;
  END IF;

  UPDATE public.bookings
     SET status = 'completed', completed_by = 'buyer'
   WHERE barcode = v_b.barcode
     AND status IN ('pending','acknowledged')
  RETURNING * INTO v_out;

  IF v_out.barcode IS NULL THEN
    RAISE EXCEPTION 'الطلب مغلق بالفعل' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data, created_at)
  VALUES (v_out.store_id,
          '✅ أكّد المشتري الاستلام', '✅ Buyer confirmed receipt',
          'أكّد المشتري استلام الطلب ' || v_out.barcode,
          'The buyer confirmed receiving order ' || v_out.barcode,
          'booking',
          jsonb_build_object('audience','seller','event','buyer_confirmed',
                             'barcode', v_out.barcode, 'dealId', v_out.deal_id),
          NOW());

  RETURN v_out;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bot_buyer_confirm_receipt(p_telegram_id bigint, p_barcode text, p_whatsapp_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid text; v_b public.bookings%ROWTYPE; v_trk text; v_left integer; v_anchor bigint;
BEGIN
  IF NOT public._bot_gate_ok() THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  SELECT id INTO v_uid FROM public.users
   WHERE id = public._bot_uid(p_telegram_id, p_whatsapp_id) AND deleted_at IS NULL LIMIT 1;
  IF v_uid IS NULL THEN RETURN jsonb_build_object('success',false,'error','not_linked'); END IF;

  SELECT * INTO v_b FROM public.bookings WHERE barcode = upper(btrim(p_barcode)) AND user_id = v_uid;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  -- v15.41 — الزرُّ لكلّ طلبٍ حيّ، والتوصيلُ وحده يشترط انطلاقَ المندوب.
  IF v_b.status NOT IN ('pending','acknowledged') THEN
    RETURN jsonb_build_object('success',false,'error','closed'); END IF;

  IF COALESCE(v_b.fulfillment,'pickup') = 'delivery' THEN
    SELECT status INTO v_trk FROM public.delivery_tracks WHERE barcode = v_b.barcode;
    IF COALESCE(v_trk,'') NOT IN ('on_the_way','arrived','delivered') THEN
      RETURN jsonb_build_object('success',false,'error','not_dispatched'); END IF;
  END IF;

  -- 🔴 v15.42 — نفسُ المهلة، ونفسُ الساعة. والثواني تعود للبوت فيصوغها بـ
  -- `shared/arPlural.js` — فلا رقمَ مكتوبٌ نصّاً في سلسلةٍ ولا في SQL.
  -- 🔴 v15.44 (أمرُ ناصر) — الساعةُ تبدأ من **تأكيد التاجر**؛ وإن لم يؤكّد
  --    فتحةٌ احتياطيّة في آخر المهلة كي لا تبقى المشترية بلا مخرج (١٤٪ من
  --    الطلبات المكتملة لم تُؤكَّد قطّ — قِيس). والرمزُ يفرّق **سببَ** الانتظار
  --    فتقول الشاشةُ الصدق: أتنتظرُ شخصاً أم وقتاً.
  v_anchor := public.taki_self_close_opens_at(v_b);
  v_left := ceil((v_anchor - (EXTRACT(EPOCH FROM NOW())*1000)::bigint) / 1000.0);
  IF v_left > 0 AND v_b.acknowledged_at IS NULL AND v_b.status <> 'acknowledged' THEN
    RETURN jsonb_build_object('success',false,'error','not_acknowledged','wait_seconds',v_left); END IF;
  IF v_left > 0 THEN
    RETURN jsonb_build_object('success',false,'error','too_soon','wait_seconds',v_left); END IF;

  UPDATE public.bookings SET status='completed', completed_by='buyer'
   WHERE barcode = v_b.barcode AND status IN ('pending','acknowledged');

  INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data, created_at)
  VALUES (v_b.store_id, '✅ أكّد المشتري الاستلام', '✅ Buyer confirmed receipt',
          'أكّد المشتري استلام الطلب ' || v_b.barcode,
          'The buyer confirmed receiving order ' || v_b.barcode,
          'booking',
          jsonb_build_object('audience','seller','event','buyer_confirmed',
                             'barcode', v_b.barcode, 'dealId', v_b.deal_id),
          NOW());

  RETURN jsonb_build_object('success', true, 'barcode', v_b.barcode);
END;
$function$;

CREATE OR REPLACE FUNCTION public.merchant_handover_booking(p_barcode text)
 RETURNS bookings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid  text := auth.uid()::text;
  v_b    public.bookings%ROWTYPE;
  v_left integer;
  v_anchor bigint;
  v_out  public.bookings;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_b FROM public.bookings WHERE barcode = upper(btrim(p_barcode));
  IF NOT FOUND OR v_b.store_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'لم يتم العثور على الطلب أو ليست لديك صلاحية' USING ERRCODE = 'P0002';
  END IF;

  IF v_b.status NOT IN ('pending','acknowledged') THEN
    RAISE EXCEPTION 'الطلب مغلق بالفعل' USING ERRCODE = 'P0001';
  END IF;

  -- 🔴 v15.44 (أمرُ ناصر) — الساعةُ تبدأ من **تأكيد التاجر**؛ وإن لم يؤكّد
  --    فتحةٌ احتياطيّة في آخر المهلة كي لا تبقى المشترية بلا مخرج (١٤٪ من
  --    الطلبات المكتملة لم تُؤكَّد قطّ — قِيس). والرمزُ يفرّق **سببَ** الانتظار
  --    فتقول الشاشةُ الصدق: أتنتظرُ شخصاً أم وقتاً.
  v_anchor := public.taki_self_close_opens_at(v_b);
  v_left := ceil((v_anchor - (EXTRACT(EPOCH FROM NOW())*1000)::bigint) / 1000.0);
  IF v_left > 0 AND v_b.acknowledged_at IS NULL AND v_b.status <> 'acknowledged' THEN
    RAISE EXCEPTION 'اضغط «تأكيد استلام الطلب» أوّلاً — ومن تلك اللحظة تبدأ المهلة'
      USING ERRCODE = 'P0029', DETAIL = v_left::text;
  END IF;
  IF v_left > 0 THEN
    RAISE EXCEPTION 'لم تمضِ المهلة بعد — واستلامُ الكود يعمل الآن بلا انتظار'
      USING ERRCODE = 'P0028', DETAIL = v_left::text;
  END IF;

  UPDATE public.bookings
     SET status = 'completed', completed_by = 'seller'
   WHERE barcode = v_b.barcode
     AND status IN ('pending','acknowledged')
  RETURNING * INTO v_out;

  IF v_out.barcode IS NULL THEN
    RAISE EXCEPTION 'الطلب مغلق بالفعل' USING ERRCODE = 'P0001';
  END IF;

  RETURN v_out;
END;
$function$;

-- ═══ الجزء د — البوتان يحتاجان مرساةً **رقميّة** ═════════════════════════
-- 🔴 قِيس: 'booked_at' في ردّ `bot_get_my_bookings` **نصُّ وقتٍ** لا رقم
--    (`to_timestamp(...)`)، و`Number('2026-…')` = NaN. فبوّابةُ v15.42 في
--    القناتين كانت تحسب NaN فتُرجع «لا انتظار» ⇒ **الزرُّ يظهر فوراً**
--    والقاعدةُ ترفضه بـtoo_soon. لم يُؤذِ أحداً (الرسالةُ واضحة) لكنّه نقضَ
--    قاعدةَ «لا زرَّ يعرضه العميلُ ويرفضه الخادم».
-- 🪤 والدرسُ: مفتاحٌ موجودٌ بالاسم ليس مفتاحاً صالحاً بالقيمة. تُقاس القيمة.
CREATE OR REPLACE FUNCTION public.bot_get_my_bookings(p_telegram_id bigint, p_scope text DEFAULT 'all'::text, p_whatsapp_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid text; v_res jsonb;
BEGIN
  SELECT id INTO v_uid FROM users WHERE id = public._bot_uid(p_telegram_id, p_whatsapp_id) AND deleted_at IS NULL LIMIT 1;
  IF v_uid IS NULL THEN RETURN NULL; END IF;
  SELECT jsonb_agg(row ORDER BY (row->>'sort_at')::bigint DESC) INTO v_res FROM (
    SELECT jsonb_build_object(
      'barcode', b.barcode, 'deal_id', b.deal_id, 'deal_name', d.item_name, 'shop_name', d.shop_name,
      'store_id', d.store_id,
      'quantity', b.booked_quantity, 'status', b.status, 'image', (d.images)[1],
      'prep_time', b.prep_time, 'notes', b.notes, 'sort_at', b.booked_at,
      'expiry_time', b.expiry_time,
      'deal_expiry_type', d.expiry_type, 'deal_expiry_date', d.expiry_date,
      'unread', (SELECT count(*) FROM booking_messages m WHERE m.barcode = b.barcode AND m.sender_role='seller' AND m.read_at IS NULL),
      'msg_count', (SELECT count(*) FROM booking_messages m WHERE m.barcode = b.barcode),
      'booked_at', to_timestamp(b.booked_at::double precision / 1000),
      -- v15.44 — مرساةُ «الختم بلا كود» بالمللي (كـ`expiry_time`/`sort_at`).
      -- 🪤 ولا تُقرأ `booked_at` أعلاه لذلك: هي **نصُّ وقتٍ** لا رقم، و`Number()`
      --    عليها تُنتج NaN بصمت — وهو ما جعل بوّابةَ v15.42 ميّتةً في البوتين.
      'ack_at_ms', CASE WHEN b.acknowledged_at IS NULL THEN NULL
                        ELSE (EXTRACT(EPOCH FROM b.acknowledged_at)*1000)::bigint END,
      'booked_at_ms', b.booked_at,
      'fulfillment', coalesce(b.fulfillment, 'pickup'),
      'delivery_fee', b.delivery_fee,
      'delivery_label', b.delivery_address->>'label',
      'delivery_details', b.delivery_address->>'details',
      'delivery_lat', b.delivery_address->>'lat',
      'delivery_lng', b.delivery_address->>'lng',
      -- v14.10 — البوتان يحتاجانهما ليخفيا عدّاداً كاذباً ويُظهرا زرّ التأكيد
      'paid', b.paid_at IS NOT NULL,
      'dlv_status', (SELECT t.status FROM delivery_tracks t WHERE t.barcode = b.barcode),
      -- v14.21 — حالة الاسترداد على بطاقة الطلب في البوتين، فلا ينتظر المشتري
      -- جواباً لا يراه. (كان السطر مكتوباً في البوت بلا حقلٍ يغذّيه.)
      'refund_status', (SELECT r.status FROM booking_refunds r WHERE r.barcode = b.barcode),
      'credit_note_no', (SELECT r.credit_note_no FROM booking_refunds r WHERE r.barcode = b.barcode),
      'hold_running', (
        b.status IN ('pending','acknowledged')
        AND b.paid_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM delivery_tracks t
                         WHERE t.barcode = b.barcode
                           AND t.status IN ('preparing','on_the_way','arrived','delivered'))
      )
    ) AS row
    FROM bookings b JOIN deals d ON d.id = b.deal_id
    WHERE b.user_id = v_uid
      AND ( p_scope = 'all'
         OR (p_scope = 'current'  AND b.status IN ('pending','acknowledged'))
         OR (p_scope = 'previous' AND b.status IN ('completed','cancelled','expired')) )
    ORDER BY b.booked_at DESC LIMIT 20
  ) t;
  RETURN COALESCE(v_res, '[]'::jsonb);
END; $function$;

-- ── تحقّقٌ بنيويّ ───────────────────────────────────────────────────────────
-- 🪤 يُجرَّد التعليقُ قبل أيّ فحصِ نصّ: شرحُ هذه الهجرة يحوي `accepts_cod`
--    و`booked_at` فيُبرّئ الكودَ المكسور (v15.40 · v15.22 · v14.97).
DO $verify$
DECLARE
  nude text := '--[^' || chr(10) || ']*';
  s_w text; s_b text; s_m text; s_g text; s_t text;
BEGIN
  s_w := regexp_replace(pg_get_functiondef('public.buyer_confirm_receipt(text)'::regprocedure), nude, '', 'g');
  s_b := regexp_replace(pg_get_functiondef('public.bot_buyer_confirm_receipt(bigint,text,text)'::regprocedure), nude, '', 'g');
  s_m := regexp_replace(pg_get_functiondef('public.merchant_handover_booking(text)'::regprocedure), nude, '', 'g');
  s_g := regexp_replace(pg_get_functiondef('public.tr_guard_booking_delivery()'::regprocedure), nude, '', 'g');
  s_t := regexp_replace(pg_get_functiondef('public.tr_ag_stamp_ack()'::regprocedure), nude, '', 'g');

  IF position('acknowledged_at' IN (SELECT string_agg(column_name,',') FROM information_schema.columns
       WHERE table_schema='public' AND table_name='bookings')) = 0 THEN
    RAISE EXCEPTION '❌ العمود acknowledged_at لم يُضَف';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.bookings'::regclass
                   AND tgname='tr_ag_stamp_ack' AND NOT tgisinternal) THEN
    RAISE EXCEPTION '❌ مشغّلُ ختم لحظةِ التأكيد غائب';
  END IF;
  IF position('OLD.acknowledged_at' IN s_t) = 0 THEN
    RAISE EXCEPTION '❌ المشغّل لا يحفظ القيمةَ القديمة — تُزوَّر أو تُمحى بأي تعديل';
  END IF;

  FOR s_w IN SELECT unnest(ARRAY[s_w, s_b, s_m]) LOOP
    IF position('taki_self_close_opens_at' IN s_w) = 0 THEN
      RAISE EXCEPTION '❌ بوّابةٌ ما زالت تقيس من لحظة الحجز لا من تأكيد التاجر';
    END IF;
    IF position('acknowledged_at IS NULL' IN s_w) = 0 THEN
      RAISE EXCEPTION '❌ بوّابةٌ لا تفرّق «لم يؤكّد بعد» عن «لم تمضِ المهلة»';
    END IF;
  END LOOP;

  IF position('ack_at_ms' IN regexp_replace(pg_get_functiondef(
       'public.bot_get_my_bookings(bigint,text,text)'::regprocedure), nude, '', 'g')) = 0 THEN
    RAISE EXCEPTION '❌ ردُّ البوتين بلا مرساةٍ رقميّة — البوّابةُ ستحسب NaN وتُفتح دائماً';
  END IF;
  IF position('deal_payment_mode(NEW.store_id)' IN s_g) = 0 THEN
    RAISE EXCEPTION '❌ حارسُ النقد ما زال يقرأ accepts_cod الخام — ينحرف عمّا يراه المشتري';
  END IF;
  IF EXISTS (SELECT 1 FROM public.taki_audit_payment_drift()) THEN
    RAISE EXCEPTION '❌ ما زال هناك انحرافٌ بين الإقرار والمعروض: %',
      (SELECT string_agg(store_id, ', ') FROM public.taki_audit_payment_drift());
  END IF;
END
$verify$;

-- ── تحقّقٌ **سلوكيّ** — والنصّيُّ وحده لا يُثبت حياةَ حارس (درس v15.42) ────
DO $behave$
DECLARE
  v_deal text; v_store text; v_buyer text;
  v_now bigint := (EXTRACT(EPOCH FROM NOW())*1000)::bigint;
  v_bc text; v_st text; v_ack timestamptz; v_det text; v_err text;
BEGIN
  SELECT d.id, d.store_id INTO v_deal, v_store
    FROM public.deals d
   WHERE d.status='active' AND COALESCE(d.quantity,0) > 2
     AND COALESCE((public.store_can_sell(d.store_id)->>'ok')::boolean,false)
   ORDER BY d.quantity DESC LIMIT 1;
  IF v_deal IS NULL THEN RAISE EXCEPTION '❌ لا عرضَ صالحاً للاختبار السلوكيّ'; END IF;
  SELECT u.id INTO v_buyer FROM public.users u
   WHERE u.id <> v_store AND u.deleted_at IS NULL ORDER BY u.created_at LIMIT 1;
  IF v_buyer IS NULL THEN RAISE EXCEPTION '❌ لا مشتريَ للاختبار السلوكيّ'; END IF;

  BEGIN
    v_bc := '94' || lpad(((random()*99999999)::bigint)::text, 8, '7');
    INSERT INTO public.bookings (barcode, backup_code, deal_id, user_id, store_id,
                                 booked_quantity, status, booked_at, fulfillment, source, payment_method)
    VALUES (v_bc, v_bc, v_deal, v_buyer, v_store, 1, 'pending', v_now, 'pickup', 'web', 'card');

    -- (أ) طلبٌ لم يُؤكَّد ومهلتُه طويلة: الرفضُ P0029 لا P0028
    SELECT acknowledged_at INTO v_ack FROM public.bookings WHERE barcode = v_bc;
    IF v_ack IS NOT NULL THEN RAISE EXCEPTION '❌ خُتمت لحظةُ تأكيد لطلبٍ لم يُؤكَّد'; END IF;

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_buyer, 'role','authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_buyer, true);
    BEGIN
      PERFORM public.buyer_confirm_receipt(v_bc);
      RAISE EXCEPTION '❌ قُبل الختمُ الذاتيّ قبل تأكيد التاجر';
    EXCEPTION WHEN SQLSTATE 'P0029' THEN NULL;
    END;

    -- (ب) التاجر يؤكّد ⇒ تُختم اللحظة، والرفضُ يصير P0028 (المهلة)
    PERFORM set_config('request.jwt.claims', NULL, true);
    PERFORM set_config('request.jwt.claim.sub', NULL, true);
    UPDATE public.bookings SET status='acknowledged' WHERE barcode = v_bc;
    SELECT acknowledged_at INTO v_ack FROM public.bookings WHERE barcode = v_bc;
    IF v_ack IS NULL THEN RAISE EXCEPTION '❌ لم تُختم لحظةُ التأكيد عند التحوّل'; END IF;

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_buyer, 'role','authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_buyer, true);
    BEGIN
      PERFORM public.buyer_confirm_receipt(v_bc);
      RAISE EXCEPTION '❌ قُبل الختمُ لحظةَ التأكيد — المهلةُ لا تحرس';
    EXCEPTION WHEN SQLSTATE 'P0028' THEN
      GET STACKED DIAGNOSTICS v_det = PG_EXCEPTION_DETAIL;
      IF v_det::integer NOT BETWEEN 590 AND 600 THEN
        RAISE EXCEPTION '❌ المتبقّي % — المتوقّع ≈٦٠٠ من لحظة التأكيد', v_det;
      END IF;
    END;

    -- (ج) لا يُعاد الختمُ ولا يُمحى بتعديلٍ لاحق
    PERFORM set_config('request.jwt.claims', NULL, true);
    UPDATE public.bookings SET merchant_note = 'x' WHERE barcode = v_bc;
    IF (SELECT acknowledged_at FROM public.bookings WHERE barcode = v_bc) IS DISTINCT FROM v_ack THEN
      RAISE EXCEPTION '❌ تبدّلت لحظةُ التأكيد بتعديلٍ لا علاقة له بها';
    END IF;

    -- (د) ولا تُزوَّر اللحظةُ إلى الماضي — حتى من جلسةٍ مالكة
    -- 🪤 اكتُشف بالتجربة: أوّلُ صيغةٍ لهذا الاختبار حاولت التقديمَ مباشرةً
    --    فردّها المشغّلُ وأسقطت الهجرة. وهو يعمل كما صُمّم — فصار الردُّ
    --    نفسُه تأكيداً يُشترط، لا عقبةً تُلتَفّ.
    UPDATE public.bookings
       SET acknowledged_at = v_ack - interval '3 hours'
     WHERE barcode = v_bc;
    IF (SELECT acknowledged_at FROM public.bookings WHERE barcode = v_bc) IS DISTINCT FROM v_ack THEN
      RAISE EXCEPTION '❌ أمكن تقديمُ لحظة التأكيد — المهلةُ تُلتَفّ بتعديلٍ واحد';
    END IF;

    -- (هـ) وبعد مضيّ المهلة من **لحظة التأكيد** يُقبل، ويُقرأ الأثر.
    --     والتقديمُ هنا بتعطيل المشغّل عمداً داخل المعاملة — لا ثغرةَ فيه:
    --     `ALTER TABLE` يحتاج ملكيّةَ الجدول، وهي ليست بيد أحدٍ من المستخدمين.
    -- 🪤 ويُشاخ `booked_at` معها: أرضيّةُ «لا قبل المهلة من الحجز» صحيحةٌ دائماً
    --    في الواقع (لا تأكيدَ قبل حجز)، لكنّ تقديمَ التأكيد وحده يصنع حالةً
    --    مستحيلة فتردّها الأرضيّةُ بحقّ — وقد أسقطت هذا الاختبارَ أوّلَ مرّة.
    ALTER TABLE public.bookings DISABLE TRIGGER tr_ag_stamp_ack;
    ALTER TABLE public.bookings DISABLE TRIGGER tr_ab_guard_booking_integrity;
    UPDATE public.bookings
       SET booked_at       = v_now - ((public.taki_self_close_minutes() + 2) * 60000)::bigint,
           acknowledged_at = v_ack - ((public.taki_self_close_minutes() + 1) || ' minutes')::interval
     WHERE barcode = v_bc;
    ALTER TABLE public.bookings ENABLE TRIGGER tr_ab_guard_booking_integrity;
    ALTER TABLE public.bookings ENABLE TRIGGER tr_ag_stamp_ack;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_buyer, 'role','authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_buyer, true);
    PERFORM public.buyer_confirm_receipt(v_bc);
    SELECT status INTO v_st FROM public.bookings WHERE barcode = v_bc;
    IF v_st <> 'completed' THEN
      RAISE EXCEPTION '❌ بعد المهلة لم يقع الختم (status=%)', v_st;
    END IF;

    -- (ز) 🔴 الفتحةُ الاحتياطيّة: طلبٌ **لم يُؤكَّد** ومهلتُه توشك ⇒ يُفتح الزرّ.
    --     وهذه هي الحالةُ التي أسقطت الصيغةَ الأولى من هذا الإصدار: بدونها
    --     تبقى ١٤٪ من الطلبات بلا مخرجٍ للمشتري أبداً.
    PERFORM set_config('request.jwt.claims', NULL, true);
    PERFORM set_config('request.jwt.claim.sub', NULL, true);
    v_bc := '92' || lpad(((random()*99999999)::bigint)::text, 8, '7');
    INSERT INTO public.bookings (barcode, backup_code, deal_id, user_id, store_id,
                                 booked_quantity, status, booked_at, fulfillment, source, payment_method)
    VALUES (v_bc, v_bc, v_deal, v_buyer, v_store, 1, 'pending', v_now, 'pickup', 'web', 'card');
    -- شِخ الطلبَ حتى يبقى على مهلته أقلُّ من مهلة الختم (المشغّلُ يحرس
    -- `acknowledged_at` وحدها، و`expiry_time` مجمَّدٌ بحارس التجميد لا بنا).
    ALTER TABLE public.bookings DISABLE TRIGGER tr_ab_guard_booking_integrity;
    -- 🪤 ويلزم تقديمُ `booked_at` أيضاً: القاعدةُ «لا قبل مهلةِ الختم من الحجز»
    --    هي الغالبةُ وحدها لو بقي الحجزُ لحظيّاً — وأوّلُ صيغةٍ لهذا الاختبار
    --    نسيتها فسقطت بـP0029 وكشفت أن الأرضيّة تعمل.
    UPDATE public.bookings
       SET booked_at   = (EXTRACT(EPOCH FROM NOW())*1000)::bigint - 20*60000,
           expiry_time = (EXTRACT(EPOCH FROM NOW())*1000)::bigint
                         + ((public.taki_self_close_minutes() - 1) * 60000)::bigint
     WHERE barcode = v_bc;
    ALTER TABLE public.bookings ENABLE TRIGGER tr_ab_guard_booking_integrity;
    IF (SELECT acknowledged_at FROM public.bookings WHERE barcode = v_bc) IS NOT NULL THEN
      RAISE EXCEPTION '❌ خُتم تأكيدٌ لم يقع';
    END IF;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_buyer, 'role','authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_buyer, true);
    PERFORM public.buyer_confirm_receipt(v_bc);
    SELECT status INTO v_st FROM public.bookings WHERE barcode = v_bc;
    IF v_st <> 'completed' THEN
      RAISE EXCEPTION '❌ طلبٌ لم يُؤكَّد ومهلتُه توشك: ما زال بلا مخرج (status=%)', v_st;
    END IF;
    PERFORM set_config('request.jwt.claims', NULL, true);
    PERFORM set_config('request.jwt.claim.sub', NULL, true);

    -- (ط) 🔴 نافذةٌ لا تكون خالية أبداً: مهلةٌ قصيرة + تأكيدٌ متأخّر.
    PERFORM set_config('request.jwt.claims', NULL, true);
    PERFORM set_config('request.jwt.claim.sub', NULL, true);
    v_bc := '91' || lpad(((random()*99999999)::bigint)::text, 8, '7');
    INSERT INTO public.bookings (barcode, backup_code, deal_id, user_id, store_id,
                                 booked_quantity, status, booked_at, fulfillment, source, payment_method)
    VALUES (v_bc, v_bc, v_deal, v_buyer, v_store, 1, 'pending', v_now, 'pickup', 'web', 'card');
    UPDATE public.bookings SET status = 'acknowledged' WHERE barcode = v_bc;
    ALTER TABLE public.bookings DISABLE TRIGGER tr_ab_guard_booking_integrity;
    ALTER TABLE public.bookings DISABLE TRIGGER tr_ag_stamp_ack;
    UPDATE public.bookings
       SET booked_at       = v_now - 6*60000,            -- حُجز قبل ٦ دقائق
           expiry_time     = v_now + 9*60000,            -- ومهلتُه ١٥ دقيقة
           acknowledged_at = NOW()                        -- وأُكّد الآن (متأخّراً)
     WHERE barcode = v_bc;
    ALTER TABLE public.bookings ENABLE TRIGGER tr_ag_stamp_ack;
    ALTER TABLE public.bookings ENABLE TRIGGER tr_ab_guard_booking_integrity;
    IF (SELECT public.taki_self_close_opens_at(b) FROM public.bookings b WHERE b.barcode = v_bc)
       >= (SELECT expiry_time FROM public.bookings WHERE barcode = v_bc) THEN
      RAISE EXCEPTION '❌ الزرُّ يُفتح بعد انتهاء المهلة — نافذةٌ خالية';
    END IF;

    -- (ي) 🔴 ولا يُقِرُّ المشغّلُ عمّن لم ينطق.
    IF EXISTS (SELECT 1 FROM public.store_profiles WHERE payment_declared_at IS NULL) THEN
      UPDATE public.merchant_gateways SET payment_modes = payment_modes WHERE false;  -- لا شيء
      IF EXISTS (SELECT 1 FROM public.store_profiles sp
                  WHERE sp.payment_declared_at IS NULL
                    AND EXISTS (SELECT 1 FROM public.merchant_gateways g WHERE g.merchant_id = sp.store_id)) THEN
        RAISE EXCEPTION '❌ متجرٌ له بوّابة وبلا إقرار — المشغّلُ خَتَم عنه';
      END IF;
    END IF;

    -- (ك) والنقدُ صار مقبولاً حيث تعرضه الواجهة — عيبُ متجر ناصر مُصلَح
    PERFORM set_config('request.jwt.claims', NULL, true);
    PERFORM set_config('request.jwt.claim.sub', NULL, true);
    IF public.deal_payment_mode(v_store) <> 'online' THEN
      v_bc := '93' || lpad(((random()*99999999)::bigint)::text, 8, '7');
      INSERT INTO public.bookings (barcode, backup_code, deal_id, user_id, store_id,
                                   booked_quantity, status, booked_at, fulfillment, source, payment_method)
      VALUES (v_bc, v_bc, v_deal, v_buyer, v_store, 1, 'pending', v_now, 'pickup', 'web', 'cod');
      IF NOT EXISTS (SELECT 1 FROM public.bookings WHERE barcode = v_bc) THEN
        RAISE EXCEPTION '❌ رُفض طلبٌ نقديّ ومتجرُه يعرض النقد';
      END IF;
    END IF;

    RAISE EXCEPTION 'TAKI_V1544_ROLLBACK';
  EXCEPTION
    WHEN OTHERS THEN
      PERFORM set_config('request.jwt.claims', NULL, true);
      PERFORM set_config('request.jwt.claim.sub', NULL, true);
      IF SQLERRM <> 'TAKI_V1544_ROLLBACK' THEN RAISE; END IF;
  END;
END
$behave$;

-- ── جدولٌ للقراءة (الإفشالُ أعلاه) ─────────────────────────────────────────
SELECT 'الخادم' AS "البند", current_setting('server_version') AS "القيمة"
UNION ALL SELECT 'المختبر؟', COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'(لا وسم)')
UNION ALL SELECT 'عمود لحظة التأكيد', CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
   WHERE table_schema='public' AND table_name='bookings' AND column_name='acknowledged_at') THEN '✅' ELSE '❌' END
UNION ALL SELECT 'مشغّل ختم اللحظة', CASE WHEN EXISTS (SELECT 1 FROM pg_trigger
   WHERE tgrelid='public.bookings'::regclass AND tgname='tr_ag_stamp_ack' AND NOT tgisinternal) THEN '✅' ELSE '❌' END
UNION ALL SELECT 'حارسُ النقد يقرأ ما يراه المشتري',
   CASE WHEN position('deal_payment_mode(NEW.store_id)' IN pg_get_functiondef('public.tr_guard_booking_delivery()'::regprocedure))>0 THEN '✅' ELSE '❌' END
UNION ALL SELECT 'انحرافُ طريقة الحساب', (SELECT count(*)::text FROM public.taki_audit_payment_drift())||' متجر'
UNION ALL SELECT 'متجر ناصر: المعروض', public.deal_payment_mode('2c0b4cde-79c3-4290-abaa-812a895b1bcb')
UNION ALL SELECT 'متجر ناصر: الإقرار',
   (SELECT COALESCE(accepts_cod::text,'null') FROM public.store_profiles WHERE store_id='2c0b4cde-79c3-4290-abaa-812a895b1bcb');

