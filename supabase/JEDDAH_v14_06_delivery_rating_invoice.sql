-- ============================================================================
-- TAKI · v14.06 — خدمة التوصيل + فاتورة PDF للبوت + تنبيهات التقييم المؤجَّلة
-- ============================================================================
-- طلب ناصر (٣ سبتمبر ٢٠٢٦):
--  ١) فاتورة البوت PDF مطابقة للموقع (بباركود الطلب ورموز الكاشير SKU) —
--     الدالة bot_get_booking_invoice تُرجع الآن الرموز والتوصيل والكود الاحتياطي.
--  ٢) التقييم لم يظهر بعد اكتمال الشراء — pending_rating_prompts() تُرجع كل
--     حجز مكتمل حديثاً لم يُقيَّم/يُصوَّت عليه، فلا يعتمد الظهور على حدث لحظي فات.
--  ٣) خدمة التوصيل: إعدادات المتجر + نطاقات (دائرة/مستطيل/مضلّع) + عنوان دائم
--     للمشتري + لقطة العنوان على الحجز + حارس على القاعدة يرفض التوصيل خارج
--     النطاق أو بطريقة دفع لا يقبلها التاجر، ويثبّت الرسوم من جهة الخادم.
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
-- ١) إعدادات التوصيل على ملف المتجر
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.store_profiles
  ADD COLUMN IF NOT EXISTS delivery_enabled   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS delivery_payment   text    NOT NULL DEFAULT 'cod',
  ADD COLUMN IF NOT EXISTS delivery_fee       numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_min_order numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_eta_min   integer,
  ADD COLUMN IF NOT EXISTS delivery_note      text;

ALTER TABLE public.store_profiles DROP CONSTRAINT IF EXISTS store_profiles_delivery_chk;
ALTER TABLE public.store_profiles ADD CONSTRAINT store_profiles_delivery_chk CHECK (
      delivery_payment IN ('cod','card','both')
  AND delivery_fee       >= 0 AND delivery_fee       <= 1000
  AND delivery_min_order >= 0 AND delivery_min_order <= 100000
  AND (delivery_eta_min IS NULL OR delivery_eta_min BETWEEN 0 AND 1440)
  AND (delivery_note IS NULL OR length(delivery_note) <= 300)
);

-- ════════════════════════════════════════════════════════════════════════════
-- ٢) عنوان التوصيل الدائم للمشتري (صفّه وحده يقرؤه — RLS على users)
--    الشكل: {label, lat, lng, details, city, phone, updated_at}
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS delivery_address jsonb;
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_delivery_address_chk;
ALTER TABLE public.users ADD CONSTRAINT users_delivery_address_chk CHECK (
  delivery_address IS NULL OR (
        jsonb_typeof(delivery_address) = 'object'
    AND length(delivery_address::text) <= 2000
    AND (delivery_address->>'lat') ~ '^-?[0-9]+(\.[0-9]+)?$'
    AND (delivery_address->>'lng') ~ '^-?[0-9]+(\.[0-9]+)?$'
  )
);

-- ════════════════════════════════════════════════════════════════════════════
-- ٣) نطاقات التوصيل — دائرة (مركز + نصف قطر كم) · مستطيل (ركنان) · مضلّع (نقاط)
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.store_delivery_zones (
  id          text PRIMARY KEY DEFAULT 'dz_' || replace(gen_random_uuid()::text, '-', ''),
  store_id    text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name        text,
  kind        text NOT NULL CHECK (kind IN ('circle','rect','polygon')),
  center_lat  double precision,
  center_lng  double precision,
  radius_km   numeric,
  -- [[lat,lng], ...] — ركنان للمستطيل، ٣ نقاط فأكثر للمضلّع
  points      jsonb,
  -- رسوم خاصة بهذا النطاق (فارغ = رسوم المتجر الافتراضية)
  fee         numeric,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_delivery_zones_store ON public.store_delivery_zones(store_id) WHERE is_active;

ALTER TABLE public.store_delivery_zones ENABLE ROW LEVEL SECURITY;
-- النطاقات معلومة عامة (كأماكن الفروع): يقرؤها المشتري ليعرف هل يصله التوصيل.
DROP POLICY IF EXISTS delivery_zones_select_all ON public.store_delivery_zones;
CREATE POLICY delivery_zones_select_all ON public.store_delivery_zones FOR SELECT USING (true);
DROP POLICY IF EXISTS delivery_zones_insert_own ON public.store_delivery_zones;
CREATE POLICY delivery_zones_insert_own ON public.store_delivery_zones FOR INSERT
  WITH CHECK ((SELECT auth.uid())::text = store_id OR (SELECT public.is_admin()));
DROP POLICY IF EXISTS delivery_zones_update_own ON public.store_delivery_zones;
CREATE POLICY delivery_zones_update_own ON public.store_delivery_zones FOR UPDATE
  USING ((SELECT auth.uid())::text = store_id OR (SELECT public.is_admin()))
  WITH CHECK ((SELECT auth.uid())::text = store_id OR (SELECT public.is_admin()));
DROP POLICY IF EXISTS delivery_zones_delete_own ON public.store_delivery_zones;
CREATE POLICY delivery_zones_delete_own ON public.store_delivery_zones FOR DELETE
  USING ((SELECT auth.uid())::text = store_id OR (SELECT public.is_admin()));

GRANT SELECT ON public.store_delivery_zones TO anon, authenticated, service_role;
GRANT INSERT, UPDATE, DELETE ON public.store_delivery_zones TO authenticated, service_role;

-- حارس الهندسة + السقف: ١٠ نطاقات فعّالة للمتجر — يكفي كل الحالات ويمنع التخمة.
CREATE OR REPLACE FUNCTION public.tr_guard_delivery_zone()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  v_n int;
  v_pt jsonb;
  v_cnt int;
BEGIN
  IF NEW.store_id IS NULL THEN
    RAISE EXCEPTION 'TAKI_ZONE_BAD:store' USING ERRCODE = '23514';
  END IF;
  -- المالك يجب أن يكون صاحب متجر (لا مشترياً) — السياسة تضمن أنه هو نفسه.
  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = NEW.store_id AND u.user_type IN ('seller','admin')) THEN
    RAISE EXCEPTION 'TAKI_ZONE_BAD:not_store' USING ERRCODE = '42501';
  END IF;

  NEW.name := nullif(left(btrim(coalesce(NEW.name, '')), 60), '');
  IF NEW.fee IS NOT NULL AND (NEW.fee < 0 OR NEW.fee > 1000) THEN
    RAISE EXCEPTION 'TAKI_ZONE_BAD:fee' USING ERRCODE = '23514';
  END IF;

  IF NEW.kind = 'circle' THEN
    IF NEW.center_lat IS NULL OR NEW.center_lng IS NULL OR NEW.radius_km IS NULL
       OR NEW.center_lat NOT BETWEEN -90 AND 90 OR NEW.center_lng NOT BETWEEN -180 AND 180
       OR NEW.radius_km < 0.2 OR NEW.radius_km > 200 THEN
      RAISE EXCEPTION 'TAKI_ZONE_BAD:circle' USING ERRCODE = '23514';
    END IF;
    NEW.points := NULL;
  ELSE
    IF NEW.points IS NULL OR jsonb_typeof(NEW.points) <> 'array' THEN
      RAISE EXCEPTION 'TAKI_ZONE_BAD:points' USING ERRCODE = '23514';
    END IF;
    v_n := jsonb_array_length(NEW.points);
    IF (NEW.kind = 'rect' AND v_n <> 2) OR (NEW.kind = 'polygon' AND (v_n < 3 OR v_n > 80)) THEN
      RAISE EXCEPTION 'TAKI_ZONE_BAD:points_count' USING ERRCODE = '23514';
    END IF;
    FOR v_pt IN SELECT * FROM jsonb_array_elements(NEW.points) LOOP
      IF jsonb_typeof(v_pt) <> 'array' OR jsonb_array_length(v_pt) <> 2
         OR jsonb_typeof(v_pt->0) <> 'number' OR jsonb_typeof(v_pt->1) <> 'number'
         OR (v_pt->>0)::float8 NOT BETWEEN -90 AND 90 OR (v_pt->>1)::float8 NOT BETWEEN -180 AND 180 THEN
        RAISE EXCEPTION 'TAKI_ZONE_BAD:point' USING ERRCODE = '23514';
      END IF;
    END LOOP;
    NEW.center_lat := NULL; NEW.center_lng := NULL; NEW.radius_km := NULL;
  END IF;

  IF TG_OP = 'INSERT' OR (NEW.is_active AND NOT OLD.is_active) THEN
    SELECT count(*) INTO v_cnt FROM public.store_delivery_zones z
     WHERE z.store_id = NEW.store_id AND z.is_active AND z.id <> NEW.id;
    IF v_cnt >= 10 THEN
      RAISE EXCEPTION 'TAKI_ZONE_CAP:10' USING ERRCODE = '23514';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$fn$;
