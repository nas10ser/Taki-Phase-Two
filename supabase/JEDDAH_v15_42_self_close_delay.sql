-- ═══════════════════════════════════════════════════════════════════════════
-- v15.42 — «استلمتُ طلبي» لا تُفتح لحظةَ الحجز · واختصارُ تسليمٍ للتاجر
-- ═══════════════════════════════════════════════════════════════════════════
-- أمرُ ناصر: «استلمت طلبي أظهرها بعد استلام الطلب من المتجر ١٠ دقائق ولا
-- تظهرها مباشرة، وأيضاً أظهر للتاجر اختصاراً في حال أراد تسليم الطلب بعد
-- ١٠ دقائق من استلام الطلب».
--
-- 🔴 والعلّةُ حقيقيّةٌ لا تجميل: v15.41 (قبل ساعات) أعطت المشتري زرَّ إغلاق
--    طلبِ الاستلام، وهو يظهر **لحظةَ الحجز**. فمشترٍ ضغطه وهو في بيته يُختم
--    طلبُه «مكتملاً»: تُصدَر فاتورتُه الضريبيّة وتُحسب ضريبتُها ويُخصم المخزون
--    ويفقد حقَّ الإلغاء — وهو لم يذهب إلى المتجر أصلاً. والعشرُ دقائق أرضيّةٌ
--    زمنيّة تقول: لا يُختم طلبٌ قبل أن يمضي وقتٌ يكفي للوصول.
--
-- 🪤 والساعةُ تبدأ من `booked_at` — لحظةِ وصول الطلب إلى المتجر. ولا عمودَ
--    «لحظة التأكيد» في `bookings` إطلاقاً، فربطُها بحالة `acknowledged` كان
--    سيجعل المهلةَ تبدأ متى شاء التاجر (أو لا تبدأ أبداً إن لم يؤكّد).
--
-- 🪤 والرقمُ داخل `platform_settings.booking_holds` نفسِه — حقلٌ رابع في صفٍّ
--    قائم. وهذا **قصدٌ لا راحة**: مفتاحٌ جديد يحتاج ثلاثةَ مواضع (فرعُ
--    التطبيق · قائمةُ الجلب · قائمةُ السماح في RLS) ونسيانُ الثالث يُعيد
--    `SELECT` بصفر صفوفٍ لا بخطأ (v14.92 · v15.25). و`booking_holds` في
--    قائمة السماح أصلاً، فحقلٌ داخله يرثُ إذنَه.
--
-- 🔴 وثُلمةٌ قائمةٌ تُسدّ هنا: `complete_booking` كانت تسمح
--    `caller = store_id OR caller = user_id` — أي أن **المشتري** يستطيع ختم
--    طلبه بنداءٍ مباشر، فيلتفّ على هذه المهلة **وعلى حارس v14.10 كلِّه**
--    (شرطِ انطلاق المندوب في التوصيل). لا واجهةَ تستعمل ذلك الفرعَ إطلاقاً:
--    مواضعُ النداء الثلاثة كلُّها للتاجر (ماسحُ الباركود · لوحةُ التاجر ·
--    كتلةُ «التحقّق من الكود (للتاجر)» في صفحة العرض). فالمشتري مسارُه
--    `buyer_confirm_receipt` وحده — وهو المسارُ المحروس.
--
-- 🪤 واختصارُ التاجر دالّةٌ مستقلّة لا تعديلٌ على `complete_booking`: مسارُ
--    الكود (مسحاً أو كتابةً) يبقى **فورياً بلا أيّ مهلة** — فعميلٌ واقفٌ عند
--    الصندوق بعد دقيقتين يُسلَّم طلبُه كما كان. المحروسُ هو الختمُ **بلا
--    كودٍ** وحده.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── حارس المختبر ───────────────────────────────────────────────────────────
DO $guard$
BEGIN
  IF COALESCE(obj_description('public'::regnamespace, 'pg_namespace'), '')
     = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر. أوقِفت.';
  END IF;

  IF to_regprocedure('public.buyer_confirm_receipt(text)') IS NULL
     OR to_regprocedure('public.bot_buyer_confirm_receipt(bigint,text,text)') IS NULL
     OR to_regprocedure('public.complete_booking(text)') IS NULL THEN
    RAISE EXCEPTION 'دالّةٌ من أساس v14.10/v15.41 غائبة — الأساسُ مختلف، أوقِفت.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.platform_settings WHERE key = 'booking_holds') THEN
    RAISE EXCEPTION 'صفُّ booking_holds غائب — لا موضعَ للرقم، أوقِفت.';
  END IF;
