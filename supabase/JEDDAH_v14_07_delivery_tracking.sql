-- ============================================================================
-- TAKI · v14.07 — تتبّع الطلب على الخريطة من المتجر إلى باب المشتري
-- ============================================================================
-- طلب ناصر: «أضف تتبّعاً للطلب من الخريطة للتاجر وهو يتحرك من المتجر للسكن».
--
-- ── المبدأ الحاكم: هذا موقع **إنسان** لا موقع طرد ────────────────────────────
-- بثّ موقع المندوب الحيّ أخطر ما تحمله المنصّة من بيانات، فالتصميم كله يدور
-- حول تضييقه:
--   • لا يبدأ إلا بضغطة صريحة من التاجر («بدء التوصيل») — لا تتبّع صامت.
--   • لا يقرأه إلا **مشتري ذلك الطلب** وتاجره، ولا أحد غيرهما (ولا حتى مشترٍ
--     آخر من نفس المتجر).
--   • ولا يقرؤه المشتري إلا **أثناء** التوصيل: ما إن ينتهي الطلب (تسليم أو
--     إلغاء) حتى **تُمحى الإحداثيات من الصفّ نفسه** — لا تبقى أثراً يُستخرج لاحقاً.
--   • الصفّ يُحذف تلقائياً مع الحجز (ON DELETE CASCADE).
--
-- ⚠️ لا تُكتب مواقع المندوب في `users.lat/lng` أبداً: ذلك العمود يحمل **دبّوس
--    المتجر**، وكتابته بموقع الجهاز الحيّ تُضيّع موقع المتجر على الخريطة
--    (درس v13.11 المدفوع الثمن).
--
-- آمنة للتكرار · تُطبَّق على خادم جدة حصراً.
-- ============================================================================

-- ── حارس: يرفض التنفيذ على مختبر طوكيو ──────────────────────────────────────
DO $guard$
BEGIN
  IF coalesce(obj_description('public'::regnamespace, 'pg_namespace'), '')
     = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION
      'رُفض التنفيذ: هذا مختبر طوكيو. هذه هجرة إنتاج وتُطبَّق على خادم جدة فقط.';
  END IF;
