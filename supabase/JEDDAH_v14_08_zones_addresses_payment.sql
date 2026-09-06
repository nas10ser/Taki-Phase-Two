-- ============================================================================
-- TAKI · v14.08 — نطاق لكل فرع · عناوين متعددة · إقرار طريقة الحساب · بوابة التتبّع
-- ============================================================================
-- بلاغات ناصر (٣ سبتمبر ٢٠٢٦) — أربعة منها تمسّ القاعدة:
--
-- (١) «لكل موقع للتاجر حدود عنوانه» — متجرٌ له فرع في الخبر وفرع في الباحة لا
--     يجوز أن يوصّل من فرع الباحة إلى عنوان داخل نطاق الخبر. النطاق يُربط
--     **بالفرع** لا بالمتجر، والحجز يُقاس بنطاق **الفرع الذي اختاره المشتري**.
--     قِيس على الإنتاج: متجر «تاكي» له خمسة فروع تفصل بينها ألف كيلومتر
--     (الخبر ٢٦.٣٠ · الباحة ٢٠.٠١ · جازان ١٦.٨٩) — والنطاق كان يُقاس بالمتجر
--     كله، أي أن نطاق الخبر كان يفتح التوصيل لحجزٍ من فرع جازان.
--
-- (٤) عناوين متعددة للمشتري (المنزل · العمل · …) بدل عنوان واحد.
--
-- (٧) «لا يتفعّل تتبّع التوصيل إلا بعد استلام الطلب» — بثّ الموقع يبدأ بعد
--     تأكيد التاجر استلامَ الطلب (acknowledged) لا قبله.
--
-- (٨) «يوجد متجر لم يضع طريقة الحساب وأستطيع الحجز» — لا بيع قبل إقرار التاجر
--     كيف يُحاسِب. القديم المُشتغل يُختم تلقائياً (لا نكسر متجراً يعمل)، ومن لم
--     يبِع قط يُطالَب بالإقرار قبل أول حجز.
--
-- آمنة للتكرار · تُطبَّق على خادم جدة حصراً.
-- ============================================================================

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
-- ١) النطاق يُربط بفرع
-- ════════════════════════════════════════════════════════════════════════════
-- `branch_id` = معرّف الموقع كما يراه العرض والحجز: 'primary' لموقع المتجر
-- الأساسي، أو `store_branches.id` لفرعٍ مسمّى. NULL = «كل الفروع» — تبقى
-- للمتجر ذي الموقع الواحد وللنطاقات المرسومة قبل هذه النسخة، فلا ينكسر شيء.
ALTER TABLE public.store_delivery_zones
  ADD COLUMN IF NOT EXISTS branch_id text;

CREATE INDEX IF NOT EXISTS idx_delivery_zones_branch
  ON public.store_delivery_zones(store_id, branch_id) WHERE is_active;

-- الحارس: الفرع يجب أن يخصّ هذا المتجر فعلاً — وإلا صار بالإمكان رسم نطاق
-- باسم فرع متجرٍ آخر.
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
  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = NEW.store_id AND u.user_type IN ('seller','admin')) THEN
    RAISE EXCEPTION 'TAKI_ZONE_BAD:not_store' USING ERRCODE = '42501';
  END IF;

  NEW.name := nullif(left(btrim(coalesce(NEW.name, '')), 60), '');
  NEW.branch_id := nullif(btrim(coalesce(NEW.branch_id, '')), '');
  -- v14.08 — الفرع إمّا 'primary' (موقع المتجر) أو فرعٌ يملكه هذا المتجر.
  IF NEW.branch_id IS NOT NULL AND NEW.branch_id <> 'primary'
     AND NOT EXISTS (SELECT 1 FROM public.store_branches b
                      WHERE b.id = NEW.branch_id AND b.merchant_id = NEW.store_id) THEN
    RAISE EXCEPTION 'TAKI_ZONE_BAD:branch' USING ERRCODE = '23514';
  END IF;

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