END
$guard$;

-- ── ١) الرقم: حقلٌ رابع في صفٍّ قائم، ولا يُدهس ضبطُ ناصر عند إعادة التنفيذ ──
UPDATE public.platform_settings
   SET value = value || jsonb_build_object('self_close_minutes', 10)
 WHERE key = 'booking_holds'
   AND NOT (value ? 'self_close_minutes');

-- ── ٢) قارئُ الرقم — مكانٌ واحد، بسقفٍ وأرضيّة ─────────────────────────────
-- 🪤 `NULLIF(…,'')`: نصٌّ فارغ يُفجّر التحويل، و`Number(null)`‑ـيّةُ السطر
--    القديم (v14.92) كانت تُنتج صفراً بدل الافتراضي. و٠ قيمةٌ صالحة تعني
--    «بلا مهلة» — فالأرضيّة ٠ لا ٠٫٢٥.
CREATE OR REPLACE FUNCTION public.taki_self_close_minutes()
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT GREATEST(0, LEAST(1440, COALESCE(
    (SELECT NULLIF(value->>'self_close_minutes','')::numeric
       FROM public.platform_settings WHERE key = 'booking_holds' LIMIT 1),
    10)));
$function$;

REVOKE ALL ON FUNCTION public.taki_self_close_minutes() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_self_close_minutes() FROM anon;
GRANT EXECUTE ON FUNCTION public.taki_self_close_minutes() TO authenticated, service_role;

-- ── ٣) الموقع: «استلمتُ طلبي» ──────────────────────────────────────────────
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
  v_left := ceil(
    (COALESCE(v_b.booked_at,0)
       + (public.taki_self_close_minutes() * 60000)::bigint
       - (EXTRACT(EPOCH FROM NOW())*1000)::bigint) / 1000.0);
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

-- ── ٤) البوتان: توأمُ الزرّ ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bot_buyer_confirm_receipt(p_telegram_id bigint, p_barcode text, p_whatsapp_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid text; v_b public.bookings%ROWTYPE; v_trk text; v_left integer;
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
  v_left := ceil(
    (COALESCE(v_b.booked_at,0)
       + (public.taki_self_close_minutes() * 60000)::bigint
       - (EXTRACT(EPOCH FROM NOW())*1000)::bigint) / 1000.0);
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

-- ── ٥) اختصارُ التاجر: ختمٌ بلا كود، على نفس الساعة ────────────────────────
-- 🪤 ولا تُنادى `complete_booking` من داخلها: تلك تُفرّق «ليس لك» من «مغلق»
--    بنفسها فتُنتج رسالتين متضاربتين، والختمُ نفسُه سطرُ `UPDATE` واحد —
--    وكلُّ الأثر (الفاتورة · المخزون · الإشعار) في المشغّلات لا في الدالّة.
--    و`completed_by='seller'` تقول من ختم، كما تقول `'buyer'` اليوم.
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

  v_left := ceil(
    (COALESCE(v_b.booked_at,0)
       + (public.taki_self_close_minutes() * 60000)::bigint
       - (EXTRACT(EPOCH FROM NOW())*1000)::bigint) / 1000.0);
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