DROP TRIGGER IF EXISTS tr_guard_delivery_zone ON public.store_delivery_zones;
CREATE TRIGGER tr_guard_delivery_zone BEFORE INSERT OR UPDATE ON public.store_delivery_zones
  FOR EACH ROW EXECUTE FUNCTION public.tr_guard_delivery_zone();

-- ════════════════════════════════════════════════════════════════════════════
-- ٤) الهندسة: مسافة كروية · نقطة داخل مضلّع (ray casting) · نقطة داخل نطاق
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._taki_km(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
RETURNS double precision LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
  SELECT 2 * 6371 * asin(least(1.0, sqrt(
      power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2))));
$fn$;

CREATE OR REPLACE FUNCTION public._taki_point_in_polygon(p_pts jsonb, p_lat double precision, p_lng double precision)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $fn$
DECLARE n int; i int; j int; xi float8; yi float8; xj float8; yj float8; inside boolean := false;
BEGIN
  IF p_pts IS NULL OR jsonb_typeof(p_pts) <> 'array' THEN RETURN false; END IF;
  n := jsonb_array_length(p_pts);
  IF n < 3 THEN RETURN false; END IF;
  j := n - 1;
  FOR i IN 0 .. n - 1 LOOP
    yi := (p_pts->i->>0)::float8; xi := (p_pts->i->>1)::float8;
    yj := (p_pts->j->>0)::float8; xj := (p_pts->j->>1)::float8;
    IF ((yi > p_lat) <> (yj > p_lat))
       AND (p_lng < (xj - xi) * (p_lat - yi) / (yj - yi) + xi) THEN
      inside := NOT inside;
    END IF;
    j := i;
  END LOOP;
  RETURN inside;
END
$fn$;

CREATE OR REPLACE FUNCTION public._taki_zone_contains(z public.store_delivery_zones, p_lat double precision, p_lng double precision)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $fn$
DECLARE a_lat float8; a_lng float8; b_lat float8; b_lng float8;
BEGIN
  IF p_lat IS NULL OR p_lng IS NULL THEN RETURN false; END IF;
  IF z.kind = 'circle' THEN
    RETURN public._taki_km(z.center_lat, z.center_lng, p_lat, p_lng) <= z.radius_km;
  ELSIF z.kind = 'rect' THEN
    a_lat := (z.points->0->>0)::float8; a_lng := (z.points->0->>1)::float8;
    b_lat := (z.points->1->>0)::float8; b_lng := (z.points->1->>1)::float8;
    RETURN p_lat BETWEEN least(a_lat, b_lat) AND greatest(a_lat, b_lat)
       AND p_lng BETWEEN least(a_lng, b_lng) AND greatest(a_lng, b_lng);
  ELSE
    RETURN public._taki_point_in_polygon(z.points, p_lat, p_lng);
  END IF;
END
$fn$;

-- ════════════════════════════════════════════════════════════════════════════
-- ٥) عرض التوصيل لنقطة: هل يصل هذا المتجر إلى هنا، وبأي رسوم وطريقة دفع؟
--    لا بيانات شخصية فيه — الإحداثيات يمرّرها المستدعي. مصدر الحقيقة الوحيد
--    للواجهة والبوتات وحارس الحجز.
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.delivery_quote(p_store_id text, p_lat double precision, p_lng double precision)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  sp   public.store_profiles%ROWTYPE;
  z    public.store_delivery_zones%ROWTYPE;
  v_zone_count int;