-- ── عرض التوصيل صار يقيس بنطاق **الفرع** ────────────────────────────────────
-- تغيير التوقيع يستلزم DROP: إضافة معامل بقيمة افتراضية تُنشئ حِملاً ثانياً
-- فتصير المناداة ملتبسة («function is not unique») — درس v11.74.
-- ⚠️ ويُسقَط **التوقيعان**: إسقاط القديم وحده يجعل التشغيل الثاني يفشل بـ
--    «function already exists» لأن CREATE (لا OR REPLACE) يصطدم بالجديد.
--    قِيس: التشغيل الثاني لهذه الهجرة فشل فعلاً هنا وتراجعت المعاملة كلها.
DROP FUNCTION IF EXISTS public.delivery_quote(text, double precision, double precision);
DROP FUNCTION IF EXISTS public.delivery_quote(text, double precision, double precision, text);
CREATE FUNCTION public.delivery_quote(
  p_store_id text, p_lat double precision, p_lng double precision,
  p_location_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  sp   public.store_profiles%ROWTYPE;
  z    public.store_delivery_zones%ROWTYPE;
  -- عرضٌ بلا فرع محدّد = الموقع الأساسي للمتجر. بدون هذه المساواة يسقط كل عرضٍ
  -- ذي موقع واحد (location_id فارغ) خارج نطاقاته المرسومة على 'primary' فلا
  -- يظهر له توصيل أبداً — وهي الحالة الأشيع: متجرٌ بفروع، وعرضٌ في المحل الرئيس.
  v_loc text := coalesce(nullif(btrim(coalesce(p_location_id, '')), ''), 'primary');
  v_zone_count int;
BEGIN
  SELECT * INTO sp FROM public.store_profiles WHERE store_id = p_store_id;
  IF NOT FOUND OR NOT coalesce(sp.delivery_enabled, false) THEN
    RETURN jsonb_build_object('enabled', false, 'available', false, 'reason', 'disabled');
  END IF;

  -- النطاقات التي تحكم هذا الحجز: نطاقات الفرع المختار + النطاقات العامة
  -- (branch_id IS NULL) التي رُسمت قبل ربط النطاق بالفرع أو لمتجر بموقع واحد.
  SELECT count(*) INTO v_zone_count
    FROM public.store_delivery_zones dz
   WHERE dz.store_id = p_store_id AND dz.is_active
     AND (dz.branch_id IS NULL OR (v_loc IS NOT NULL AND dz.branch_id = v_loc));

  IF v_zone_count = 0 THEN
    RETURN jsonb_build_object('enabled', true, 'available', false, 'reason', 'no_zones',
      'payment', sp.delivery_payment, 'min_order', sp.delivery_min_order,
      'eta_min', sp.delivery_eta_min, 'note', sp.delivery_note);
  END IF;
  IF p_lat IS NULL OR p_lng IS NULL THEN
    RETURN jsonb_build_object('enabled', true, 'available', false, 'reason', 'no_location',
      'payment', sp.delivery_payment, 'min_order', sp.delivery_min_order,
      'eta_min', sp.delivery_eta_min, 'note', sp.delivery_note);
  END IF;

  SELECT * INTO z FROM public.store_delivery_zones dz
   WHERE dz.store_id = p_store_id AND dz.is_active
     AND (dz.branch_id IS NULL OR (v_loc IS NOT NULL AND dz.branch_id = v_loc))
     AND public._taki_zone_contains(dz, p_lat, p_lng)
   ORDER BY coalesce(dz.fee, sp.delivery_fee) ASC, dz.created_at ASC
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('enabled', true, 'available', false, 'reason', 'out_of_zone',
      'payment', sp.delivery_payment, 'min_order', sp.delivery_min_order,
      'eta_min', sp.delivery_eta_min, 'note', sp.delivery_note);
  END IF;

  RETURN jsonb_build_object(
    'enabled',   true,
    'available', true,
    'zone_id',   z.id,
    'zone_name', z.name,
    'branch_id', z.branch_id,
    'fee',       round(coalesce(z.fee, sp.delivery_fee), 2),
    'min_order', sp.delivery_min_order,
    'payment',   sp.delivery_payment,
    'eta_min',   sp.delivery_eta_min,
    'note',      sp.delivery_note);
END
$fn$;
REVOKE ALL ON FUNCTION public.delivery_quote(text, double precision, double precision, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delivery_quote(text, double precision, double precision, text) TO anon, authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- ٢) إقرار التاجر بطريقة الحساب — لا بيع قبله
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.store_profiles
  ADD COLUMN IF NOT EXISTS accepts_cod          boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS payment_declared_at  timestamptz;

-- ختمٌ تلقائي لمن يعمل فعلاً: متجرٌ أتمّ بيعةً واحدة أثبت أنه يحاسب عملاءه،
-- فلا يُوقَف اليوم بسبب إقرارٍ لم يكن موجوداً حين باع. ومن لم يبع قط يُطالَب.
UPDATE public.store_profiles sp
   SET payment_declared_at = now()
 WHERE sp.payment_declared_at IS NULL
   AND EXISTS (SELECT 1 FROM public.bookings b
                WHERE b.store_id = sp.store_id AND b.status = 'completed');

-- هل يستطيع هذا المتجر البيع أصلاً؟ سببٌ واحد مفهوم لكل حالة.
CREATE OR REPLACE FUNCTION public.store_can_sell(p_store_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE sp public.store_profiles%ROWTYPE; v_mode text; v_online boolean;
BEGIN
  SELECT * INTO sp FROM public.store_profiles WHERE store_id = p_store_id;
  v_mode := public.deal_payment_mode(p_store_id);
  v_online := v_mode IN ('online','both');
  IF sp.store_id IS NULL OR sp.payment_declared_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_declared',
      'accepts_cod', coalesce(sp.accepts_cod, true), 'online', v_online);
  END IF;
  -- أقرّ ألا نقد ولا بوابة ⇒ لا وسيلة لتحصيل الثمن أصلاً.
  IF NOT coalesce(sp.accepts_cod, true) AND NOT v_online THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_method', 'accepts_cod', false, 'online', false);
  END IF;
  RETURN jsonb_build_object('ok', true, 'accepts_cod', coalesce(sp.accepts_cod, true), 'online', v_online);
END
$fn$;
REVOKE ALL ON FUNCTION public.store_can_sell(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.store_can_sell(text) TO anon, authenticated, service_role;

-- التاجر يُقرّ (ويُختم الوقت) — نداء واحد من بطاقة «طريقة الحساب».
CREATE OR REPLACE FUNCTION public.merchant_set_payment_declaration(p_accepts_cod boolean)
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
  v_mode := public.deal_payment_mode(v_uid);
  -- رفض النقد بلا بوابة يعني متجراً لا يستطيع تحصيل ريال واحد — نمنعه بدل أن
  -- نتركه يكتشف ذلك من مشترٍ لا يستطيع الحجز.
  IF NOT coalesce(p_accepts_cod, true) AND v_mode NOT IN ('online','both') THEN
    RAISE EXCEPTION 'NEED_GATEWAY_OR_COD';
  END IF;

  INSERT INTO public.store_profiles (store_id, accepts_cod, payment_declared_at)
  VALUES (v_uid, coalesce(p_accepts_cod, true), now())
  ON CONFLICT (store_id) DO UPDATE SET
    accepts_cod = EXCLUDED.accepts_cod,
    payment_declared_at = now(),
    updated_at = now();

  RETURN public.store_can_sell(v_uid);
END
$fn$;
REVOKE ALL ON FUNCTION public.merchant_set_payment_declaration(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.merchant_set_payment_declaration(boolean) TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- ٣) عناوين متعددة للمشتري
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.user_addresses (
  id         text PRIMARY KEY DEFAULT 'ua_' || replace(gen_random_uuid()::text, '-', ''),
  user_id    text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  label      text,
  details    text,
  city       text,
  phone      text,
  lat        double precision NOT NULL,
  lng        double precision NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_addresses_user ON public.user_addresses(user_id);

ALTER TABLE public.user_addresses ENABLE ROW LEVEL SECURITY;
-- عنوان المنزل بيان شخصي: صاحبه وحده يراه ويكتبه. لا استثناء للأدمن هنا —
-- الأدمن لا يحتاج عناوين المشترين، وما لا يُقرأ لا يُسرَّب.
DROP POLICY IF EXISTS user_addresses_select_own ON public.user_addresses;
CREATE POLICY user_addresses_select_own ON public.user_addresses FOR SELECT
  USING ((SELECT auth.uid())::text = user_id);
DROP POLICY IF EXISTS user_addresses_insert_own ON public.user_addresses;
CREATE POLICY user_addresses_insert_own ON public.user_addresses FOR INSERT
  WITH CHECK ((SELECT auth.uid())::text = user_id);
DROP POLICY IF EXISTS user_addresses_update_own ON public.user_addresses;
CREATE POLICY user_addresses_update_own ON public.user_addresses FOR UPDATE
  USING ((SELECT auth.uid())::text = user_id)
  WITH CHECK ((SELECT auth.uid())::text = user_id);
DROP POLICY IF EXISTS user_addresses_delete_own ON public.user_addresses;
CREATE POLICY user_addresses_delete_own ON public.user_addresses FOR DELETE
  USING ((SELECT auth.uid())::text = user_id);

REVOKE ALL ON public.user_addresses FROM PUBLIC;
REVOKE ALL ON public.user_addresses FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_addresses TO authenticated;
GRANT ALL ON public.user_addresses TO service_role;

-- حارس: حدود المملكة + سقف ١٠ عناوين + افتراضيٌّ واحد لا أكثر.
CREATE OR REPLACE FUNCTION public.tr_guard_user_address()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE v_cnt int;
BEGIN
  IF NEW.lat IS NULL OR NEW.lng IS NULL
     OR NEW.lat NOT BETWEEN 16 AND 33 OR NEW.lng NOT BETWEEN 34 AND 56 THEN
    RAISE EXCEPTION 'TAKI_ADDR_BAD:point' USING ERRCODE = '23514';
  END IF;
  NEW.label   := nullif(left(btrim(coalesce(NEW.label, '')), 60), '');
  NEW.details := nullif(left(btrim(coalesce(NEW.details, '')), 300), '');
  NEW.city    := nullif(left(btrim(coalesce(NEW.city, '')), 60), '');
  NEW.phone   := nullif(left(btrim(coalesce(NEW.phone, '')), 20), '');
  IF TG_OP = 'INSERT' THEN
    SELECT count(*) INTO v_cnt FROM public.user_addresses WHERE user_id = NEW.user_id;
    IF v_cnt >= 10 THEN RAISE EXCEPTION 'TAKI_ADDR_CAP:10' USING ERRCODE = '23514'; END IF;
    -- أول عنوان يصير الافتراضي بلا سؤال — لا يُعقل أن يملك المشتري عنواناً واحداً
    -- ولا يكون افتراضياً، فيرى «لا عنوان محدد» وعنده عنوان.
    IF v_cnt = 0 THEN NEW.is_default := true; END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$fn$;
DROP TRIGGER IF EXISTS tr_guard_user_address ON public.user_addresses;
CREATE TRIGGER tr_guard_user_address BEFORE INSERT OR UPDATE ON public.user_addresses
  FOR EACH ROW EXECUTE FUNCTION public.tr_guard_user_address();

-- افتراضيٌّ واحد لكل مستخدم: ترقية عنوان تُنزل ما سواه.
CREATE OR REPLACE FUNCTION public.tr_single_default_address()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NEW.is_default THEN
    UPDATE public.user_addresses SET is_default = false, updated_at = now()
     WHERE user_id = NEW.user_id AND id <> NEW.id AND is_default;
    -- `users.delivery_address` تبقى مرآةً للعنوان الافتراضي: البوتان وكل ما
    -- كُتب قبل هذه النسخة يقرؤها، فمزامنتها هنا تُبقيهما يعملان بلا تعديل.
    UPDATE public.users SET delivery_address = jsonb_strip_nulls(jsonb_build_object(
        'label', NEW.label, 'details', NEW.details, 'city', NEW.city,
        'phone', NEW.phone, 'lat', NEW.lat, 'lng', NEW.lng, 'addr_id', NEW.id))
     WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END
$fn$;
DROP TRIGGER IF EXISTS tr_zz_single_default_address ON public.user_addresses;
CREATE TRIGGER tr_zz_single_default_address AFTER INSERT OR UPDATE OF is_default, lat, lng, label, details, city, phone
  ON public.user_addresses FOR EACH ROW EXECUTE FUNCTION public.tr_single_default_address();

-- ترحيل العنوان المفرد القائم إلى الجدول (مرة واحدة، آمن للتكرار)
INSERT INTO public.user_addresses (user_id, label, details, city, phone, lat, lng, is_default)
SELECT u.id,
       nullif(u.delivery_address->>'label',''), nullif(u.delivery_address->>'details',''),
       nullif(u.delivery_address->>'city',''),  nullif(u.delivery_address->>'phone',''),
       (u.delivery_address->>'lat')::float8, (u.delivery_address->>'lng')::float8, true
  FROM public.users u
 WHERE u.delivery_address IS NOT NULL
   AND (u.delivery_address->>'lat') IS NOT NULL
   AND (u.delivery_address->>'lng') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.user_addresses a WHERE a.user_id = u.id);

-- ════════════════════════════════════════════════════════════════════════════
-- ٤) حارس الحجز: نطاق الفرع · إقرار الحساب
-- ════════════════════════════════════════════════════════════════════════════
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
  v_price numeric;
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

  v_min := coalesce((v_q->>'min_order')::numeric, 0);
  IF v_min > 0 THEN
    v_est := nullif(substring(coalesce(NEW.notes, '') FROM 'الإجمالي:\s*([0-9]+(?:\.[0-9]+)?)'), '')::numeric;
    IF v_est IS NULL THEN
      SELECT d.discounted_price INTO v_price FROM public.deals d WHERE d.id = NEW.deal_id;
      v_est := coalesce(v_price, 0) * coalesce(NEW.booked_quantity, 1);
    ELSE
      v_est := v_est - coalesce((v_q->>'fee')::numeric, 0);
    END IF;
    IF v_est < v_min THEN
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

-- ════════════════════════════════════════════════════════════════════════════
-- ٥) بوابة التتبّع: لا بثّ قبل أن يؤكّد التاجر استلام الطلب
-- ════════════════════════════════════════════════════════════════════════════
-- بلاغ ناصر ٧: «لا يتفعّل تتبّع التوصيل إلا بعد استلام الطلب». منطقياً كذلك:
-- طلبٌ لم يُؤكّده التاجر قد لا يُجهَّز أصلاً، فبثّ موقعٍ له وعدٌ للمشتري بلا سند.
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
  IF v_b.store_id IS DISTINCT FROM v_uid THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF coalesce(v_b.fulfillment,'pickup') <> 'delivery' THEN RAISE EXCEPTION 'NOT_DELIVERY'; END IF;
  IF v_b.status IN ('cancelled') THEN RAISE EXCEPTION 'BOOKING_CLOSED'; END IF;
  -- الانطلاق يستلزم تأكيد الاستلام أولاً. الإيقاف والإنهاء لا يستلزمانه
  -- (لا يُحبس تاجرٌ عن إيقاف بثٍّ بدأه).
  IF p_status IN ('on_the_way','arrived') AND v_b.status = 'pending' THEN
    RAISE EXCEPTION 'NOT_ACKNOWLEDGED';
  END IF;

  INSERT INTO public.delivery_tracks (barcode, store_id, user_id, status, started_at)
  VALUES (v_b.barcode, v_b.store_id, v_b.user_id, p_status,
          CASE WHEN p_status = 'on_the_way' THEN now() ELSE NULL END)
  ON CONFLICT (barcode) DO UPDATE SET
    status     = EXCLUDED.status,
    started_at = CASE WHEN EXCLUDED.status = 'on_the_way'
                      THEN coalesce(public.delivery_tracks.started_at, now())
                      ELSE public.delivery_tracks.started_at END,
    ended_at   = CASE WHEN EXCLUDED.status IN ('delivered','cancelled') THEN now() ELSE NULL END,
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