REVOKE ALL ON FUNCTION public.merchant_handover_booking(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merchant_handover_booking(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.merchant_handover_booking(text) TO authenticated, service_role;

-- ── ٦) سدُّ الثُّلمة: ختمُ الطلب للتاجر وحده ────────────────────────────────
-- 🪤 والفرعُ التشخيصيّ يُضيَّق معه: لو بقي يسأل «أهو لك بائعاً أو مشترياً؟»
--    لقال للمشتري «مغلقٌ بالفعل» وهو مفتوح — كذبةٌ تُرسل الناسَ إلى الدعم.
CREATE OR REPLACE FUNCTION public.complete_booking(p_barcode text)
 RETURNS bookings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    caller text := auth.uid()::text;
    updated public.bookings;
BEGIN
    IF caller IS NULL THEN
        RAISE EXCEPTION 'يجب تسجيل الدخول لإتمام الحجز' USING ERRCODE = '28000';
    END IF;

    -- v15.42 — التاجرُ وحده. والمشتري مسارُه `buyer_confirm_receipt`، وفيه
    -- حارسُ انطلاقِ المندوب ومهلةُ العشر دقائق — وكان هذا الفرعُ يلتفّ عليهما.
    UPDATE public.bookings
    SET status = 'completed'
    WHERE barcode = p_barcode
      AND status IN ('pending', 'acknowledged')
      AND caller = store_id
    RETURNING * INTO updated;

    IF updated.barcode IS NULL THEN
        IF EXISTS (
            SELECT 1 FROM public.bookings
            WHERE barcode = p_barcode
              AND caller = store_id
        ) THEN
            RAISE EXCEPTION 'الحجز مغلق بالفعل أو ملغى' USING ERRCODE = 'P0001';
        ELSE
            RAISE EXCEPTION 'لم يتم العثور على الحجز أو ليست لديك صلاحية' USING ERRCODE = 'P0002';
        END IF;
    END IF;

    RETURN updated;
END;
$function$;

-- ── تحقّقٌ يُفشل الهجرة إن كذبت ─────────────────────────────────────────────
-- 🪤 يُجرَّد التعليقُ قبل أيّ فحصِ نصّ: شرحُ هذه الهجرة نفسُه يحوي
--    `taki_self_close_minutes` و`caller = user_id` — فيُبرّئ الكودَ المكسور
--    (درسُ v15.40 · v15.22 · v14.97).
DO $verify$
DECLARE
  nude   text;
  src_w  text; src_b text; src_m text; src_c text;
  v_min  numeric;
BEGIN
  nude := '--[^' || chr(10) || ']*';
  src_w := regexp_replace(pg_get_functiondef('public.buyer_confirm_receipt(text)'::regprocedure), nude, '', 'g');
  src_b := regexp_replace(pg_get_functiondef('public.bot_buyer_confirm_receipt(bigint,text,text)'::regprocedure), nude, '', 'g');
  src_m := regexp_replace(pg_get_functiondef('public.merchant_handover_booking(text)'::regprocedure), nude, '', 'g');
  src_c := regexp_replace(pg_get_functiondef('public.complete_booking(text)'::regprocedure), nude, '', 'g');

  -- (أ) الرقمُ موجودٌ وقيمتُه المقصودة
  v_min := public.taki_self_close_minutes();
  IF v_min IS NULL OR v_min <= 0 THEN
    RAISE EXCEPTION '❌ taki_self_close_minutes() = % — المهلةُ معطّلة فالحارسُ لا يحرس', v_min;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.platform_settings
                  WHERE key='booking_holds' AND value ? 'self_close_minutes') THEN
    RAISE EXCEPTION '❌ الحقلُ غائبٌ عن صفّ booking_holds — الدالّةُ تردّ افتراضياً لا مضبوطاً';
  END IF;

  -- (ب) المهلةُ مفروضةٌ في المسارات الثلاثة، كلٌّ بأسلوب قناته
  IF position('taki_self_close_minutes' IN src_w) = 0
     OR position('P0028' IN src_w) = 0 THEN
    RAISE EXCEPTION '❌ مهلةُ الختم الذاتيّ غائبةٌ عن مسار الموقع';
  END IF;
  IF position('taki_self_close_minutes' IN src_b) = 0
     OR position('too_soon' IN src_b) = 0 THEN
    RAISE EXCEPTION '❌ مهلةُ الختم الذاتيّ غائبةٌ عن مسار البوتين';
  END IF;
  IF position('taki_self_close_minutes' IN src_m) = 0
     OR position('P0028' IN src_m) = 0 THEN
    RAISE EXCEPTION '❌ مهلةُ الاختصار غائبةٌ عن دالّة التاجر';
  END IF;

  -- (ج) حارسُ v14.10/v15.41 لم يسقط أثناء التوسعة — إضافةٌ لا إضعاف
  IF position('on_the_way' IN src_w) = 0 OR position('on_the_way' IN src_b) = 0 THEN
    RAISE EXCEPTION '❌ شرطُ انطلاق المندوب سقط عن التوصيل — هذا إضعافٌ لا توسعة';
  END IF;

  -- (د) الثُّلمة سُدّت: لا فرعَ مشترٍ في ختم التاجر
  IF position('caller = user_id' IN src_c) > 0 THEN
    RAISE EXCEPTION '❌ complete_booking ما زالت تسمح للمشتري — المهلةُ قابلةٌ للالتفاف';
  END IF;
  IF position('caller = store_id' IN src_c) = 0 THEN
    RAISE EXCEPTION '❌ complete_booking لم تبقِ صلاحيةَ التاجر — هذا كسرٌ لا سدّ';
  END IF;

  -- (هـ) الاختصارُ للتاجر وحده، لا للمشتري
  IF position('store_id IS DISTINCT FROM v_uid' IN src_m) = 0 THEN
    RAISE EXCEPTION '❌ merchant_handover_booking لا تتحقّق من ملكيّة المتجر';
  END IF;

  -- (و) الصلاحيات: لا زائرَ على الدالّة الجديدة
  IF has_function_privilege('anon', 'public.merchant_handover_booking(text)', 'EXECUTE') THEN
    RAISE EXCEPTION '❌ anon يملك EXECUTE على merchant_handover_booking';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.merchant_handover_booking(text)', 'EXECUTE') THEN
    RAISE EXCEPTION '❌ authenticated لا يملك EXECUTE — التاجرُ لن يستطيع النداء';
  END IF;

  -- (ز) الحسابُ نفسُه: الصفرُ لا يحجب، والدقيقةُ تحجب
  IF ceil((0 + (0 * 60000)::bigint - 0) / 1000.0) > 0 THEN
    RAISE EXCEPTION '❌ حسابُ المتبقّي يحجب عند مهلةٍ صفرية';
  END IF;
  IF ceil((1000000 + (10 * 60000)::bigint - 1000000) / 1000.0) <> 600 THEN
    RAISE EXCEPTION '❌ حسابُ المتبقّي لا يُنتج ٦٠٠ ثانية لعشر دقائق';
  END IF;