END
$guard$;

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- ١) جدول المسار — صفّ واحد لكل حجز (آخر نقطة فقط، لا أثر تاريخي)
-- ════════════════════════════════════════════════════════════════════════════
-- لماذا آخر نقطة فقط ولا مسار كامل؟ لأن المطلوب «أين هو الآن»، وحفظ خطّ سير
-- المندوب دقيقةً بدقيقة يبني سجلّ تحرّكات شخصياً لا حاجة للمنصّة به — وما لا
-- يُخزَّن لا يُسرَّب.
CREATE TABLE IF NOT EXISTS public.delivery_tracks (
  barcode     text PRIMARY KEY REFERENCES public.bookings(barcode) ON DELETE CASCADE,
  store_id    text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  user_id     text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  -- preparing = قيد التجهيز · on_the_way = في الطريق · arrived = وصل الموقع
  -- delivered = سُلِّم · cancelled = أُلغي
  status      text NOT NULL DEFAULT 'preparing'
              CHECK (status IN ('preparing','on_the_way','arrived','delivered','cancelled')),
  lat         double precision,
  lng         double precision,
  accuracy_m  double precision,
  heading     double precision,
  speed_kmh   double precision,
  -- مسافة خطّ مستقيم إلى العنوان لحظة آخر نبضة (تُحسب على الخادم لا على العميل)
  remaining_km numeric,
  eta_min     integer,
  note        text,
  started_at  timestamptz,
  ended_at    timestamptz,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_delivery_tracks_store ON public.delivery_tracks(store_id);
CREATE INDEX IF NOT EXISTS idx_delivery_tracks_user  ON public.delivery_tracks(user_id);

ALTER TABLE public.delivery_tracks ENABLE ROW LEVEL SECURITY;

-- القراءة: طرفا الطلب وحدهما (والأدمن). لا كتابة مباشرة إطلاقاً — كل تعديل
-- يمرّ عبر دوال SECURITY DEFINER تتحقّق من الملكية والحالة وتفرض حدّ النبض.
DROP POLICY IF EXISTS delivery_tracks_select_parties ON public.delivery_tracks;
CREATE POLICY delivery_tracks_select_parties ON public.delivery_tracks FOR SELECT
  USING (
    (SELECT auth.uid())::text = user_id
    OR (SELECT auth.uid())::text = store_id
    OR (SELECT public.is_admin())
  );

-- ⚠️ نفس درس الدوال، وهنا للجداول: إعدادات Supabase تحمل
--    `ALTER DEFAULT PRIVILEGES … ON TABLES GRANT ALL TO authenticated`
--    فكل جدول جديد يُخلق و«authenticated» يملك عليه INSERT/UPDATE/DELETE،
--    و`REVOKE ALL FROM PUBLIC` **لا يسحبها** (منحٌ باسم الدور لا لـPUBLIC).
--    RLS تمنع الكتابة فعلياً (لا سياسة كتابة أصلاً)، لكن أقلّ الامتيازات مبدأ
--    لا زينة: نسحبها صراحةً فتبقى الطبقتان محكمتين لا طبقة واحدة.
--    قِيس ٣ سبتمبر ٢٠٢٦: التقرير أسفل هذا الملف كشفها، والجرد العام أظهر
--    أن **صفر جدول** يمنح anon كتابة في المخطط كله.
REVOKE ALL ON public.delivery_tracks FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.delivery_tracks FROM anon, authenticated;
GRANT SELECT ON public.delivery_tracks TO authenticated;
GRANT SELECT ON public.delivery_tracks TO anon;   -- RLS تمنع كل شيء بلا جلسة
GRANT ALL    ON public.delivery_tracks TO service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- ٢) التاجر يبدأ/ينهي التتبّع
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.delivery_track_set_status(p_barcode text, p_status text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid text := auth.uid()::text;
  v_b   public.bookings%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('preparing','on_the_way','arrived','delivered','cancelled') THEN
    RAISE EXCEPTION 'BAD_STATUS';
  END IF;

  SELECT * INTO v_b FROM public.bookings WHERE barcode = upper(btrim(p_barcode));
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  -- التتبّع حقّ التاجر وحده: هو من يتحرّك، والمشتري يشاهد.
  IF v_b.store_id IS DISTINCT FROM v_uid THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF coalesce(v_b.fulfillment,'pickup') <> 'delivery' THEN RAISE EXCEPTION 'NOT_DELIVERY'; END IF;
  IF v_b.status IN ('cancelled') THEN RAISE EXCEPTION 'BOOKING_CLOSED'; END IF;

  INSERT INTO public.delivery_tracks (barcode, store_id, user_id, status, started_at)
  VALUES (v_b.barcode, v_b.store_id, v_b.user_id, p_status,
          CASE WHEN p_status = 'on_the_way' THEN now() ELSE NULL END)
  ON CONFLICT (barcode) DO UPDATE SET
    status     = EXCLUDED.status,
    -- أول انطلاق يثبّت وقت البدء، وإعادة الانطلاق بعد توقّف لا تمحوه.
    started_at = CASE WHEN EXCLUDED.status = 'on_the_way'
                      THEN coalesce(public.delivery_tracks.started_at, now())
                      ELSE public.delivery_tracks.started_at END,
    ended_at   = CASE WHEN EXCLUDED.status IN ('delivered','cancelled') THEN now() ELSE NULL END,
    -- 🔒 انتهى التوصيل ⇒ تُمحى الإحداثيات من الصفّ. الحالة تبقى (للسجلّ)
    --    والموقع يذهب — ما لا يُخزَّن لا يُسرَّب.
    lat        = CASE WHEN EXCLUDED.status IN ('delivered','cancelled') THEN NULL ELSE public.delivery_tracks.lat END,
    lng        = CASE WHEN EXCLUDED.status IN ('delivered','cancelled') THEN NULL ELSE public.delivery_tracks.lng END,
    accuracy_m = CASE WHEN EXCLUDED.status IN ('delivered','cancelled') THEN NULL ELSE public.delivery_tracks.accuracy_m END,
    heading    = CASE WHEN EXCLUDED.status IN ('delivered','cancelled') THEN NULL ELSE public.delivery_tracks.heading END,
    speed_kmh  = CASE WHEN EXCLUDED.status IN ('delivered','cancelled') THEN NULL ELSE public.delivery_tracks.speed_kmh END,
    remaining_km = CASE WHEN EXCLUDED.status IN ('delivered','cancelled') THEN NULL ELSE public.delivery_tracks.remaining_km END,
    eta_min    = CASE WHEN EXCLUDED.status IN ('delivered','cancelled') THEN NULL ELSE public.delivery_tracks.eta_min END,
    updated_at = now();

  RETURN jsonb_build_object('ok', true, 'status', p_status, 'barcode', v_b.barcode);
END
$fn$;
REVOKE ALL ON FUNCTION public.delivery_track_set_status(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delivery_track_set_status(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.delivery_track_set_status(text, text) TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- ٣) نبضة الموقع — يرسلها جهاز التاجر أثناء الحركة
-- ════════════════════════════════════════════════════════════════════════════
-- الخادم هو من يحسب المسافة المتبقّية والوقت المتوقّع: العميل قد يكذب أو يخطئ،
-- والمشتري يرى رقماً يثق به. وسرعة السير الافتراضية ٢٥ كم/س (مدينة، لا طريق سريع).
CREATE OR REPLACE FUNCTION public.delivery_track_ping(
  p_barcode text, p_lat double precision, p_lng double precision,
  p_accuracy double precision DEFAULT NULL, p_heading double precision DEFAULT NULL,
  p_speed_kmh double precision DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid   text := auth.uid()::text;
  v_b     public.bookings%ROWTYPE;
  v_prev  public.delivery_tracks%ROWTYPE;
  v_dlat  double precision;
  v_dlng  double precision;
  v_km    numeric;
  v_eta   integer;
  v_speed double precision;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF p_lat IS NULL OR p_lng IS NULL
     OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'BAD_POINT';
  END IF;

  SELECT * INTO v_b FROM public.bookings WHERE barcode = upper(btrim(p_barcode));
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_b.store_id IS DISTINCT FROM v_uid THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF coalesce(v_b.fulfillment,'pickup') <> 'delivery' THEN RAISE EXCEPTION 'NOT_DELIVERY'; END IF;
  IF v_b.status IN ('completed','cancelled') THEN RAISE EXCEPTION 'BOOKING_CLOSED'; END IF;

  SELECT * INTO v_prev FROM public.delivery_tracks WHERE barcode = v_b.barcode;
  -- لا بثّ قبل ضغطة «بدء التوصيل»: نبضةٌ بلا حالة سائرة تُرفض، فلا يتسرّب موقع
  -- تاجرٍ لم يبدأ توصيلاً بعد.
  IF v_prev.barcode IS NULL OR v_prev.status NOT IN ('on_the_way','arrived') THEN
    RAISE EXCEPTION 'NOT_STARTED';
  END IF;
  -- حدّ النبض: نبضة كل ٤ ثوانٍ على الأكثر (الواجهة ترسل كل ~١٠). يمنع إغراق
  -- الجدول وإرهاق الريل‑تايم من عميل معطوب أو خبيث.
  -- ⚠️ **إلا النبضة الأولى**: `delivery_track_set_status` تضع `updated_at = now()`،
  -- فكان الحدّ يبتلع أوّل موقع بعد ضغطة «بدء التوصيل» مباشرة — وهي أهمّ نبضة
  -- («خرج الآن من المتجر»)، فيبقى المشتري يرى «غير متصل» بلا سبب. الشرط الآن
  -- على وجود موقعٍ سابق فعلاً لا على وقت آخر تعديل. (كشفه اختبار T5/T6/T7.)
  IF v_prev.lat IS NOT NULL AND v_prev.updated_at > now() - interval '4 seconds' THEN
    RETURN jsonb_build_object('ok', true, 'throttled', true);
  END IF;

  v_dlat := nullif(v_b.delivery_address->>'lat','')::double precision;
  v_dlng := nullif(v_b.delivery_address->>'lng','')::double precision;
  IF v_dlat IS NOT NULL AND v_dlng IS NOT NULL THEN
    v_km := round(public._taki_km(p_lat, p_lng, v_dlat, v_dlng)::numeric, 2);
    -- السرعة الفعلية إن أرسلها الجهاز ومعقولة (١–١٢٠)، وإلا ٢٥ كم/س داخل المدينة.
    v_speed := CASE WHEN p_speed_kmh IS NOT NULL AND p_speed_kmh BETWEEN 1 AND 120
                    THEN p_speed_kmh ELSE 25 END;
    -- +١.٣ معامل التواء الطرق عن الخطّ المستقيم، ودقيقة واحدة حدّ أدنى.
    v_eta := GREATEST(1, CEIL((v_km * 1.3 / v_speed) * 60))::int;
  END IF;

  UPDATE public.delivery_tracks SET
    lat = p_lat, lng = p_lng,
    accuracy_m = p_accuracy, heading = p_heading, speed_kmh = p_speed_kmh,
    remaining_km = v_km, eta_min = v_eta,
    updated_at = now()
  WHERE barcode = v_b.barcode;

  RETURN jsonb_build_object('ok', true, 'remaining_km', v_km, 'eta_min', v_eta, 'status', v_prev.status);
END
$fn$;
REVOKE ALL ON FUNCTION public.delivery_track_ping(text, double precision, double precision, double precision, double precision, double precision) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delivery_track_ping(text, double precision, double precision, double precision, double precision, double precision) FROM anon;
GRANT EXECUTE ON FUNCTION public.delivery_track_ping(text, double precision, double precision, double precision, double precision, double precision) TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- ٤) القراءة — لطرفَي الطلب، وبنافذة زمنية للمشتري
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.delivery_track_get(p_barcode text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid  text := auth.uid()::text;
  v_b    public.bookings%ROWTYPE;
  v_t    public.delivery_tracks%ROWTYPE;
  v_is_seller boolean;
  v_is_buyer  boolean;
  v_fresh boolean;
  v_store_lat double precision;
  v_store_lng double precision;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'auth'); END IF;
  SELECT * INTO v_b FROM public.bookings WHERE barcode = upper(btrim(p_barcode));
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  v_is_seller := v_b.store_id IS NOT DISTINCT FROM v_uid;
  v_is_buyer  := v_b.user_id  IS NOT DISTINCT FROM v_uid;
  IF NOT (v_is_seller OR v_is_buyer OR public.is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF coalesce(v_b.fulfillment,'pickup') <> 'delivery' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_delivery');
  END IF;

  SELECT * INTO v_t FROM public.delivery_tracks WHERE barcode = v_b.barcode;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'status', 'preparing', 'live', false,
      'destination', jsonb_build_object('lat', nullif(v_b.delivery_address->>'lat','')::double precision,
                                        'lng', nullif(v_b.delivery_address->>'lng','')::double precision));
  END IF;

  -- «حيّ» = نبضة خلال دقيقتين. أقدم من ذلك يُعرَض كآخر موقع معروف بوقته، ولا
  -- يُقدَّم كأنه الآن — إشارة متجمّدة تُعرض كحيّة تُفقد الثقة بالميزة كلها.
  v_fresh := v_t.lat IS NOT NULL AND v_t.updated_at > now() - interval '2 minutes'
             AND v_t.status IN ('on_the_way','arrived');

  SELECT u.lat, u.lng INTO v_store_lat, v_store_lng FROM public.users u WHERE u.id = v_b.store_id;

  RETURN jsonb_build_object(
    'ok', true,
    'role', CASE WHEN v_is_seller THEN 'seller' ELSE 'buyer' END,
    'status', v_t.status,
    'live', v_fresh,
    -- الإحداثيات لا تخرج إلا وهي حيّة وأثناء التوصيل: صفٌّ منتهٍ لا موقع فيه أصلاً.
    'lat', CASE WHEN v_fresh THEN v_t.lat ELSE NULL END,
    'lng', CASE WHEN v_fresh THEN v_t.lng ELSE NULL END,
    'heading', CASE WHEN v_fresh THEN v_t.heading ELSE NULL END,
    'accuracy_m', CASE WHEN v_fresh THEN v_t.accuracy_m ELSE NULL END,
    'remaining_km', CASE WHEN v_fresh THEN v_t.remaining_km ELSE NULL END,
    'eta_min', CASE WHEN v_fresh THEN v_t.eta_min ELSE NULL END,
    'updated_at', v_t.updated_at,
    'started_at', v_t.started_at,
    'ended_at', v_t.ended_at,
    'age_sec', GREATEST(0, EXTRACT(EPOCH FROM (now() - v_t.updated_at)))::int,
    'destination', jsonb_build_object(
        'lat', nullif(v_b.delivery_address->>'lat','')::double precision,
        'lng', nullif(v_b.delivery_address->>'lng','')::double precision,
        'label', v_b.delivery_address->>'label',
        -- تفاصيل العنوان للتاجر (هو من يصل)، والمشتري يعرف عنوانه أصلاً.
        'details', CASE WHEN v_is_seller THEN v_b.delivery_address->>'details' ELSE NULL END,
        'phone',   CASE WHEN v_is_seller THEN v_b.delivery_address->>'phone'   ELSE NULL END),
    'store', jsonb_build_object('lat', v_store_lat, 'lng', v_store_lng,
                                'name', (SELECT coalesce(nullif(u.shop,''), u.name) FROM public.users u WHERE u.id = v_b.store_id)),
    'booking_status', v_b.status
  );
END
$fn$;
REVOKE ALL ON FUNCTION public.delivery_track_get(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delivery_track_get(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.delivery_track_get(text) TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- ٥) البوتان — نفس الشيء عبر هوية البوت (لا auth.uid)
-- ════════════════════════════════════════════════════════════════════════════
-- تيليجرام يدعم **مشاركة الموقع الحيّ** داخل المحادثة: يضغط التاجر «موقع حيّ»
-- فيصل البوت تحديثاً كل بضع ثوانٍ بلا أي تطبيق إضافي — وهذه الدالة تستقبله.
CREATE OR REPLACE FUNCTION public.bot_delivery_track_ping(
  p_telegram_id bigint, p_whatsapp_id text, p_barcode text,
  p_lat double precision, p_lng double precision,
  p_heading double precision DEFAULT NULL, p_speed_kmh double precision DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid text; v_b public.bookings%ROWTYPE; v_prev public.delivery_tracks%ROWTYPE;
  v_dlat double precision; v_dlng double precision; v_km numeric; v_eta integer; v_speed double precision;
BEGIN
  IF NOT public._bot_gate_ok() THEN RAISE EXCEPTION 'GATE'; END IF;
  v_uid := public._bot_uid(p_telegram_id, p_whatsapp_id);
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_linked'); END IF;
  IF p_lat IS NULL OR p_lng IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'bad_point'); END IF;

  SELECT * INTO v_b FROM public.bookings WHERE barcode = upper(btrim(p_barcode));
  IF NOT FOUND OR v_b.store_id IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;
  IF coalesce(v_b.fulfillment,'pickup') <> 'delivery' THEN RETURN jsonb_build_object('ok', false, 'error', 'not_delivery'); END IF;
  IF v_b.status IN ('completed','cancelled') THEN RETURN jsonb_build_object('ok', false, 'error', 'closed'); END IF;

  SELECT * INTO v_prev FROM public.delivery_tracks WHERE barcode = v_b.barcode;
  -- من البوت: أول نبضة تبدأ التوصيل ضمناً — مشاركة الموقع الحيّ **هي** ضغطة البدء
  -- (فعلٌ صريح من التاجر داخل تيليجرام، لا تتبّع صامت).
  IF v_prev.barcode IS NULL THEN
    INSERT INTO public.delivery_tracks (barcode, store_id, user_id, status, started_at)
    VALUES (v_b.barcode, v_b.store_id, v_b.user_id, 'on_the_way', now());
    SELECT * INTO v_prev FROM public.delivery_tracks WHERE barcode = v_b.barcode;
  ELSIF v_prev.status NOT IN ('on_the_way','arrived') THEN
    UPDATE public.delivery_tracks
       SET status = 'on_the_way', started_at = coalesce(started_at, now()), ended_at = NULL, updated_at = now()
     WHERE barcode = v_b.barcode;
    SELECT * INTO v_prev FROM public.delivery_tracks WHERE barcode = v_b.barcode;
  ELSIF v_prev.lat IS NOT NULL AND v_prev.updated_at > now() - interval '4 seconds' THEN
    -- نفس استثناء النبضة الأولى في مسار الجلسة (البوتان توأمان في السلوك أيضاً)
    RETURN jsonb_build_object('ok', true, 'throttled', true);
  END IF;

  v_dlat := nullif(v_b.delivery_address->>'lat','')::double precision;
  v_dlng := nullif(v_b.delivery_address->>'lng','')::double precision;
  IF v_dlat IS NOT NULL AND v_dlng IS NOT NULL THEN
    v_km := round(public._taki_km(p_lat, p_lng, v_dlat, v_dlng)::numeric, 2);
    v_speed := CASE WHEN p_speed_kmh IS NOT NULL AND p_speed_kmh BETWEEN 1 AND 120 THEN p_speed_kmh ELSE 25 END;
    v_eta := GREATEST(1, CEIL((v_km * 1.3 / v_speed) * 60))::int;
  END IF;

  UPDATE public.delivery_tracks SET
    lat = p_lat, lng = p_lng, heading = p_heading, speed_kmh = p_speed_kmh,
    remaining_km = v_km, eta_min = v_eta, updated_at = now()
  WHERE barcode = v_b.barcode;

  RETURN jsonb_build_object('ok', true, 'remaining_km', v_km, 'eta_min', v_eta, 'status', v_prev.status);
END
$fn$;
REVOKE ALL ON FUNCTION public.bot_delivery_track_ping(bigint, text, text, double precision, double precision, double precision, double precision) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bot_delivery_track_ping(bigint, text, text, double precision, double precision, double precision, double precision) TO anon, authenticated, service_role;

-- قراءة الحالة من البوت (للمشتري: أين طلبي؟ · وللتاجر: حالة التتبّع)
CREATE OR REPLACE FUNCTION public.bot_delivery_track_get(p_telegram_id bigint, p_whatsapp_id text, p_barcode text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid text; v_b public.bookings%ROWTYPE; v_t public.delivery_tracks%ROWTYPE; v_fresh boolean; v_seller boolean;
BEGIN
  IF NOT public._bot_gate_ok() THEN RAISE EXCEPTION 'GATE'; END IF;
  v_uid := public._bot_uid(p_telegram_id, p_whatsapp_id);
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_linked'); END IF;

  SELECT * INTO v_b FROM public.bookings WHERE barcode = upper(btrim(p_barcode));
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  v_seller := v_b.store_id IS NOT DISTINCT FROM v_uid;
  IF NOT (v_seller OR v_b.user_id IS NOT DISTINCT FROM v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;
  IF coalesce(v_b.fulfillment,'pickup') <> 'delivery' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_delivery');
  END IF;

  SELECT * INTO v_t FROM public.delivery_tracks WHERE barcode = v_b.barcode;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', true, 'status', 'preparing', 'live', false, 'role', CASE WHEN v_seller THEN 'seller' ELSE 'buyer' END); END IF;

  v_fresh := v_t.lat IS NOT NULL AND v_t.updated_at > now() - interval '2 minutes'
             AND v_t.status IN ('on_the_way','arrived');
  RETURN jsonb_build_object(
    'ok', true,
    'role', CASE WHEN v_seller THEN 'seller' ELSE 'buyer' END,
    'status', v_t.status,
    'live', v_fresh,
    'remaining_km', CASE WHEN v_fresh THEN v_t.remaining_km ELSE NULL END,
    'eta_min', CASE WHEN v_fresh THEN v_t.eta_min ELSE NULL END,
    'age_sec', GREATEST(0, EXTRACT(EPOCH FROM (now() - v_t.updated_at)))::int,
    'lat', CASE WHEN v_fresh THEN v_t.lat ELSE NULL END,
    'lng', CASE WHEN v_fresh THEN v_t.lng ELSE NULL END,
    'label', v_b.delivery_address->>'label');
END
$fn$;
REVOKE ALL ON FUNCTION public.bot_delivery_track_get(bigint, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bot_delivery_track_get(bigint, text, text) TO anon, authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- ٦) نظافة تلقائية: إغلاق الحجز يُنهي التتبّع ويمحو الموقع فوراً
-- ════════════════════════════════════════════════════════════════════════════
-- بلا هذا يبقى آخر موقع للمندوب مقروءاً للمشتري بعد التسليم (ولو «غير حيّ»).
-- إغلاق الحجز من أي مسار — التاجر، المشتري، أو انتهاء المهلة بـpg_cron — يمحوه.
CREATE OR REPLACE FUNCTION public.tr_close_delivery_track()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NEW.status IN ('completed','cancelled') AND coalesce(OLD.status,'') <> NEW.status THEN
    UPDATE public.delivery_tracks
       SET status = CASE WHEN NEW.status = 'completed' THEN 'delivered' ELSE 'cancelled' END,
           lat = NULL, lng = NULL, accuracy_m = NULL, heading = NULL, speed_kmh = NULL,
           remaining_km = NULL, eta_min = NULL,
           ended_at = now(), updated_at = now()
     WHERE barcode = NEW.barcode;
  END IF;
  RETURN NEW;
END
$fn$;
DROP TRIGGER IF EXISTS tr_zz_close_delivery_track ON public.bookings;
CREATE TRIGGER tr_zz_close_delivery_track AFTER UPDATE OF status ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.tr_close_delivery_track();

-- كنس دوري: أي مسار سائر لم تصله نبضة منذ ٦ ساعات يُغلق وتُمحى إحداثياته.
-- (المندوب أغلق التطبيق ونسي «تم التسليم» — لا يبقى موقعه في الجدول للأبد.)
CREATE OR REPLACE FUNCTION public.taki_expire_delivery_tracks()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE v_n integer;
BEGIN
  WITH x AS (
    UPDATE public.delivery_tracks
       SET status = 'cancelled', lat = NULL, lng = NULL, accuracy_m = NULL,
           heading = NULL, speed_kmh = NULL, remaining_km = NULL, eta_min = NULL,
           ended_at = now(), updated_at = now()
     WHERE status IN ('on_the_way','arrived')
       AND updated_at < now() - interval '6 hours'
    RETURNING 1)
  SELECT count(*) INTO v_n FROM x;
  RETURN coalesce(v_n, 0);
END
$fn$;
REVOKE ALL ON FUNCTION public.taki_expire_delivery_tracks() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.taki_expire_delivery_tracks() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.taki_expire_delivery_tracks() TO service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- ٧) إشعار المشتري لحظة انطلاق المندوب
-- ════════════════════════════════════════════════════════════════════════════
-- بلا هذا لا يعرف المشتري متى ينزل إلى الباب إلا إن فتح التطبيق صدفةً. الإشعار
-- يُكتب من القاعدة (كبقية إشعارات الحجز) لأن سياسة `notifications` تمنع أي
-- عميل من الكتابة لغيره — والتاجر لا يستطيع إشعار مشتريه من متصفّحه أصلاً.
-- ⚠️ مرّة واحدة فقط لكل طلب: `started_at` القديم فارغ = أول انطلاق فعلاً،
--    فإعادة تشغيل البثّ بعد انقطاع لا تُعيد إزعاج المشتري.
CREATE OR REPLACE FUNCTION public.tr_notify_delivery_started()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v_shop text; v_item text;
BEGIN
  IF NEW.status = 'on_the_way'
     AND coalesce(OLD.status, '') <> 'on_the_way'
     AND OLD.started_at IS NULL THEN
    SELECT coalesce(nullif(u.shop,''), u.name, 'المتجر') INTO v_shop FROM public.users u WHERE u.id = NEW.store_id;
    SELECT coalesce(d.item_name, 'طلبك') INTO v_item
      FROM public.bookings b LEFT JOIN public.deals d ON d.id = b.deal_id WHERE b.barcode = NEW.barcode;
    INSERT INTO public.notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data, created_at)
    VALUES (NEW.user_id,
      '🚚 طلبك في الطريق إليك!', '🚚 Your order is on the way!',
      'انطلق ' || v_shop || ' بطلبك (' || v_item || '). تابع موقعه على الخريطة من «حجوزاتي».',
      v_shop || ' set off with your order (' || v_item || '). Track it on the map in “My bookings”.',
      'booking',
      jsonb_build_object('audience','buyer','event','delivery_started','barcode',NEW.barcode,'track',true),
      NOW());
  END IF;
  RETURN NEW;
END
$fn$;
DROP TRIGGER IF EXISTS tr_delivery_started_notify ON public.delivery_tracks;
CREATE TRIGGER tr_delivery_started_notify AFTER INSERT OR UPDATE OF status ON public.delivery_tracks
  FOR EACH ROW EXECUTE FUNCTION public.tr_notify_delivery_started();

COMMIT;

-- جدولة الكنس كل ساعة (خارج المعاملة — pg_cron لا يُجدول داخلها بأمان)
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(j.jobname) FROM cron.job j
     WHERE j.jobname IN ('taki_expire_delivery_tracks', 'taki-delivery-track-expiry');
    PERFORM cron.schedule('taki-delivery-track-expiry', '7 * * * *',
                          'SELECT public.taki_expire_delivery_tracks();');
  END IF;
END
$cron$;

-- ── تقرير التحقّق (أول سطر = اسم الخادم) ────────────────────────────────────
SELECT 'الخادم' AS "الفحص",
       coalesce(obj_description('public'::regnamespace, 'pg_namespace'), 'جدة (بلا وسم مختبر)')
         || ' · db=' || current_database() AS "النتيجة",
       'ℹ️' AS "الحالة"
UNION ALL
SELECT 'جدول delivery_tracks + RLS',
       CASE WHEN c.relrowsecurity THEN 'موجود · RLS مفعّل' ELSE 'RLS معطّل!' END,
       CASE WHEN c.relrowsecurity THEN '✅' ELSE '❌' END
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname='delivery_tracks'
UNION ALL
SELECT 'سياسة القراءة لطرفَي الطلب وحدهما',
       count(*)::text || ' سياسة (قراءة فقط)', CASE WHEN count(*)=1 THEN '✅' ELSE '❌' END
  FROM pg_policies WHERE tablename='delivery_tracks'
UNION ALL
SELECT 'لا كتابة مباشرة لأحد (الدوال فقط)',
       CASE WHEN has_table_privilege('authenticated','public.delivery_tracks','INSERT')
              OR has_table_privilege('authenticated','public.delivery_tracks','UPDATE')
              OR has_table_privilege('anon','public.delivery_tracks','INSERT')
            THEN 'توجد صلاحية كتابة!' ELSE 'قراءة فقط' END,
       CASE WHEN has_table_privilege('authenticated','public.delivery_tracks','INSERT')
              OR has_table_privilege('authenticated','public.delivery_tracks','UPDATE')
              OR has_table_privilege('anon','public.delivery_tracks','INSERT')
            THEN '❌' ELSE '✅' END
UNION ALL
SELECT 'الدوال الخمس', count(*)::text || '/5', CASE WHEN count(*)=5 THEN '✅' ELSE '❌' END
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN
   ('delivery_track_set_status','delivery_track_ping','delivery_track_get','bot_delivery_track_ping','bot_delivery_track_get')
UNION ALL
SELECT 'مشغّل إغلاق المسار مع الحجز',
       CASE WHEN count(*)=1 THEN 'مركَّب' ELSE 'مفقود' END, CASE WHEN count(*)=1 THEN '✅' ELSE '❌' END
  FROM pg_trigger WHERE tgname='tr_zz_close_delivery_track' AND tgrelid='public.bookings'::regclass
UNION ALL
SELECT 'anon محروم من دوال الجلسة',
       CASE WHEN bool_or(has_function_privilege('anon', p.oid, 'EXECUTE')) THEN 'ما زال يملك!' ELSE 'محروم' END,
       CASE WHEN bool_or(has_function_privilege('anon', p.oid, 'EXECUTE')) THEN '❌' ELSE '✅' END
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN ('delivery_track_set_status','delivery_track_ping','delivery_track_get')
UNION ALL
SELECT 'إشعار «طلبك في الطريق»',
       CASE WHEN count(*)=1 THEN 'مركَّب' ELSE 'مفقود' END, CASE WHEN count(*)=1 THEN '✅' ELSE '❌' END
  FROM pg_trigger WHERE tgname='tr_delivery_started_notify' AND tgrelid='public.delivery_tracks'::regclass
UNION ALL
SELECT 'كنس المسارات المهجورة مجدول',
       CASE WHEN EXISTS (SELECT 1 FROM cron.job WHERE jobname='taki-delivery-track-expiry')
            THEN 'كل ساعة (الدقيقة ٧)' ELSE 'غير مجدول' END,
       CASE WHEN EXISTS (SELECT 1 FROM cron.job WHERE jobname='taki-delivery-track-expiry') THEN '✅' ELSE '⚠️' END;