-- نفس البوابة في مسار البوت: أول نبضة تبدأ التتبّع ضمناً، فلا بدّ أن تُحرَس مثله.
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
  IF v_b.status = 'pending' THEN RETURN jsonb_build_object('ok', false, 'error', 'not_acknowledged'); END IF;

  SELECT * INTO v_prev FROM public.delivery_tracks WHERE barcode = v_b.barcode;
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

-- ── عرض التوصيل للبوت صار يمرّر الفرع كذلك ──────────────────────────────────
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
           nullif(v_addr->>'lat','')::float8, nullif(v_addr->>'lng','')::float8, NULL);
  RETURN v_q || jsonb_build_object(
    'ok', true,
    'has_address', (v_addr IS NOT NULL AND (v_addr->>'lat') IS NOT NULL),
    'label',   v_addr->>'label',
    'details', v_addr->>'details');
END
$fn$;

-- نظيرتها بمعرفة الفرع (يناديها البوت بعد اختيار المشتري فرعاً)
CREATE OR REPLACE FUNCTION public.bot_delivery_quote_at(
  p_telegram_id bigint, p_whatsapp_id text, p_store_id text, p_location_id text)
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
           nullif(v_addr->>'lat','')::float8, nullif(v_addr->>'lng','')::float8, p_location_id);
  RETURN v_q || jsonb_build_object(
    'ok', true,
    'has_address', (v_addr IS NOT NULL AND (v_addr->>'lat') IS NOT NULL),
    'label',   v_addr->>'label',
    'details', v_addr->>'details');