END
$verify$;

-- ── تحقّقٌ **سلوكيّ** داخل الهجرة — والفحصُ النصّيّ أعلاه لا يكفي ─────────────
-- 🔴 قِيس، ولم يكن تخميناً: كسرةٌ تُبقي `taki_self_close_minutes` و`P0028` في
--    جسم الدالّة وتُصفّر `v_left` قبلهما **تمرّ على الفحص النصّيّ كلِّه**. أي
--    أن الفحصَ النصّيّ يُثبت وجودَ الرمز لا حياةَ الحارس — وهذا من عائلة
--    «حرّاسٌ لا تستطيع الفشل». فالحكمُ الحقيقيّ هنا: طلبٌ يُصنع ويُجرَّب
--    ويُمحى.
-- 🪤 والإرجاعُ بمعاملةٍ فرعيّة: استثناءٌ داخل كتلة `BEGIN…EXCEPTION` يُرجع كلَّ
--    ما جرى داخلها، فتبقى الهجرةُ بلا أثرٍ وإن لم تكن في معاملةٍ صريحة.
-- 🪤 ولا تُخمَّن بياناتُ الاختبار: تُنتقى من القاعدة، ويُرفض التنفيذُ إن لم
--    يوجد موضوعٌ صالح — فاختبارٌ يُتخطّى بصمت اختبارٌ لا يفشل أبداً.
DO $behave$
DECLARE
  v_deal  text; v_store text; v_buyer text;
  v_now   bigint := (EXTRACT(EPOCH FROM NOW())*1000)::bigint;
  v_bc    text;
  v_st    text; v_by text; v_det text;