BEGIN
  SELECT * INTO sp FROM public.store_profiles WHERE store_id = p_store_id;
  IF NOT FOUND OR NOT coalesce(sp.delivery_enabled, false) THEN
    RETURN jsonb_build_object('enabled', false, 'available', false, 'reason', 'disabled');
  END IF;
  SELECT count(*) INTO v_zone_count FROM public.store_delivery_zones WHERE store_id = p_store_id AND is_active;
  IF v_zone_count = 0 THEN
    RETURN jsonb_build_object('enabled', true, 'available', false, 'reason', 'no_zones',
      'payment', sp.delivery_payment, 'min_order', sp.delivery_min_order, 'eta_min', sp.delivery_eta_min, 'note', sp.delivery_note);
  END IF;
  IF p_lat IS NULL OR p_lng IS NULL THEN
    RETURN jsonb_build_object('enabled', true, 'available', false, 'reason', 'no_location',
      'payment', sp.delivery_payment, 'min_order', sp.delivery_min_order, 'eta_min', sp.delivery_eta_min, 'note', sp.delivery_note);
  END IF;
  -- أول نطاق يحوي النقطة — الأقل رسوماً أولاً إن تداخلت النطاقات (لصالح المشتري).
  SELECT * INTO z FROM public.store_delivery_zones dz
   WHERE dz.store_id = p_store_id AND dz.is_active
     AND public._taki_zone_contains(dz, p_lat, p_lng)
   ORDER BY coalesce(dz.fee, sp.delivery_fee) ASC, dz.created_at ASC
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('enabled', true, 'available', false, 'reason', 'out_of_zone',
      'payment', sp.delivery_payment, 'min_order', sp.delivery_min_order, 'eta_min', sp.delivery_eta_min, 'note', sp.delivery_note);
  END IF;
  RETURN jsonb_build_object(
    'enabled',   true,
    'available', true,
    'zone_id',   z.id,
    'zone_name', z.name,
    'fee',       round(coalesce(z.fee, sp.delivery_fee), 2),
    'min_order', sp.delivery_min_order,
    'payment',   sp.delivery_payment,
    'eta_min',   sp.delivery_eta_min,
    'note',      sp.delivery_note);