END
$fn$;
REVOKE ALL ON FUNCTION public.bot_delivery_quote_at(bigint, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bot_delivery_quote_at(bigint, text, text, text) TO anon, authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- ٦) مسار البوت: نفس الحُكم حرفياً (الفرع + إقرار الحساب)
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ `bot_book_deal` كانت تستفتي `delivery_quote` **بلا فرع**، فتقول للمشتري في
--    البوت «التوصيل متاح» ثم يرفضه حارسُ الإدراج لأنه يقيس بالفرع — وعدٌ ثم
--    خذلان برسالة خام. الحارس كان يحمي البيانات فعلاً (لا ثغرة)، لكن الحُكم
--    يجب أن يكون واحداً في كل المسارات لا أن يتناقض مسارٌ مع مسار.
CREATE OR REPLACE FUNCTION public.bot_book_deal(
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
        v_fulfil text; v_addr jsonb; v_q jsonb; v_pay text := 'cod'; v_fee numeric; v_sell jsonb;
BEGIN
  SELECT * INTO v_user FROM users WHERE id = public._bot_uid(p_telegram_id, p_whatsapp_id) AND deleted_at IS NULL LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_linked'); END IF;
  IF v_user.is_suspended THEN RETURN jsonb_build_object('success', false, 'error', 'suspended'); END IF;
  IF p_quantity < 1 THEN p_quantity := 1; END IF;

  SELECT * INTO v_deal FROM deals WHERE id = p_deal_id LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'deal_not_found'); END IF;
  IF v_deal.status <> 'active' THEN RETURN jsonb_build_object('success', false, 'error', 'deal_inactive'); END IF;

  -- v14.08 — لا بيع قبل إقرار التاجر بطريقة الحساب (نفس حارس الموقع).
  v_sell := public.store_can_sell(v_deal.store_id);
  IF NOT COALESCE((v_sell->>'ok')::boolean, false) THEN
    RETURN jsonb_build_object('success', false, 'error', 'store_no_payment', 'reason', v_sell->>'reason');
  END IF;

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

  v_fulfil := CASE WHEN lower(COALESCE(p_fulfillment, 'pickup')) = 'delivery' THEN 'delivery' ELSE 'pickup' END;
  IF v_fulfil = 'delivery' THEN
    v_addr := v_user.delivery_address;
    IF v_addr IS NULL OR (v_addr->>'lat') IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'delivery_no_address');
    END IF;
    -- ⚠️ الفرع يُمرَّر: نفس ما يقيسه حارس الإدراج بالضبط.
    v_q := public.delivery_quote(v_deal.store_id, (v_addr->>'lat')::float8, (v_addr->>'lng')::float8, v_loc_id);
    IF NOT COALESCE((v_q->>'available')::boolean, false) THEN
      RETURN jsonb_build_object('success', false, 'error', 'delivery_unavailable', 'reason', v_q->>'reason');
    END IF;
    IF COALESCE((v_q->>'min_order')::numeric, 0) > v_deal.discounted_price * p_quantity THEN
      RETURN jsonb_build_object('success', false, 'error', 'delivery_min_order', 'min_order', (v_q->>'min_order')::numeric);
    END IF;
    v_pay := CASE WHEN v_q->>'payment' = 'card' THEN 'online' ELSE 'cod' END;
    v_fee := (v_q->>'fee')::numeric;
  ELSIF NOT COALESCE((v_sell->>'accepts_cod')::boolean, true) THEN
    -- متجر «بطاقة فقط» — الاستلام من المتجر يُدفع إلكترونياً كذلك.
    v_pay := 'online';
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