BEGIN
  SELECT d.id, d.store_id INTO v_deal, v_store
    FROM public.deals d
   WHERE d.status = 'active' AND COALESCE(d.quantity,0) > 1
     AND COALESCE((public.store_can_sell(d.store_id)->>'ok')::boolean,false)
   ORDER BY d.quantity DESC LIMIT 1;
  IF v_deal IS NULL THEN
    RAISE EXCEPTION '❌ لا عرضَ صالحاً للاختبار السلوكيّ — لا يُعتمد فحصٌ نصّيٌّ وحده';
  END IF;

  SELECT u.id INTO v_buyer FROM public.users u
   WHERE u.id <> v_store AND u.deleted_at IS NULL ORDER BY u.created_at LIMIT 1;
  IF v_buyer IS NULL THEN
    RAISE EXCEPTION '❌ لا مشتريَ للاختبار السلوكيّ';
  END IF;

  v_bc := '98' || lpad(((random()*99999999)::bigint)::text, 8, '7');

  BEGIN
    -- طلبٌ لحظتُه الآن. 🪤 و`payment_method` لازمة: متجرٌ لا يقبل النقد يرفض
    -- الطلبَ عند الباب (`TAKI_STORE_CARD_ONLY`) فلا يبلغ ما نفحصه.
    INSERT INTO public.bookings (barcode, backup_code, deal_id, user_id, store_id,
                                 booked_quantity, status, booked_at, fulfillment, source, payment_method)
    VALUES (v_bc, v_bc, v_deal, v_buyer, v_store, 1, 'pending', v_now, 'pickup', 'web', 'card');

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_buyer, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_buyer, true);

    -- (ح١) المهلةُ تحجب فعلاً لحظةَ الحجز
    BEGIN
      PERFORM public.buyer_confirm_receipt(v_bc);
      RAISE EXCEPTION '❌ قُبل الختمُ الذاتيّ لحظةَ الحجز — الحارسُ ميّتٌ وإن كان رمزُه مكتوباً';
    EXCEPTION
      WHEN SQLSTATE 'P0028' THEN
        GET STACKED DIAGNOSTICS v_det = PG_EXCEPTION_DETAIL;
        IF COALESCE(v_det,'0')::integer <= 0 THEN
          RAISE EXCEPTION '❌ رُفض بـP0028 والمتبقّي % — الحسابُ مقلوب', v_det;
        END IF;
    END;

    SELECT status INTO v_st FROM public.bookings WHERE barcode = v_bc;
    IF v_st <> 'pending' THEN
      RAISE EXCEPTION '❌ الرفضُ كتب في الصفّ (status=%)', v_st;
    END IF;

    -- (ح٢) وتسمح فعلاً بعد مضيّها — وإلّا كان الحارسُ سدّاً دائماً
    PERFORM set_config('request.jwt.claims', NULL, true);
    PERFORM set_config('request.jwt.claim.sub', NULL, true);
    UPDATE public.bookings
       SET booked_at = v_now - ((public.taki_self_close_minutes() + 1) * 60000)::bigint
     WHERE barcode = v_bc;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_buyer, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_buyer, true);
    PERFORM public.buyer_confirm_receipt(v_bc);
    SELECT status, completed_by INTO v_st, v_by FROM public.bookings WHERE barcode = v_bc;
    IF v_st <> 'completed' OR v_by <> 'buyer' THEN
      RAISE EXCEPTION '❌ بعد المهلة لم يقع الختم (status=% · by=%)', v_st, v_by;
    END IF;

    -- (ح٣) الثُّلمة: المشتري لا يختم بنداءٍ مباشر
    -- 🪤 وعلى طلبٍ **ثانٍ** لا بإحياء الأوّل: `tr_guard_booking_status` يمنع
    --    إحياءَ المختوم (v14.29)، فالإحياءُ كان سيُسقط الهجرةَ لسببٍ آخر.
    PERFORM set_config('request.jwt.claims', NULL, true);
    PERFORM set_config('request.jwt.claim.sub', NULL, true);
    v_bc := '97' || lpad(((random()*99999999)::bigint)::text, 8, '7');
    INSERT INTO public.bookings (barcode, backup_code, deal_id, user_id, store_id,
                                 booked_quantity, status, booked_at, fulfillment, source, payment_method)
    VALUES (v_bc, v_bc, v_deal, v_buyer, v_store, 1, 'pending', v_now, 'pickup', 'web', 'card');
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_buyer, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_buyer, true);
    BEGIN
      PERFORM public.complete_booking(v_bc);
      RAISE EXCEPTION '❌ المشتري ختم طلبه عبر complete_booking — الثُّلمةُ قائمة';
    EXCEPTION WHEN SQLSTATE 'P0002' THEN NULL;
    END;

    PERFORM set_config('request.jwt.claims', NULL, true);
    PERFORM set_config('request.jwt.claim.sub', NULL, true);
    RAISE EXCEPTION 'TAKI_V1542_ROLLBACK';
  EXCEPTION
    WHEN OTHERS THEN
      PERFORM set_config('request.jwt.claims', NULL, true);
      PERFORM set_config('request.jwt.claim.sub', NULL, true);
      IF SQLERRM <> 'TAKI_V1542_ROLLBACK' THEN RAISE; END IF;
  END;