END
$fn$;
REVOKE ALL ON FUNCTION public.delivery_quote(text, double precision, double precision) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delivery_quote(text, double precision, double precision) TO anon, authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- ٦) التاجر يضبط إعدادات التوصيل — RPC واحد يتحقّق ويُنشئ صفّ الملف إن غاب.
--    «بطاقة فقط/الاثنان» يستلزم بوابة دفع فعّالة، وإلا لا يمكن للمشتري الدفع.
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.merchant_set_delivery(
  p_enabled boolean, p_payment text, p_fee numeric, p_min_order numeric, p_eta_min integer, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE v_uid text := auth.uid()::text; v_type text; v_shop text; v_mode text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT user_type, shop INTO v_type, v_shop FROM public.users WHERE id = v_uid AND deleted_at IS NULL;
  IF v_type IS NULL OR (v_type NOT IN ('seller','admin') AND nullif(btrim(coalesce(v_shop,'')),'') IS NULL) THEN
    RAISE EXCEPTION 'SELLER_ONLY';
  END IF;
  IF p_payment IS NULL OR p_payment NOT IN ('cod','card','both') THEN RAISE EXCEPTION 'BAD_MODE'; END IF;
  IF coalesce(p_fee, 0) < 0 OR coalesce(p_fee, 0) > 1000 THEN RAISE EXCEPTION 'BAD_FEE'; END IF;
  IF coalesce(p_min_order, 0) < 0 OR coalesce(p_min_order, 0) > 100000 THEN RAISE EXCEPTION 'BAD_MIN'; END IF;
  IF p_eta_min IS NOT NULL AND p_eta_min NOT BETWEEN 0 AND 1440 THEN RAISE EXCEPTION 'BAD_ETA'; END IF;
  IF coalesce(p_enabled, false) AND p_payment IN ('card','both') THEN
    v_mode := public.deal_payment_mode(v_uid);
    IF v_mode NOT IN ('online','both') THEN RAISE EXCEPTION 'GATEWAY_REQUIRED'; END IF;
  END IF;

  INSERT INTO public.store_profiles (store_id, delivery_enabled, delivery_payment, delivery_fee, delivery_min_order, delivery_eta_min, delivery_note)
  VALUES (v_uid, coalesce(p_enabled,false), p_payment, round(coalesce(p_fee,0),2), round(coalesce(p_min_order,0),2), p_eta_min, nullif(left(btrim(coalesce(p_note,'')),300),''))
  ON CONFLICT (store_id) DO UPDATE SET
    delivery_enabled   = EXCLUDED.delivery_enabled,
    delivery_payment   = EXCLUDED.delivery_payment,
    delivery_fee       = EXCLUDED.delivery_fee,
    delivery_min_order = EXCLUDED.delivery_min_order,
    delivery_eta_min   = EXCLUDED.delivery_eta_min,
    delivery_note      = EXCLUDED.delivery_note,
    updated_at         = now();

  RETURN (SELECT jsonb_build_object(
    'delivery_enabled', sp.delivery_enabled, 'delivery_payment', sp.delivery_payment,
    'delivery_fee', sp.delivery_fee, 'delivery_min_order', sp.delivery_min_order,
    'delivery_eta_min', sp.delivery_eta_min, 'delivery_note', sp.delivery_note,
    'zones', (SELECT count(*) FROM public.store_delivery_zones z WHERE z.store_id = v_uid AND z.is_active))
    FROM public.store_profiles sp WHERE sp.store_id = v_uid);
END
$fn$;
-- ⚠️ درس مقيس (٣ سبتمبر ٢٠٢٦): إعدادات Supabase تحمل
--    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon…`
--    فكل دالة جديدة تُخلَق ومعها إذن تنفيذ لـ**anon** تلقائياً،
--    و`REVOKE ALL FROM PUBLIC` **لا يسحبه** لأنه منحٌ باسم الدور لا لـPUBLIC.
--    لذلك كل دالة مقصورة على المسجّلين تحتاج `REVOKE … FROM anon` صريحاً.
--    (فُحص: ٨٦ دالة admin_* كلها بلا إذن anon — الحارس قائم، وهذه استثناءات جديدة.)
REVOKE ALL ON FUNCTION public.merchant_set_delivery(boolean, text, numeric, numeric, integer, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.merchant_set_delivery(boolean, text, numeric, numeric, integer, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.merchant_set_delivery(boolean, text, numeric, numeric, integer, text) TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- ٧) الحجز: طريقة الاستلام + لقطة العنوان + الرسوم (يثبّتها الخادم)
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS fulfillment      text NOT NULL DEFAULT 'pickup',
  ADD COLUMN IF NOT EXISTS delivery_address jsonb,
  ADD COLUMN IF NOT EXISTS delivery_fee     numeric;
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_fulfillment_chk;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_fulfillment_chk CHECK (fulfillment IN ('pickup','delivery'));

-- حارس التوصيل عند الإنشاء — يعمل لكل الأدوار (الموقع، البوتان، الأدمن):
--   • المتجر يوصّل فعلاً · العنوان فيه إحداثيات · النقطة داخل نطاق فعّال
--   • طريقة الدفع تطابق ما يقبله التاجر للتوصيل (بطاقة فقط ⇒ إلكتروني إلزامياً)
--   • الحد الأدنى للطلب · الرسوم تُكتب من الخادم لا من العميل
CREATE OR REPLACE FUNCTION public.tr_guard_booking_delivery()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  v_q     jsonb;
  v_lat   float8;
  v_lng   float8;
  v_min   numeric;
  v_est   numeric;
  v_price numeric;
BEGIN
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

  v_q := public.delivery_quote(NEW.store_id, v_lat, v_lng);
  IF NOT coalesce((v_q->>'enabled')::boolean, false) THEN
    RAISE EXCEPTION 'TAKI_DELIVERY_OFF' USING ERRCODE = 'P0013';
  END IF;
  IF NOT coalesce((v_q->>'available')::boolean, false) THEN
    RAISE EXCEPTION 'TAKI_DELIVERY_OUT_OF_ZONE' USING ERRCODE = 'P0013';
  END IF;

  -- طريقة الدفع التي يقبلها التاجر للتوصيل
  IF v_q->>'payment' = 'card' THEN
    IF coalesce(NEW.payment_method, 'cod') <> 'online' THEN
      RAISE EXCEPTION 'TAKI_DELIVERY_CARD_ONLY' USING ERRCODE = 'P0013';
    END IF;
  ELSIF v_q->>'payment' = 'cod' THEN
    NEW.payment_method := 'cod';
  END IF;

  -- الحد الأدنى للطلب: من سطر «الإجمالي» إن كتبته الواجهة، وإلا سعر العرض × الكمية
  v_min := coalesce((v_q->>'min_order')::numeric, 0);
  IF v_min > 0 THEN
    v_est := nullif(substring(coalesce(NEW.notes, '') FROM 'الإجمالي:\s*([0-9]+(?:\.[0-9]+)?)'), '')::numeric;
    IF v_est IS NULL THEN
      SELECT d.discounted_price INTO v_price FROM public.deals d WHERE d.id = NEW.deal_id;
      v_est := coalesce(v_price, 0) * coalesce(NEW.booked_quantity, 1);
    ELSE
      -- سطر الواجهة يشمل رسوم التوصيل — الحد الأدنى يُقاس على البضاعة وحدها
      v_est := v_est - coalesce((v_q->>'fee')::numeric, 0);
    END IF;
    IF v_est < v_min THEN
      RAISE EXCEPTION 'TAKI_DELIVERY_MIN_ORDER:%', v_min USING ERRCODE = 'P0013';
    END IF;
  END IF;

  NEW.delivery_fee := coalesce((v_q->>'fee')::numeric, 0);
  -- لقطة نظيفة للعنوان: الحقول المعروفة فقط + معرّف النطاق
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
DROP TRIGGER IF EXISTS tr_ac_booking_delivery ON public.bookings;
CREATE TRIGGER tr_ac_booking_delivery BEFORE INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.tr_guard_booking_delivery();

-- حارس السلامة (v13.4x) — تجميد حقول التوصيل بعد الإنشاء كبقية حقول الهوية والمال
CREATE OR REPLACE FUNCTION public.tr_guard_booking_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
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
    OR NEW.completed_at     IS NOT NULL
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
  OR NEW.paid_at          IS DISTINCT FROM OLD.paid_at
  OR NEW.paid_amount      IS DISTINCT FROM OLD.paid_amount
  OR NEW.payment_provider IS DISTINCT FROM OLD.payment_provider
  OR NEW.payment_ref      IS DISTINCT FROM OLD.payment_ref
  OR NEW.payment_expected IS DISTINCT FROM OLD.payment_expected
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
$fn$;

-- ════════════════════════════════════════════════════════════════════════════
-- ٨) بطاقة الحجز (صفحة /booking/:barcode) — حقول التوصيل
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_booking_card(p_barcode text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_b          bookings%ROWTYPE;
  v_d          deals%ROWTYPE;
  v_uid        text := auth.uid()::text;
  v_is_admin   boolean := false;
  v_seller     text;
  v_buyer      text;
  v_deal_found boolean := false;
BEGIN
  IF p_barcode IS NULL OR length(btrim(p_barcode)) = 0 THEN
    RETURN jsonb_build_object('error','bad_request');
  END IF;

  SELECT * INTO v_b FROM bookings WHERE barcode = upper(btrim(p_barcode)) LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error','not_found');
  END IF;

  IF v_uid IS NOT NULL THEN
    SELECT (user_type = 'admin')
      INTO v_is_admin FROM users WHERE id = v_uid;
  END IF;
  v_is_admin := coalesce(v_is_admin,false);

  IF v_uid IS NULL
     OR (v_uid <> coalesce(v_b.user_id,'~') AND v_uid <> coalesce(v_b.store_id,'~') AND NOT v_is_admin) THEN
    RETURN jsonb_build_object('error','forbidden');
  END IF;

  SELECT * INTO v_d FROM deals WHERE id = v_b.deal_id LIMIT 1;
  v_deal_found := FOUND;

  SELECT coalesce(nullif(shop,''), name) INTO v_seller FROM users WHERE id = v_b.store_id;
  v_buyer := coalesce(nullif(v_b.user_name,''), (SELECT name FROM users WHERE id = v_b.user_id));

  RETURN jsonb_build_object(
    'barcode',             v_b.barcode,
    'backup_code',         v_b.backup_code,
    'status',              v_b.status,
    'booked_quantity',     v_b.booked_quantity,
    'booked_at',           v_b.booked_at,
    'expiry_time',         v_b.expiry_time,
    'completed_at',        v_b.completed_at,
    'prep_time',           coalesce(v_b.prep_time, v_d.prep_time),
    'notes',               v_b.notes,
    'merchant_note',       v_b.merchant_note,
    'deal_id',             v_b.deal_id,
    'deal_exists',         v_deal_found,
    'item_name',           v_d.item_name,
    'shop_name',           coalesce(v_d.shop_name, v_seller),
    'category',            v_d.category,
    'image',               (v_d.images)[1],
    'original_price',      v_d.original_price,
    'discounted_price',    v_d.discounted_price,
    'discount_percentage', v_d.discount_percentage,
    'city',                v_d.city,
    'region',              v_d.region,
    'buyer_name',          v_buyer,
    'buyer_phone',         v_b.user_phone,
    'store_id',            v_b.store_id,
    'user_id',             v_b.user_id,
    'payment_method',      v_b.payment_method,
    'paid_at',             v_b.paid_at,
    'paid_amount',         v_b.paid_amount,
    'fulfillment',         coalesce(v_b.fulfillment, 'pickup'),
    'delivery_address',    v_b.delivery_address,
    'delivery_fee',        v_b.delivery_fee,
    'viewer_is_buyer',     (v_uid = v_b.user_id),
    'viewer_is_seller',    (v_uid = v_b.store_id),
    'viewer_is_admin',     v_is_admin
  );
END;
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- ٩) تنبيهات التقييم المؤجَّلة — الحجوزات المكتملة خلال ٧ أيام بلا تقييم للمتجر
--    أو بلا تصويت مصداقية للعرض. الواجهة تعرض أولها عند كل فتح، فلا يضيع
--    التقييم إن فات حدث الريل‑تايم (الجوال في الجيب وقت الاستلام).
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.pending_rating_prompts()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'barcode',      t.barcode,
           'deal_id',      t.deal_id,
           'store_id',     t.store_id,
           'shop_name',    t.shop_name,
           'completed_at', t.completed_at,
           'has_rating',   t.has_rating,
           'has_vote',     t.has_vote) ORDER BY t.completed_at DESC), '[]'::jsonb)
  FROM (
    SELECT b.barcode, b.deal_id, b.store_id, b.completed_at,
           coalesce(d.shop_name, nullif(u.shop,''), u.name) AS shop_name,
           EXISTS (SELECT 1 FROM public.ratings r
                    WHERE r.user_id = b.user_id AND r.store_id = b.store_id AND r.deleted_at IS NULL) AS has_rating,
           EXISTS (SELECT 1 FROM public.deal_authenticity_votes v
                    WHERE v.user_id = b.user_id AND v.deal_id = b.deal_id) AS has_vote
      FROM public.bookings b
      LEFT JOIN public.deals d ON d.id = b.deal_id
      LEFT JOIN public.users u ON u.id = b.store_id
     WHERE b.user_id = auth.uid()::text
       AND b.status = 'completed'
       AND b.completed_at >= now() - interval '7 days'
       AND d.id IS NOT NULL
     ORDER BY b.completed_at DESC
     LIMIT 20
  ) t
  WHERE NOT (t.has_rating AND t.has_vote);
$fn$;
REVOKE ALL ON FUNCTION public.pending_rating_prompts() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pending_rating_prompts() FROM anon;   -- انظر الملاحظة أعلاه
GRANT EXECUTE ON FUNCTION public.pending_rating_prompts() TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- ١٠) البوتان — عرض التوصيل لعنوان المستخدم المحفوظ
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.bot_delivery_quote(p_telegram_id bigint, p_whatsapp_id text, p_store_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE v_uid text; v_addr jsonb; v_q jsonb;
BEGIN
  v_uid := public._bot_uid(p_telegram_id, p_whatsapp_id);
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_linked'); END IF;
  SELECT delivery_address INTO v_addr FROM public.users WHERE id = v_uid;
  v_q := public.delivery_quote(p_store_id,
           nullif(v_addr->>'lat','')::float8, nullif(v_addr->>'lng','')::float8);
  RETURN v_q || jsonb_build_object(
    'ok', true,
    'has_address', (v_addr IS NOT NULL AND (v_addr->>'lat') IS NOT NULL),
    'label',   v_addr->>'label',
    'details', v_addr->>'details');
END
$fn$;
REVOKE ALL ON FUNCTION public.bot_delivery_quote(bigint, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bot_delivery_quote(bigint, text, text) TO anon, authenticated, service_role;

-- ── bot_book_deal — معامل جديد p_fulfillment. تغيير التوقيع يستلزم DROP أولاً
--    وإلا صار للدالة نسختان و«function is not unique» (درس v11.74).
DROP FUNCTION IF EXISTS public.bot_book_deal(bigint, text, integer, text, text, text, text);
CREATE FUNCTION public.bot_book_deal(
  p_telegram_id bigint, p_deal_id text, p_quantity integer DEFAULT 1, p_notes text DEFAULT NULL::text,
  p_prep_time text DEFAULT NULL::text, p_whatsapp_id text DEFAULT NULL::text, p_location_id text DEFAULT NULL::text,
  p_fulfillment text DEFAULT 'pickup')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_user users%ROWTYPE; v_deal deals%ROWTYPE; v_barcode text; v_backup text; v_expiry bigint; v_now bigint; v_prep text; v_st jsonb; v_src text;
        v_cnt int; v_last timestamptz; v_wait int; v_loc_id text; v_loc_avail int; v_loc_name text; v_avail_now int;
        v_fulfil text; v_addr jsonb; v_q jsonb; v_pay text := 'cod'; v_fee numeric;
BEGIN
  SELECT * INTO v_user FROM users WHERE id = public._bot_uid(p_telegram_id, p_whatsapp_id) AND deleted_at IS NULL LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_linked'); END IF;
  IF v_user.is_suspended THEN RETURN jsonb_build_object('success', false, 'error', 'suspended'); END IF;
  IF p_quantity < 1 THEN p_quantity := 1; END IF;

  SELECT * INTO v_deal FROM deals WHERE id = p_deal_id LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'deal_not_found'); END IF;
  IF v_deal.status <> 'active' THEN RETURN jsonb_build_object('success', false, 'error', 'deal_inactive'); END IF;

  IF v_deal.options IS NOT NULL AND jsonb_typeof(v_deal.options) = 'array' AND EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_deal.options) g
       WHERE COALESCE((g->>'required')::boolean, false))
  THEN RETURN jsonb_build_object('success', false, 'error', 'needs_options'); END IF;
  IF v_deal.variants IS NOT NULL AND jsonb_typeof(v_deal.variants) = 'array'
     AND jsonb_array_length(v_deal.variants) > 0
  THEN RETURN jsonb_build_object('success', false, 'error', 'needs_options'); END IF;

  v_st := public.store_is_open((SELECT working_hours FROM users WHERE id = v_deal.store_id));
  IF (v_st->>'open')::boolean = false THEN
    RETURN jsonb_build_object('success', false, 'error', 'shop_closed', 'opens_in_min', (v_st->>'opens_in_min')::int);
  END IF;

  v_loc_id := NULLIF(btrim(COALESCE(p_location_id, '')), '');
  IF v_deal.locations IS NOT NULL AND jsonb_typeof(v_deal.locations) = 'array'
     AND jsonb_array_length(v_deal.locations) > 0 THEN
    IF v_loc_id IS NULL AND jsonb_array_length(v_deal.locations) = 1 THEN
      v_loc_id := v_deal.locations->0->>'id';
    END IF;
    IF v_loc_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'needs_location',
        'locations', (SELECT jsonb_agg(jsonb_build_object(
            'id', e->>'id',
            'name', COALESCE(NULLIF(e->>'name',''), 'فرع'),
            'quantity', CASE WHEN v_deal.loc_qty_mode = 'per_location'
                             THEN NULLIF(e->>'quantity','')::int ELSE NULL END))
          FROM jsonb_array_elements(v_deal.locations) e));
    END IF;
    SELECT COALESCE(NULLIF(e->>'name',''),'فرع'), NULLIF(e->>'quantity','')::int
      INTO v_loc_name, v_loc_avail
      FROM jsonb_array_elements(v_deal.locations) e
     WHERE e->>'id' = v_loc_id LIMIT 1;
    IF v_loc_name IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'bad_location');
    END IF;
    IF v_deal.loc_qty_mode = 'per_location' AND v_loc_avail IS NOT NULL AND v_loc_avail < p_quantity THEN
      RETURN jsonb_build_object('success', false, 'error', 'no_quantity', 'available', GREATEST(v_loc_avail, 0));
    END IF;
  ELSE
    v_loc_id := NULL;
  END IF;

  IF NOT COALESCE(v_deal.is_unlimited, false)
     AND COALESCE(v_deal.initial_quantity, 0) > 0
     AND COALESCE(v_deal.quantity, 0) < p_quantity THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_quantity', 'available', GREATEST(COALESCE(v_deal.quantity, 0), 0));
  END IF;

  IF COALESCE(v_deal.max_per_booking, 0) > 0 AND p_quantity > v_deal.max_per_booking THEN
    RETURN jsonb_build_object('success', false, 'error', 'max_qty', 'limit', v_deal.max_per_booking);
  END IF;
  IF COALESCE(v_deal.max_bookings_per_buyer, 0) > 0 THEN
    SELECT count(*) INTO v_cnt FROM bookings
     WHERE deal_id = v_deal.id AND user_id = v_user.id
       AND status IN ('pending','acknowledged','completed');
    IF v_cnt >= v_deal.max_bookings_per_buyer THEN
      RETURN jsonb_build_object('success', false, 'error', 'rebook_limit', 'limit', v_deal.max_bookings_per_buyer);
    END IF;
  END IF;
  IF COALESCE(v_deal.rebook_cooldown_minutes, 0) > 0 THEN
    SELECT max(completed_at) INTO v_last FROM bookings
     WHERE deal_id = v_deal.id AND user_id = v_user.id AND status = 'completed';
    IF v_last IS NOT NULL AND v_last + (v_deal.rebook_cooldown_minutes || ' minutes')::interval > now() THEN
      v_wait := CEIL(EXTRACT(EPOCH FROM (v_last + (v_deal.rebook_cooldown_minutes || ' minutes')::interval - now())) / 60)::int;
      RETURN jsonb_build_object('success', false, 'error', 'rebook_wait', 'wait_minutes', GREATEST(v_wait,1));
    END IF;
  END IF;

  -- v14.06 — التوصيل إلى العنوان المحفوظ على الموقع (البوت لا يجمع عناوين)
  v_fulfil := CASE WHEN lower(COALESCE(p_fulfillment, 'pickup')) = 'delivery' THEN 'delivery' ELSE 'pickup' END;
  IF v_fulfil = 'delivery' THEN
    v_addr := v_user.delivery_address;
    IF v_addr IS NULL OR (v_addr->>'lat') IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'delivery_no_address');
    END IF;
    v_q := public.delivery_quote(v_deal.store_id, (v_addr->>'lat')::float8, (v_addr->>'lng')::float8);
    IF NOT COALESCE((v_q->>'available')::boolean, false) THEN
      RETURN jsonb_build_object('success', false, 'error', 'delivery_unavailable', 'reason', v_q->>'reason');
    END IF;
    IF COALESCE((v_q->>'min_order')::numeric, 0) > v_deal.discounted_price * p_quantity THEN
      RETURN jsonb_build_object('success', false, 'error', 'delivery_min_order', 'min_order', (v_q->>'min_order')::numeric);
    END IF;
    v_pay := CASE WHEN v_q->>'payment' = 'card' THEN 'online' ELSE 'cod' END;
    v_fee := (v_q->>'fee')::numeric;
  END IF;

  v_prep := COALESCE(NULLIF(btrim(COALESCE(p_prep_time,'')), ''), v_deal.prep_time, 'arrival');
  v_now := (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint;
  v_src := CASE WHEN p_whatsapp_id IS NOT NULL THEN 'whatsapp' ELSE 'telegram' END;
  LOOP
    v_barcode := _bot_gen_barcode();
    EXIT WHEN NOT EXISTS (SELECT 1 FROM bookings WHERE barcode = v_barcode);
  END LOOP;
  v_backup := _bot_gen_barcode();
  v_expiry := v_now + 7200000;

  BEGIN
    INSERT INTO bookings (barcode, backup_code, deal_id, user_id, store_id, user_name, user_phone,
      booked_quantity, prep_time, notes, status, booked_at, expiry_time, created_at, source,
      location_id, payment_method, fulfillment, delivery_address)
    VALUES (v_barcode, v_backup, p_deal_id, v_user.id, v_deal.store_id, v_user.name, v_user.phone,
      p_quantity, v_prep, NULLIF(btrim(COALESCE(p_notes,'')),''), 'pending', v_now, v_expiry, NOW(), v_src,
      v_loc_id, v_pay, v_fulfil, CASE WHEN v_fulfil = 'delivery' THEN v_addr ELSE NULL END);
  EXCEPTION
    WHEN SQLSTATE 'P0010' THEN
      SELECT COALESCE(quantity, 0) INTO v_avail_now FROM deals WHERE id = p_deal_id;
      RETURN jsonb_build_object('success', false, 'error', 'no_quantity', 'available', GREATEST(COALESCE(v_avail_now,0),0));
    WHEN SQLSTATE 'P0011' THEN
      RETURN jsonb_build_object('success', false, 'error', 'rate_limited', 'msg', SQLERRM);
    WHEN SQLSTATE 'P0013' THEN
      RETURN jsonb_build_object('success', false, 'error', 'delivery_unavailable', 'msg', SQLERRM);
  END;

  RETURN jsonb_build_object('success', true, 'barcode', v_barcode, 'deal_name', v_deal.item_name,
    'shop_name', v_deal.shop_name, 'store_id', v_deal.store_id, 'quantity', p_quantity, 'prep_time', v_prep,
    'location_id', v_loc_id, 'location_name', v_loc_name,
    'fulfillment', v_fulfil, 'delivery_fee', v_fee, 'delivery_label', v_addr->>'label',
    'payment_method', v_pay, 'unit_price', v_deal.discounted_price,
    'expiry_at', to_timestamp(v_expiry::double precision / 1000));
END; $function$;
REVOKE ALL ON FUNCTION public.bot_book_deal(bigint, text, integer, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bot_book_deal(bigint, text, integer, text, text, text, text, text) TO anon, authenticated, service_role;

-- ── قوائم الحجوزات في البوتين — سطر التوصيل
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
      'fulfillment', coalesce(b.fulfillment, 'pickup'),
      'delivery_fee', b.delivery_fee,
      'delivery_label', b.delivery_address->>'label',
      'delivery_details', b.delivery_address->>'details',
      'delivery_lat', b.delivery_address->>'lat',
      'delivery_lng', b.delivery_address->>'lng'
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

CREATE OR REPLACE FUNCTION public.bot_get_seller_bookings(p_telegram_id bigint, p_scope text DEFAULT 'current'::text, p_whatsapp_id text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_sid text; v_res jsonb;
BEGIN
  SELECT id INTO v_sid FROM users WHERE id = public._bot_uid(p_telegram_id, p_whatsapp_id) AND user_type IN ('seller','admin') AND deleted_at IS NULL LIMIT 1;
  IF v_sid IS NULL THEN RETURN NULL; END IF;
  SELECT jsonb_agg(row ORDER BY (row->>'sort_at')::bigint DESC) INTO v_res FROM (
    SELECT jsonb_build_object(
      'barcode', b.barcode, 'user_name', COALESCE(b.user_name,'—'), 'user_phone', COALESCE(b.user_phone,'—'),
      'deal_name', d.item_name, 'quantity', b.booked_quantity, 'status', b.status,
      'notes', COALESCE(b.notes,''), 'prep_time', b.prep_time, 'sort_at', b.booked_at,
      'expiry_time', b.expiry_time,
      'unread', (SELECT count(*) FROM booking_messages m WHERE m.barcode = b.barcode AND m.sender_role='buyer' AND m.read_at IS NULL),
      'booked_at', to_timestamp(b.booked_at::double precision / 1000),
      'fulfillment', coalesce(b.fulfillment, 'pickup'),
      'delivery_fee', b.delivery_fee,
      'delivery_label', b.delivery_address->>'label',
      'delivery_details', b.delivery_address->>'details',
      'delivery_phone', b.delivery_address->>'phone',
      'delivery_lat', b.delivery_address->>'lat',
      'delivery_lng', b.delivery_address->>'lng',
      'payment_method', b.payment_method,
      'paid', b.paid_at IS NOT NULL
    ) AS row
    FROM bookings b JOIN deals d ON d.id = b.deal_id
    WHERE b.store_id = v_sid
      AND ( p_scope = 'all'
         OR (p_scope = 'current'  AND b.status IN ('pending','acknowledged'))
         OR (p_scope = 'previous' AND b.status IN ('completed','cancelled','expired')) )
    ORDER BY b.booked_at DESC LIMIT 30
  ) t;
  RETURN COALESCE(v_res, '[]'::jsonb);
END; $function$;

-- ════════════════════════════════════════════════════════════════════════════
-- ١١) فاتورة البوت — كل ما تحتاجه نسخة PDF مطابقة للموقع:
--     رموز الكاشير (SKU) للصنف والأنواع والإضافات · الكود الاحتياطي · الفرع ·
--     التوصيل (العنوان والرسوم) · طريقة الدفع · ملاحظة المشتري منفصلة.
-- ════════════════════════════════════════════════════════════════════════════
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
  IF v_b.paid_amount IS NOT NULL AND v_b.paid_amount > 0 THEN
    v_total := v_b.paid_amount;
  ELSE
    v_total := NULLIF(substring(coalesce(v_b.notes, '') FROM 'الإجمالي:\s*([0-9]+(?:\.[0-9]+)?)'), '')::numeric;
  END IF;
  IF v_total IS NULL AND v_d.discounted_price IS NOT NULL THEN
    v_total := v_d.discounted_price * coalesce(v_b.booked_quantity, 1) + coalesce(v_b.delivery_fee, 0);
  END IF;

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
    'total_source',  CASE WHEN v_b.paid_amount > 0 THEN 'paid'
                          WHEN v_b.notes ~ 'الإجمالي:' THEN 'order'
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
REVOKE ALL ON FUNCTION public.bot_get_booking_invoice(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bot_get_booking_invoice(text, text) TO anon, authenticated, service_role;

COMMIT;

-- ── تقرير التحقّق (أول سطر = اسم الخادم) ────────────────────────────────────
SELECT 'الخادم' AS "الفحص",
       coalesce(obj_description('public'::regnamespace, 'pg_namespace'), 'جدة (بلا وسم مختبر)')
         || ' · db=' || current_database() AS "النتيجة",
       'ℹ️' AS "الحالة"
UNION ALL
SELECT 'أعمدة التوصيل على store_profiles',
       count(*)::text || '/6',
       CASE WHEN count(*) = 6 THEN '✅' ELSE '❌' END
  FROM information_schema.columns
 WHERE table_schema='public' AND table_name='store_profiles'
   AND column_name IN ('delivery_enabled','delivery_payment','delivery_fee','delivery_min_order','delivery_eta_min','delivery_note')
UNION ALL
SELECT 'عنوان المشتري users.delivery_address',
       CASE WHEN count(*)=1 THEN 'موجود' ELSE 'مفقود' END, CASE WHEN count(*)=1 THEN '✅' ELSE '❌' END
  FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='delivery_address'
UNION ALL
SELECT 'جدول store_delivery_zones + RLS',
       CASE WHEN c.relrowsecurity THEN 'موجود · RLS مفعّل' ELSE 'RLS معطّل!' END,
       CASE WHEN c.relrowsecurity THEN '✅' ELSE '❌' END
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='store_delivery_zones'
UNION ALL
SELECT 'سياسات النطاقات', count(*)::text || '/4', CASE WHEN count(*)=4 THEN '✅' ELSE '❌' END
  FROM pg_policies WHERE tablename='store_delivery_zones'
UNION ALL
SELECT 'أعمدة الحجز (fulfillment/delivery_address/delivery_fee)', count(*)::text || '/3', CASE WHEN count(*)=3 THEN '✅' ELSE '❌' END
  FROM information_schema.columns WHERE table_schema='public' AND table_name='bookings'
   AND column_name IN ('fulfillment','delivery_address','delivery_fee')
UNION ALL
SELECT 'حارس التوصيل tr_ac_booking_delivery',
       CASE WHEN count(*)=1 THEN 'مركَّب' ELSE 'مفقود' END, CASE WHEN count(*)=1 THEN '✅' ELSE '❌' END
  FROM pg_trigger WHERE tgname='tr_ac_booking_delivery' AND tgrelid='public.bookings'::regclass
UNION ALL
SELECT 'تجميد حقول التوصيل في حارس السلامة',
       CASE WHEN prosrc LIKE '%NEW.fulfillment      IS DISTINCT FROM OLD.fulfillment%' THEN 'نعم' ELSE 'لا' END,
       CASE WHEN prosrc LIKE '%NEW.fulfillment      IS DISTINCT FROM OLD.fulfillment%' THEN '✅' ELSE '❌' END
  FROM pg_proc WHERE proname='tr_guard_booking_integrity'
UNION ALL
SELECT 'الدوال الجديدة', count(*)::text || '/8', CASE WHEN count(*)=8 THEN '✅' ELSE '❌' END
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN ('_taki_km','_taki_point_in_polygon','_taki_zone_contains','delivery_quote',
   'merchant_set_delivery','pending_rating_prompts','bot_delivery_quote','tr_guard_delivery_zone')
UNION ALL
SELECT 'bot_book_deal نسخة واحدة (٨ معاملات)',
       count(*)::text || ' نسخة', CASE WHEN count(*)=1 THEN '✅' ELSE '❌' END
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='bot_book_deal'
UNION ALL
SELECT 'الفاتورة تُرجع رموز الكاشير',
       CASE WHEN prosrc LIKE '%main_sku%' AND prosrc LIKE '%posSku%' THEN 'نعم' ELSE 'لا' END,
       CASE WHEN prosrc LIKE '%main_sku%' AND prosrc LIKE '%posSku%' THEN '✅' ELSE '❌' END
  FROM pg_proc WHERE proname='bot_get_booking_invoice'
UNION ALL
SELECT 'delivery_quote: نقطة داخل دائرة اختبارية',
       CASE WHEN public._taki_km(24.7136, 46.6753, 24.7236, 46.6853) BETWEEN 1.4 AND 1.6 THEN 'المسافة صحيحة (~1.5 كم)' ELSE 'خطأ حساب' END,
       CASE WHEN public._taki_km(24.7136, 46.6753, 24.7236, 46.6853) BETWEEN 1.4 AND 1.6 THEN '✅' ELSE '❌' END
UNION ALL
SELECT 'نقطة داخل/خارج مضلّع',
       CASE WHEN public._taki_point_in_polygon('[[24.70,46.66],[24.70,46.70],[24.74,46.70],[24.74,46.66]]'::jsonb, 24.72, 46.68)
             AND NOT public._taki_point_in_polygon('[[24.70,46.66],[24.70,46.70],[24.74,46.70],[24.74,46.66]]'::jsonb, 24.80, 46.68)
            THEN 'صحيح' ELSE 'خطأ' END,
       CASE WHEN public._taki_point_in_polygon('[[24.70,46.66],[24.70,46.70],[24.74,46.70],[24.74,46.66]]'::jsonb, 24.72, 46.68)
             AND NOT public._taki_point_in_polygon('[[24.70,46.66],[24.70,46.70],[24.74,46.70],[24.74,46.66]]'::jsonb, 24.80, 46.68)
            THEN '✅' ELSE '❌' END
UNION ALL
SELECT 'anon محروم من الدالتين المقصورتين على المسجّلين',
       CASE WHEN bool_or(has_function_privilege('anon', p.oid, 'EXECUTE')) THEN 'ما زال يملك!' ELSE 'محروم' END,
       CASE WHEN bool_or(has_function_privilege('anon', p.oid, 'EXECUTE')) THEN '❌' ELSE '✅' END
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN ('pending_rating_prompts','merchant_set_delivery')
UNION ALL
SELECT 'PUBLIC محروم من الدوال الجديدة',
       CASE WHEN bool_or(has_function_privilege('public', p.oid, 'EXECUTE')) THEN 'ما زال يملك!' ELSE 'محروم' END,
       CASE WHEN bool_or(has_function_privilege('public', p.oid, 'EXECUTE')) THEN '❌' ELSE '✅' END
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN ('delivery_quote','merchant_set_delivery','pending_rating_prompts','bot_delivery_quote','bot_get_booking_invoice');