COMMIT;

-- ── تقرير التحقّق ───────────────────────────────────────────────────────────
SELECT 'الخادم' AS "الفحص",
       coalesce(obj_description('public'::regnamespace, 'pg_namespace'), 'جدة (بلا وسم مختبر)') AS "النتيجة",
       'ℹ️' AS "الحالة"
UNION ALL
SELECT 'عمود الفرع على النطاقات',
       CASE WHEN count(*)=1 THEN 'موجود' ELSE 'مفقود' END, CASE WHEN count(*)=1 THEN '✅' ELSE '❌' END
  FROM information_schema.columns WHERE table_schema='public' AND table_name='store_delivery_zones' AND column_name='branch_id'
UNION ALL
SELECT 'delivery_quote بأربعة معاملات (نسخة واحدة)',
       count(*)::text||' نسخة', CASE WHEN count(*)=1 THEN '✅' ELSE '❌' END
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='delivery_quote'
UNION ALL
SELECT 'أعمدة إقرار الحساب', count(*)::text||'/2', CASE WHEN count(*)=2 THEN '✅' ELSE '❌' END
  FROM information_schema.columns WHERE table_schema='public' AND table_name='store_profiles'
   AND column_name IN ('accepts_cod','payment_declared_at')
UNION ALL
SELECT 'متاجر مختومة تلقائياً (لها بيعة مكتملة)',
       count(*)::text||' متجر', 'ℹ️' FROM store_profiles WHERE payment_declared_at IS NOT NULL