END
$behave$;

-- ── جدولٌ للقراءة (لا يُفشل شيئاً — الإفشالُ أعلاه) ─────────────────────────
SELECT 'الخادم' AS "البند", current_setting('server_version') AS "القيمة"
UNION ALL SELECT 'المختبر؟', COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'(لا وسم)')
UNION ALL SELECT 'مهلة الختم الذاتيّ (دقيقة)', public.taki_self_close_minutes()::text
UNION ALL SELECT 'صفّ الإعدادات', (SELECT value::text FROM public.platform_settings WHERE key='booking_holds')
UNION ALL SELECT 'الموقع: المهلة', CASE WHEN position('taki_self_close_minutes' IN regexp_replace(pg_get_functiondef('public.buyer_confirm_receipt(text)'::regprocedure),'--[^'||chr(10)||']*','','g'))>0 THEN '✅' ELSE '❌' END
UNION ALL SELECT 'البوتان: المهلة', CASE WHEN position('taki_self_close_minutes' IN regexp_replace(pg_get_functiondef('public.bot_buyer_confirm_receipt(bigint,text,text)'::regprocedure),'--[^'||chr(10)||']*','','g'))>0 THEN '✅' ELSE '❌' END
UNION ALL SELECT 'اختصار التاجر', CASE WHEN to_regprocedure('public.merchant_handover_booking(text)') IS NOT NULL THEN '✅' ELSE '❌' END
UNION ALL SELECT 'ثُلمة المشتري في complete_booking', CASE WHEN position('caller = user_id' IN regexp_replace(pg_get_functiondef('public.complete_booking(text)'::regprocedure),'--[^'||chr(10)||']*','','g'))=0 THEN '✅ سُدّت' ELSE '❌ قائمة' END;