UNION ALL
SELECT 'متاجر تنتظر الإقرار',
       count(*)::text||' متجر', 'ℹ️' FROM store_profiles WHERE payment_declared_at IS NULL
UNION ALL
SELECT 'جدول العناوين + RLS',
       CASE WHEN c.relrowsecurity THEN 'موجود · RLS مفعّل' ELSE 'RLS معطّل!' END,
       CASE WHEN c.relrowsecurity THEN '✅' ELSE '❌' END
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='user_addresses'
UNION ALL
SELECT 'سياسات العناوين (صاحبها وحده)', count(*)::text||'/4', CASE WHEN count(*)=4 THEN '✅' ELSE '❌' END
  FROM pg_policies WHERE tablename='user_addresses'
UNION ALL
SELECT 'anon محروم من جدول العناوين',
       CASE WHEN has_table_privilege('anon','public.user_addresses','SELECT') THEN 'يملك قراءة!' ELSE 'محروم' END,
       CASE WHEN has_table_privilege('anon','public.user_addresses','SELECT') THEN '❌' ELSE '✅' END
UNION ALL
SELECT 'العناوين المُرحَّلة', count(*)::text||' عنوان', 'ℹ️' FROM user_addresses
UNION ALL
SELECT 'حارس الحجز يفحص إقرار الحساب',
       CASE WHEN prosrc LIKE '%TAKI_STORE_NO_PAYMENT%' THEN 'نعم' ELSE 'لا' END,
       CASE WHEN prosrc LIKE '%TAKI_STORE_NO_PAYMENT%' THEN '✅' ELSE '❌' END
  FROM pg_proc WHERE proname='tr_guard_booking_delivery'
UNION ALL
SELECT 'حارس الحجز يقيس نطاق الفرع',
       CASE WHEN prosrc LIKE '%NEW.location_id%' THEN 'نعم' ELSE 'لا' END,
       CASE WHEN prosrc LIKE '%NEW.location_id%' THEN '✅' ELSE '❌' END
  FROM pg_proc WHERE proname='tr_guard_booking_delivery'
UNION ALL
SELECT 'التتبّع يستلزم تأكيد الاستلام',
       CASE WHEN prosrc LIKE '%NOT_ACKNOWLEDGED%' THEN 'نعم' ELSE 'لا' END,
       CASE WHEN prosrc LIKE '%NOT_ACKNOWLEDGED%' THEN '✅' ELSE '❌' END
  FROM pg_proc WHERE proname='delivery_track_set_status'
UNION ALL
SELECT 'حجز البوت يمرّر الفرع لعرض التوصيل',
       CASE WHEN prosrc LIKE '%(v_addr->>''lng'')::float8, v_loc_id)%' THEN 'نعم' ELSE 'لا' END,
       CASE WHEN prosrc LIKE '%(v_addr->>''lng'')::float8, v_loc_id)%' THEN '✅' ELSE '❌' END
  FROM pg_proc WHERE proname='bot_book_deal'
UNION ALL
SELECT 'حجز البوت يفحص إقرار الحساب',
       CASE WHEN prosrc LIKE '%store_no_payment%' THEN 'نعم' ELSE 'لا' END,
       CASE WHEN prosrc LIKE '%store_no_payment%' THEN '✅' ELSE '❌' END
  FROM pg_proc WHERE proname='bot_book_deal'
UNION ALL
SELECT 'وبوت التتبّع كذلك',
       CASE WHEN prosrc LIKE '%not_acknowledged%' THEN 'نعم' ELSE 'لا' END,
       CASE WHEN prosrc LIKE '%not_acknowledged%' THEN '✅' ELSE '❌' END
  FROM pg_proc WHERE proname='bot_delivery_track_ping';
